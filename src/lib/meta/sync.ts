import { fetchAccount, fetchAds, fetchAdInsights, fetchAdInsightsDaily, fetchInsights, type MetaAdEntity, type MetaBreakdownRow } from './client';
import { findAccount } from './accounts';
import { saveSnapshot, type AccountSnapshot, type StoredAd } from './store';
import { hasDb, q } from '../db/client';

function num(v: string | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normActions(
  arr: { action_type: string; value: string }[] | undefined,
): { action_type: string; value: number }[] {
  return (arr ?? []).map((a) => ({ action_type: a.action_type, value: num(a.value) }));
}

/**
 * 1アカウントを同期: ad一覧(メタ) + ad単位インサイト(全期間) を ad_id でマージしてローカル保存。
 * CV/CPAは action_type 別に生保持（正規化はPhase 1b以降で目的別に行う）。
 */
export async function syncAccount(accountId: string): Promise<AccountSnapshot> {
  const cfg = await findAccount(accountId);
  const [info, ads, insights] = await Promise.all([
    fetchAccount(accountId),
    fetchAds(accountId),
    fetchAdInsights(accountId, { datePreset: 'maximum' }),
  ]);

  // ad_id -> insight
  const insightById = new Map(insights.map((i) => [i.ad_id ?? '', i]));

  const merged: StoredAd[] = ads.map((ad) => {
    const ins = insightById.get(ad.id);
    return {
      id: ad.id,
      name: ad.name ?? '(no name)',
      campaignId: ad.campaign_id,
      adsetId: ad.adset_id,
      status: ad.status,
      effectiveStatus: ad.effective_status,
      creativeId: ad.creative?.id,
      spend: num(ins?.spend),
      impressions: num(ins?.impressions),
      reach: num(ins?.reach),
      clicks: num(ins?.clicks),
      ctr: num(ins?.ctr),
      cpc: num(ins?.cpc),
      actions: normActions(ins?.actions),
      costPerActionType: normActions(ins?.cost_per_action_type),
    };
  });

  // 消化金額の降順で並べておく（勝ち分析で上位を見やすく）
  merged.sort((a, b) => b.spend - a.spend);

  const snap: AccountSnapshot = {
    client: cfg?.client ?? info.name,
    accountId,
    accountName: info.name,
    currency: info.currency,
    syncedAt: new Date().toISOString(),
    adCount: merged.length,
    ads: merged,
  };
  await saveSnapshot(snap);

  // DBがあれば広告メタ（dim_ad）も更新（日次factと結合してランキングに使う）
  if (hasDb()) {
    await upsertDimAds(accountId, ads);
  }
  return snap;
}

async function upsertDimAds(accountId: string, ads: MetaAdEntity[]): Promise<void> {
  for (const ad of ads) {
    await q(
      `INSERT INTO dim_ad (account_id, ad_id, name, campaign_id, adset_id, status, effective_status, creative_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (account_id, ad_id) DO UPDATE SET
         name = $3, campaign_id = $4, adset_id = $5, status = $6,
         effective_status = $7, creative_id = $8, updated_at = now()`,
      [accountId, ad.id, ad.name ?? '(no name)', ad.campaign_id ?? null, ad.adset_id ?? null,
       ad.status ?? null, ad.effective_status ?? null, ad.creative?.id ?? null],
    );
  }
}

/** YYYY-MM-DD（UTC基準。Metaの date_start はアカウントタイムゾーンの日付文字列で返る） */
function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * 日次同期: ad×日のインサイトを fact_ad_daily にupsertする（DB必須）。
 * Metaはアトリビューション期間内（最大7日）にCVが遡って増えるため、
 * 毎日の定期実行では直近7日を取り直す。初回バックフィルは range を広げて呼ぶ。
 */
export async function syncAccountDaily(
  accountId: string,
  opts: { since?: string; until?: string; days?: number } = {},
): Promise<{ rangeFrom: string; rangeTo: string; rowCount: number }> {
  if (!hasDb()) throw new Error('日次同期には DATABASE_URL の設定が必要です');

  const until = opts.until ?? dateStr(new Date());
  const since = opts.since ?? dateStr(new Date(Date.now() - (opts.days ?? 7) * 86400_000));

  try {
    const rows = await fetchAdInsightsDaily(accountId, { since, until });
    let count = 0;
    for (const r of rows) {
      if (!r.ad_id || !r.date_start) continue;
      await q(
        `INSERT INTO fact_ad_daily (account_id, ad_id, date, spend, impressions, reach, clicks, actions)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (account_id, ad_id, date) DO UPDATE SET
           spend = $4, impressions = $5, reach = $6, clicks = $7, actions = $8`,
        [accountId, r.ad_id, r.date_start, num(r.spend), num(r.impressions),
         num(r.reach), num(r.clicks), JSON.stringify(normActions(r.actions))],
      );
      count++;
    }
    await q(
      `INSERT INTO sync_runs (account_id, kind, range_from, range_to, ok, detail)
       VALUES ($1, 'daily', $2, $3, true, $4)`,
      [accountId, since, until, `${count}行`],
    );
    return { rangeFrom: since, rangeTo: until, rowCount: count };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await q(
      `INSERT INTO sync_runs (account_id, kind, range_from, range_to, ok, detail)
       VALUES ($1, 'daily', $2, $3, false, $4)`,
      [accountId, since, until, message],
    ).catch(() => {});
    throw error;
  }
}

/**
 * 内訳次元の定義。placement は媒体×配置を「媒体/配置」1キーに畳む。
 *
 * age / gender の単独軸は「スクリーニング層」（取りこぼしが少ない）、
 * age_gender の掛け合わせは「入稿判断層」（絞り込みの精度が高い）として両方を持つ。
 * 単独軸だけだと「65+は勝ちだが65+の女性は負け」が見えず、絞り込み入稿で負けを拾ってしまう。
 *
 * age+gender の併用は Meta Insights API v25.0 で実測確認済み（actions も併せて返る）。
 * placement と違い CV 併用制限はないためフォールバックは不要。
 * gender には Meta 側の正規値として 'unknown' が入る（欠損ではないので除外しない）。
 */
const SEGMENT_DIMENSIONS = [
  { dimension: 'age', breakdowns: ['age'], segmentOf: (r: MetaBreakdownRow) => r.age },
  { dimension: 'gender', breakdowns: ['gender'], segmentOf: (r: MetaBreakdownRow) => r.gender },
  {
    dimension: 'age_gender',
    breakdowns: ['age', 'gender'],
    segmentOf: (r: MetaBreakdownRow) =>
      r.age && r.gender ? `${r.age}・${r.gender}` : undefined,
  },
  {
    dimension: 'placement',
    breakdowns: ['publisher_platform', 'platform_position'],
    segmentOf: (r: MetaBreakdownRow) =>
      r.publisher_platform || r.platform_position
        ? `${r.publisher_platform ?? 'unknown'}/${r.platform_position ?? 'unknown'}`
        : undefined,
  },
] as const;

/**
 * 内訳（性年齢・配置）の日次同期: ad×日×セグメントを fact_ad_segment_daily にupsertする（DB必須）。
 * 勝ちセグメント抽出（segmentVerdict）の元データ。日次同期と同じく直近7日を取り直す設計。
 *
 * placement（publisher_platform×platform_position）は actions（CV）と併用不可の可能性がある
 * （report/route.ts の既存実測コメント参照。システムユーザートークンでは未実測）。
 * → まずCV付きで試行し、Metaがエラーを返したらCVなし（消化・表示・クリックのみ）に落として続行する。
 *   トークン到着後にCV併用可と判明すれば、コード変更なしでCVも貯まる。
 */
export async function syncAccountSegmentsDaily(
  accountId: string,
  opts: { since?: string; until?: string; days?: number } = {},
): Promise<{ rangeFrom: string; rangeTo: string; rowCount: number; placementCv: boolean }> {
  if (!hasDb()) throw new Error('内訳同期には DATABASE_URL の設定が必要です');

  const until = opts.until ?? dateStr(new Date());
  const since = opts.since ?? dateStr(new Date(Date.now() - (opts.days ?? 7) * 86400_000));
  const range = { since, until };

  try {
    let count = 0;
    let placementCv = true;
    for (const dim of SEGMENT_DIMENSIONS) {
      let rows: MetaBreakdownRow[];
      try {
        rows = await fetchInsights(accountId, {
          range, level: 'ad', timeIncrement: 1,
          breakdowns: [...dim.breakdowns],
          fields: 'ad_id,spend,impressions,clicks,actions',
        });
      } catch (e) {
        if (dim.dimension !== 'placement') throw e;
        // 配置×CVの併用不可（Meta制約）とみなし、CVなしで取り直す
        placementCv = false;
        rows = await fetchInsights(accountId, {
          range, level: 'ad', timeIncrement: 1,
          breakdowns: [...dim.breakdowns],
          fields: 'ad_id,spend,impressions,clicks',
        });
      }
      for (const r of rows) {
        const segment = dim.segmentOf(r);
        if (!r.ad_id || !r.date_start || !segment) continue;
        await q(
          `INSERT INTO fact_ad_segment_daily (account_id, ad_id, date, dimension, segment, spend, impressions, clicks, actions)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (account_id, ad_id, date, dimension, segment) DO UPDATE SET
             spend = $6, impressions = $7, clicks = $8, actions = $9`,
          [accountId, r.ad_id, r.date_start, dim.dimension, segment,
           num(r.spend), num(r.impressions), num(r.clicks), JSON.stringify(normActions(r.actions))],
        );
        count++;
      }
    }
    await q(
      `INSERT INTO sync_runs (account_id, kind, range_from, range_to, ok, detail)
       VALUES ($1, 'segments', $2, $3, true, $4)`,
      [accountId, since, until, `${count}行 / 配置CV${placementCv ? '併用可' : '併用不可（フォールバック）'}`],
    );
    return { rangeFrom: since, rangeTo: until, rowCount: count, placementCv };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await q(
      `INSERT INTO sync_runs (account_id, kind, range_from, range_to, ok, detail)
       VALUES ($1, 'segments', $2, $3, false, $4)`,
      [accountId, since, until, message],
    ).catch(() => {});
    throw error;
  }
}
