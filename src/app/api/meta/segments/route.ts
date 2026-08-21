import { NextRequest, NextResponse } from 'next/server';
import { listAdAccounts } from '@/lib/meta/accounts';
import { requireAuth, assertAccountAccess, filterByAccount } from '@/lib/auth/guard';
import { isValidAccountId } from '@/lib/meta/store';
import { hasDb, q } from '@/lib/db/client';
import { getScoringSettings } from '@/lib/meta/scoring-settings';
import { CONVERSION_PRIORITY, type ConversionGroup } from '@/lib/meta/analyze';
import {
  segmentVerdict, spendRankOf, spendRankLabel, cpaLimits, correctCv,
  type SegmentVerdict,
} from '@/lib/scoring';

export const runtime = 'nodejs';

type Action = { action_type: string; value: number };

/** actions から指定CV群のCV数（重複種別は最大値）を取る。 */
function cvOfGroup(actions: Action[], group: ConversionGroup): number {
  const byType = new Map(actions.map((a) => [a.action_type, a.value]));
  let cv = 0;
  for (const t of group.matchTypes) { const v = byType.get(t); if (v && v > cv) cv = v; }
  return cv;
}

/** 次元内の全行で採用するCV群を1つ決める（セグメントごとに別種のCVを混ぜて比較しないため）。 */
function pickConversionGroup(rows: { actions: Action[] }[]): ConversionGroup | null {
  for (const g of CONVERSION_PRIORITY) {
    if (rows.some((r) => cvOfGroup(r.actions, g) > 0)) return g;
  }
  return null;
}

const DIMENSION_LABELS: Record<string, string> = {
  gender: '性別', age: '年齢', age_gender: '年齢×性別', placement: '配置',
};
const AGE_ORDER = ['13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+', 'unknown'];

/** 表示・分析の次元順。単独軸（スクリーニング）→ 掛け合わせ（入稿判断）の順に並べる */
const DIMENSION_ORDER = ['gender', 'age', 'age_gender', 'placement'];
/** 入稿判断に使う層（掛け合わせ・配置）。単独軸はスクリーニング層として分ける */
const DECISION_DIMENSIONS = new Set(['age_gender', 'placement']);

/** 'age_gender' の segment（例: 65+・female）を年齢順→性別順に並べるためのキー */
function ageGenderSortKey(segment: string): [number, string] {
  const [age, gender = ''] = segment.split('・');
  const i = AGE_ORDER.indexOf(age);
  return [i < 0 ? 99 : i, gender];
}

interface SegmentRow {
  segment: string;
  spend: number;
  impressions: number;
  clicks: number;
  cv: number;
  cpa: number | null;
  /** CVが取れない次元（配置×CV不可時）は null */
  verdict: SegmentVerdict | null;
  spendRank: string;
  spendRankLabel: string;
}

/**
 * 勝ちセグメント抽出（シートの内訳系★判定＝segmentVerdict の配線先）。
 * fact_ad_segment_daily を次元（性別/年齢/配置）×セグメントで期間集計し、
 * 内訳系の総合評価（★★★/★★/★継続/停止推奨/判定不可）を付けて返す。
 *
 * query:
 *   account=act_xxx（省略時は登録済み先頭）
 *   since=YYYY-MM-DD&until=YYYY-MM-DD … 期間指定。省略時は蓄積済み全期間
 */
export async function GET(request: NextRequest) {
  try {
    if (!hasDb()) {
      return NextResponse.json(
        { ok: false, error: '勝ちセグメントには DATABASE_URL（内訳の日次データ）の設定が必要です' },
        { status: 400 },
      );
    }
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const sp = request.nextUrl.searchParams;
    const registered = filterByAccount(auth, await listAdAccounts(), (a) => a.accountId);
    const account = sp.get('account') ?? registered[0]?.accountId;
    if (!account) {
      return NextResponse.json(
        { ok: false, error: '対象アカウントがありません。「アカウント管理」タブから追加してください' },
        { status: 404 },
      );
    }
    if (!isValidAccountId(account)) {
      return NextResponse.json({ ok: false, error: `不正なアカウントIDです: ${account}` }, { status: 400 });
    }
    const denied = assertAccountAccess(auth, account);
    if (denied) return denied;

    const since = sp.get('since');
    const until = sp.get('until');
    const parseIds = (v: string | null) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
    const filterCampaigns = parseIds(sp.get('campaigns'));
    const filterAdsets = parseIds(sp.get('adsets'));
    const settings = await getScoringSettings(account);

    const params: unknown[] = [account];
    let where = 'f.account_id = $1';
    if (since && until) {
      where += ` AND f.date BETWEEN $${params.length + 1} AND $${params.length + 2}`;
      params.push(since, until);
    }
    if (filterCampaigns.length) { params.push(filterCampaigns); where += ` AND d.campaign_id = ANY($${params.length})`; }
    if (filterAdsets.length) { params.push(filterAdsets); where += ` AND d.adset_id = ANY($${params.length})`; }
    const from = `FROM fact_ad_segment_daily f
       LEFT JOIN dim_ad d ON d.account_id = f.account_id AND d.ad_id = f.ad_id`;
    const rows = await q<{
      dimension: string; segment: string;
      spend: string; impressions: string; clicks: string;
      actions: Action[];
    }>(
      `SELECT f.dimension, f.segment, f.spend, f.impressions, f.clicks, f.actions
       ${from} WHERE ${where}`,
      params,
    );
    const [range] = await q<{ min: string | null; max: string | null }>(
      `SELECT min(f.date)::text AS min, max(f.date)::text AS max
       ${from} WHERE ${where}`,
      params,
    );

    // 次元→セグメントに集計（actions は action_type ごとに加算）
    const byDim = new Map<string, Map<string, { spend: number; impressions: number; clicks: number; actions: Map<string, number> }>>();
    for (const r of rows) {
      if (!byDim.has(r.dimension)) byDim.set(r.dimension, new Map());
      const seg = byDim.get(r.dimension)!;
      const g = seg.get(r.segment) ?? { spend: 0, impressions: 0, clicks: 0, actions: new Map() };
      g.spend += Number(r.spend) || 0;
      g.impressions += Number(r.impressions) || 0;
      g.clicks += Number(r.clicks) || 0;
      for (const a of r.actions ?? []) g.actions.set(a.action_type, (g.actions.get(a.action_type) ?? 0) + a.value);
      seg.set(r.segment, g);
    }

    const dimensions = DIMENSION_ORDER
      .filter((d) => byDim.has(d))
      .map((dimension) => {
        const segMap = byDim.get(dimension)!;
        const aggregated = [...segMap.entries()].map(([segment, g]) => ({
          segment, ...g,
          actionsArr: [...g.actions.entries()].map(([action_type, value]) => ({ action_type, value })),
        }));
        // CV群は次元内で1つに固定。無ければCV取得不可の次元（配置×CV不可 or 本当にCVゼロ）
        const group = pickConversionGroup(aggregated.map((a) => ({ actions: a.actionsArr })));
        const segRows: SegmentRow[] = aggregated.map((a) => {
          // CV乖離補正: 実CV換算（★判定・CPAも補正後基準）
          const cv = group ? correctCv(cvOfGroup(a.actionsArr, group), settings) : 0;
          const cpa = cv > 0 ? a.spend / cv : null;
          const rank = spendRankOf(a.spend, settings.spendRankBreakdown);
          return {
            segment: a.segment,
            spend: Math.round(a.spend),
            impressions: a.impressions,
            clicks: a.clicks,
            cv,
            cpa,
            verdict: group ? segmentVerdict(a.spend, cv, cpa, settings) : null,
            spendRank: rank,
            spendRankLabel: spendRankLabel(rank, settings.spendRankBreakdown),
          };
        });
        segRows.sort((x, y) => {
          if (dimension === 'age') {
            const ix = AGE_ORDER.indexOf(x.segment), iy = AGE_ORDER.indexOf(y.segment);
            return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy);
          }
          if (dimension === 'age_gender') {
            const [ax, gx] = ageGenderSortKey(x.segment);
            const [ay, gy] = ageGenderSortKey(y.segment);
            return ax !== ay ? ax - ay : gx.localeCompare(gy);
          }
          return y.spend - x.spend;
        });
        return {
          dimension,
          label: DIMENSION_LABELS[dimension] ?? dimension,
          cvAvailable: group != null,
          conversionLabel: group?.label ?? null,
          rows: segRows,
        };
      });

    // 勝ちセグメント（★★★/★★）を次元横断で抽出。
    // 単独軸（年齢・性別）と掛け合わせ（年齢×性別）を同じリストに混ぜると同じ消化が二重に並び、
    // 「65+に寄せる」「65+・maleに寄せる」が別々の打ち手として扱われてしまう。
    // そのため入稿判断層（掛け合わせ・配置）とスクリーニング層（単独軸）に分けて返す。
    const pickWinners = (dims: typeof dimensions) => dims.flatMap((d) =>
      d.rows
        .filter((r) => r.verdict === '★★★' || r.verdict === '★★')
        .map((r) => ({ dimension: d.dimension, dimensionLabel: d.label, segment: r.segment, verdict: r.verdict!, cpa: r.cpa, spend: r.spend, cv: r.cv })),
    ).sort((x, y) => (x.verdict === y.verdict ? (x.cpa ?? Infinity) - (y.cpa ?? Infinity) : (x.verdict === '★★★' ? -1 : 1)));

    // age_gender が未蓄積のアカウント（再バックフィル前）は従来どおり全次元を winners に入れる
    const hasCross = dimensions.some((d) => d.dimension === 'age_gender');
    const winners = pickWinners(
      hasCross ? dimensions.filter((d) => DECISION_DIMENSIONS.has(d.dimension)) : dimensions,
    );
    const screening = hasCross
      ? pickWinners(dimensions.filter((d) => !DECISION_DIMENSIONS.has(d.dimension)))
      : [];

    return NextResponse.json({
      ok: true,
      account,
      accounts: registered.map((a) => ({ accountId: a.accountId, client: a.client })),
      range: {
        label: since && until ? `${since} 〜 ${until}` : `全期間（蓄積分${range?.min ? `: ${range.min} 〜 ${range.max}` : 'なし'}）`,
        since, until, dataMin: range?.min ?? null, dataMax: range?.max ?? null,
      },
      settings: {
        payoutPerCv: settings.payoutPerCv,
        cpaLimits: cpaLimits(settings),
        spendRankBreakdown: settings.spendRankBreakdown,
        starSpendMin: settings.starSpendMin,
        brandPrefixes: settings.brandPrefixes,
        cvDeviationPct: settings.cvDeviationPct,
      },
      dimensions,
      winners,
      screening,
      crossAvailable: hasCross,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '勝ちセグメントの集計に失敗しました';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
