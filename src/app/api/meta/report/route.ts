import { NextRequest, NextResponse } from 'next/server';
import { listAdAccounts, findAccount } from '@/lib/meta/accounts';
import { requireAuth, assertAccountAccess, filterByAccount } from '@/lib/auth/guard';
import {
  fetchAccount, fetchAds, fetchInsights, fetchCreatives, fetchCampaigns, fetchAdsets, playableVideoId,
  type InsightTimeRange, type MetaBreakdownRow, type MetaInsightsFilter,
} from '@/lib/meta/client';
import { CONVERSION_PRIORITY, analyzeAd, type ConversionGroup } from '@/lib/meta/analyze';
import { getScoringSettings } from '@/lib/meta/scoring-settings';
import { correctCv } from '@/lib/scoring';
import { labelWinners, type Verdict } from '@/lib/meta/winner';
import { loadGeneCache } from '@/lib/meta/genes-store';
import type { StoredAd, AccountSnapshot } from '@/lib/meta/store';

export const runtime = 'nodejs';

const num = (v: string | number | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** actions から指定CV群のCV数（重複種別は最大値）を取る。 */
function cvOfGroup(actions: { action_type: string; value: string | number }[] | undefined, group: ConversionGroup): number {
  const byType = new Map((actions ?? []).map((a) => [a.action_type, num(a.value)]));
  let cv = 0;
  for (const t of group.matchTypes) { const v = byType.get(t); if (v && v > cv) cv = v; }
  return cv;
}

/**
 * 行集合全体で採用するCV群を1つ決める（CONVERSION_PRIORITYの最上位で存在するもの）。
 * 行ごとに別種のCVを混ぜて合算しないため（例: 25-34行はpurchase・45-54行はlead、を同じcv列に足さない）。
 */
function pickRowsConversionGroup(rows: { actions?: { action_type: string; value: string | number }[] }[]): ConversionGroup | null {
  for (const g of CONVERSION_PRIORITY) {
    if (rows.some((r) => cvOfGroup(r.actions, g) > 0)) return g;
  }
  return null;
}

/** YYYY-MM-DD に n 日加算した YYYY-MM-DD を返す。 */
function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysInclusive(since: string, until: string): number {
  const a = new Date(since + 'T00:00:00Z').getTime();
  const b = new Date(until + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86400000) + 1;
}
/** 前期比（%）。前期が0なら null。 */
function pctDelta(cur: number, prev: number): number | null {
  if (!prev) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

/** 期間プリセット → Meta date_preset。カスタムは since/until。 */
const PRESET_MAP: Record<string, string> = {
  today: 'today', yesterday: 'yesterday',
  last_7d: 'last_7d', last_14d: 'last_14d', last_30d: 'last_30d',
  this_month: 'this_month', last_month: 'last_month', maximum: 'maximum',
};

/** カンマ区切りのID列をパース（campaigns=1,2 / adsets=3,4）。 */
function parseIds(v: string | null): string[] {
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

function resolveRange(sp: URLSearchParams): { range: InsightTimeRange; label: string } {
  const since = sp.get('since');
  const until = sp.get('until');
  if (since && until) return { range: { since, until }, label: `${since} 〜 ${until}` };
  const preset = sp.get('preset') ?? 'last_30d';
  const dp = PRESET_MAP[preset] ?? 'last_30d';
  return { range: { datePreset: dp }, label: preset };
}

interface BreakdownAgg { key: string; spend: number; impressions: number; clicks: number; cv: number }

function aggregateBreakdown(rows: MetaBreakdownRow[], dim: 'publisher_platform' | 'platform_position' | 'age' | 'gender'): BreakdownAgg[] {
  // 全行で同一のCV群のみ数える（行ごとの最上位CVを混ぜない）
  const group = pickRowsConversionGroup(rows);
  const m = new Map<string, BreakdownAgg>();
  for (const r of rows) {
    const key = (r[dim] as string) || '(unknown)';
    if (!m.has(key)) m.set(key, { key, spend: 0, impressions: 0, clicks: 0, cv: 0 });
    const a = m.get(key)!;
    a.spend += num(r.spend);
    a.impressions += num(r.impressions);
    a.clicks += num(r.clicks);
    a.cv += group ? cvOfGroup(r.actions, group) : 0;
  }
  return [...m.values()].sort((x, y) => y.spend - x.spend);
}

/**
 * 広告レポート（クリエイティブ別 成果分析）。
 * 期間（preset / カスタム since-until）でMetaからライブ取得し、クリエイティブ別・サマリ・
 * 媒体/配置の内訳・キャンペーン/広告セット階層・勝ちパターン要約を返す。
 *
 * query: ?account=act_xxx&preset=last_30d | &account=...&since=YYYY-MM-DD&until=YYYY-MM-DD
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const sp = request.nextUrl.searchParams;
    const registered = filterByAccount(auth, await listAdAccounts(), (a) => a.accountId);
    const account = sp.get('account') ?? registered[0]?.accountId;
    if (!account) return NextResponse.json({ ok: false, error: '対象アカウントがありません。「アカウント管理」タブから追加してください' }, { status: 404 });
    const denied = assertAccountAccess(auth, account);
    if (denied) return denied;
    const { range, label: rangeLabel } = resolveRange(sp);

    // キャンペーン/広告セット絞り込み（Metaの filtering で全クエリに適用＝サマリ・内訳・推移も絞る）
    const filterCampaigns = parseIds(sp.get('campaigns'));
    const filterAdsets = parseIds(sp.get('adsets'));
    const filtering: MetaInsightsFilter[] | undefined = [
      ...(filterCampaigns.length ? [{ field: 'campaign.id', operator: 'IN' as const, value: filterCampaigns }] : []),
      ...(filterAdsets.length ? [{ field: 'adset.id', operator: 'IN' as const, value: filterAdsets }] : []),
    ];

    const accountsList = registered.map((a) => ({ accountId: a.accountId, client: a.client }));

    // ---- 並列ライブ取得 ----
    const [info, ads, adRows, pubRows, posRows, ageRows, genderRows, campaigns, adsets, trendRows] = await Promise.all([
      fetchAccount(account),
      fetchAds(account),
      fetchInsights(account, { range, level: 'ad', filtering }),
      fetchInsights(account, { range, breakdowns: ['publisher_platform'], fields: 'spend,impressions,clicks,actions', filtering }),
      // platform_position は単独不可・publisher_platformとの併用必須（Meta制約）。
      // actions（CV）は短レンジなら併用可・長レンジは不可（2026-07-08実測）
      // → CV付きで試行し、Metaがエラーを返したらCVなしへフォールバック（同期処理と同じ方式）
      (async () => {
        try {
          return await fetchInsights(account, { range, breakdowns: ['publisher_platform', 'platform_position'], fields: 'spend,impressions,clicks,actions', filtering });
        } catch {
          return fetchInsights(account, { range, breakdowns: ['publisher_platform', 'platform_position'], fields: 'spend,impressions,clicks', filtering });
        }
      })(),
      // 性別・年齢別（actions併用可＝CVも取れる）。単独breakdownで取得し各軸に集計
      fetchInsights(account, { range, breakdowns: ['age'], fields: 'spend,impressions,clicks,actions', filtering }).catch(() => [] as MetaBreakdownRow[]),
      fetchInsights(account, { range, breakdowns: ['gender'], fields: 'spend,impressions,clicks,actions', filtering }).catch(() => [] as MetaBreakdownRow[]),
      fetchCampaigns(account).catch(() => []),
      fetchAdsets(account).catch(() => []),
      // 推移（日次）
      fetchInsights(account, { range, level: 'account', timeIncrement: 1, fields: 'spend,impressions,clicks,actions', filtering }).catch(() => [] as MetaBreakdownRow[]),
    ]);

    const cfg = await findAccount(account);
    // CV乖離補正: 実CV = Meta CV × (1 − 乖離率/100)。以降のCV/CPA/CVRはすべて実CV換算
    const settings = await getScoringSettings(account);
    const corr = (cv: number) => correctCv(cv, settings);
    const campaignName = new Map(campaigns.map((c) => [c.id, c.name ?? c.id]));
    const adsetName = new Map(adsets.map((a) => [a.id, a.name ?? a.id]));
    const entityById = new Map(ads.map((a) => [a.id, a]));

    // ---- 期間内のad行 → StoredAd（配信のあった広告のみ） ----
    const stored: StoredAd[] = adRows
      .filter((r) => r.ad_id && (num(r.spend) > 0 || num(r.impressions) > 0))
      .map((r) => {
        const ent = entityById.get(r.ad_id!);
        return {
          id: r.ad_id!,
          name: ent?.name ?? '(no name)',
          campaignId: r.campaign_id ?? ent?.campaign_id,
          adsetId: r.adset_id ?? ent?.adset_id,
          status: ent?.status,
          effectiveStatus: ent?.effective_status,
          creativeId: ent?.creative?.id,
          spend: num(r.spend),
          impressions: num(r.impressions),
          clicks: num(r.clicks),
          ctr: num(r.ctr),
          cpc: num(r.cpc),
          actions: (r.actions ?? []).map((a) => ({ action_type: a.action_type, value: num(a.value) })),
          costPerActionType: (r.cost_per_action_type ?? []).map((a) => ({ action_type: a.action_type, value: num(a.value) })),
        };
      });

    const snap: AccountSnapshot = {
      client: cfg?.client ?? info.name,
      accountId: account,
      accountName: info.name,
      currency: info.currency,
      syncedAt: new Date().toISOString(),
      adCount: stored.length,
      ads: stored,
    };

    // ---- 勝ち負け判定（同一CV群の中央値split） ----
    const groups = labelWinners(snap);
    const verdictByAd = new Map<string, { verdict: Verdict; cpaRatio: number | null }>();
    for (const g of groups) for (const a of [...g.winners, ...g.losers, ...g.insufficient]) {
      verdictByAd.set(a.id, { verdict: a.verdict, cpaRatio: a.cpaRatio });
    }

    const analyzed = stored.map(analyzeAd);
    const creatives = analyzed.map((a) => {
      const v = verdictByAd.get(a.id);
      const cv = corr(a.cv);
      return {
        adId: a.id,
        name: a.name,
        creativeId: a.creativeId ?? null,
        campaignId: a.campaignId ?? null,
        adsetId: a.adsetId ?? null,
        spend: Math.round(a.spend),
        impressions: a.impressions,
        clicks: a.clicks,
        ctr: Math.round(a.ctr * 100) / 100,
        cpc: Math.round(a.cpc),
        cpm: a.impressions > 0 ? Math.round((a.spend / a.impressions) * 1000) : 0,
        cv,
        cpa: cv > 0 ? Math.round((a.spend / cv) * 10) / 10 : null,
        cvr: a.clicks > 0 ? Math.round((cv / a.clicks) * 1000) / 10 : 0,
        conversionLabel: a.conversionLabel,
        verdict: v?.verdict ?? 'insufficient',
        cpaRatio: v?.cpaRatio ?? null,
        active: a.effectiveStatus === 'ACTIVE',
        effectiveStatus: a.effectiveStatus ?? null,
        isVideo: false as boolean,
        imageUrl: undefined as string | undefined,
        videoId: null as string | null,
      };
    });

    // ---- サムネ＋再生用videoId（全creativeをまとめて取得→geneキャッシュをフォールバック） ----
    const allIds = [...new Set(creatives.map((c) => c.creativeId).filter(Boolean) as string[])];
    let creativeMeta: Awaited<ReturnType<typeof fetchCreatives>> = {};
    try { creativeMeta = await fetchCreatives(allIds); } catch (e) {
      // トークン失効等はメトリクスのみで継続（ただし黙殺せずログに残す）
      console.warn('[meta/report] creative取得に失敗（サムネはキャッシュのみで継続）:', e instanceof Error ? e.message : e);
    }
    const geneCache = await loadGeneCache(account);
    for (const c of creatives) {
      const m = c.creativeId ? creativeMeta[c.creativeId] : undefined;
      if (m) {
        c.imageUrl = m.image_url || m.thumbnail_url;
        c.isVideo = m.object_type === 'VIDEO' || !!m.video_id;
        if (c.isVideo) c.videoId = playableVideoId(m) ?? null;
      } else if (c.creativeId && geneCache[c.creativeId]) {
        c.imageUrl = geneCache[c.creativeId].imageUrl;
        c.isVideo = geneCache[c.creativeId].isVideo;
      }
    }

    // ---- 媒体・配置の内訳（CVは乖離補正後） ----
    const corrRows = (rows: BreakdownAgg[]) => rows.map((r) => ({ ...r, cv: corr(r.cv) }));
    const media = corrRows(aggregateBreakdown(pubRows, 'publisher_platform'));
    const placement = corrRows(aggregateBreakdown(posRows, 'platform_position'));

    // ---- 性別・年齢別の内訳 ----
    const AGE_ORDER = ['13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+', 'unknown'];
    const age = corrRows(aggregateBreakdown(ageRows, 'age'))
      .sort((x, y) => {
        const ix = AGE_ORDER.indexOf(x.key), iy = AGE_ORDER.indexOf(y.key);
        return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy);
      });
    const gender = corrRows(aggregateBreakdown(genderRows, 'gender')); // spend降順

    // ---- キャンペーン → 広告セット 階層 ----
    interface Node { id: string; name: string; spend: number; impressions: number; clicks: number; cv: number; cpa: number | null; adCount: number; children?: Node[] }
    const campMap = new Map<string, Node>();
    const adsetMap = new Map<string, Node>();
    for (const a of analyzed) {
      const cId = a.campaignId ?? '(none)';
      const aId = a.adsetId ?? '(none)';
      if (!campMap.has(cId)) campMap.set(cId, { id: cId, name: campaignName.get(cId) ?? '(不明)', spend: 0, impressions: 0, clicks: 0, cv: 0, cpa: null, adCount: 0, children: [] });
      const camp = campMap.get(cId)!;
      const akey = `${cId}::${aId}`;
      if (!adsetMap.has(akey)) {
        const node: Node = { id: aId, name: adsetName.get(aId) ?? '(不明)', spend: 0, impressions: 0, clicks: 0, cv: 0, cpa: null, adCount: 0 };
        adsetMap.set(akey, node);
        camp.children!.push(node);
      }
      const aset = adsetMap.get(akey)!;
      for (const node of [camp, aset]) {
        node.spend += a.spend; node.impressions += a.impressions; node.clicks += a.clicks; node.cv += a.cv; node.adCount += (node === camp ? 0 : 1);
      }
      camp.adCount += 1;
    }
    const finalize = (n: Node) => { n.spend = Math.round(n.spend); n.cv = corr(n.cv); n.cpa = n.cv > 0 ? Math.round(n.spend / n.cv) : null; };
    const hierarchy = [...campMap.values()].sort((a, b) => b.spend - a.spend);
    for (const c of hierarchy) { finalize(c); c.children!.forEach(finalize); c.children!.sort((x, y) => y.spend - x.spend); }

    // ---- サマリ ----
    const sum = (f: (a: typeof analyzed[number]) => number) => analyzed.reduce((s, x) => s + f(x), 0);
    const tSpend = sum((a) => a.spend), tImpr = sum((a) => a.impressions), tClicks = sum((a) => a.clicks), tCv = corr(sum((a) => a.cv));
    const conversionLabels = [...new Set(analyzed.map((a) => a.conversionLabel).filter(Boolean))] as string[];
    const summary = {
      spend: Math.round(tSpend), impressions: tImpr, clicks: tClicks,
      cpm: tImpr > 0 ? Math.round((tSpend / tImpr) * 1000) : 0,
      ctr: tImpr > 0 ? Math.round((tClicks / tImpr) * 10000) / 100 : 0,
      cpc: tClicks > 0 ? Math.round(tSpend / tClicks) : 0,
      cv: tCv, cpa: tCv > 0 ? Math.round(tSpend / tCv) : null,
      cvr: tClicks > 0 ? Math.round((tCv / tClicks) * 1000) / 10 : 0,
      conversionLabels, adCount: stored.length, withCvCount: analyzed.filter((a) => a.cv > 0).length,
    };

    // ---- 勝ちパターン要約 ----
    const winnerCount = creatives.filter((c) => c.verdict === 'winner').length;
    const loserCount = creatives.filter((c) => c.verdict === 'loser').length;
    const topWinners = [...creatives].filter((c) => c.cpa != null && c.verdict === 'winner')
      .sort((a, b) => (a.cpa! - b.cpa!)).slice(0, 3)
      .map((c) => ({ name: c.name, cpa: c.cpa, cpaRatio: c.cpaRatio, conversionLabel: c.conversionLabel, isVideo: c.isVideo, imageUrl: c.imageUrl }));
    const bestMedia = media[0]?.key ?? null;
    // 動画 vs 静止画の勝率（勝ち判定内で）
    const judged = creatives.filter((c) => c.verdict !== 'insufficient');
    const videoWin = judged.filter((c) => c.isVideo && c.verdict === 'winner').length;
    const videoTotal = judged.filter((c) => c.isVideo).length;
    const imgWin = judged.filter((c) => !c.isVideo && c.verdict === 'winner').length;
    const imgTotal = judged.filter((c) => !c.isVideo).length;
    const winningSummary = {
      winnerCount, loserCount,
      topWinners,
      bestMedia,
      videoWinRate: videoTotal > 0 ? Math.round((videoWin / videoTotal) * 100) : null,
      imageWinRate: imgTotal > 0 ? Math.round((imgWin / imgTotal) * 100) : null,
      videoTotal, imageTotal: imgTotal,
    };

    // ---- 推移（日次）＋ 前期比 ----
    // 日ごとに別種のCVを混ぜないよう、期間全体で採用するCV群を1つ決める
    const trendGroup = pickRowsConversionGroup(trendRows);
    const trend = trendRows
      .filter((r) => r.date_start)
      .map((r) => {
        const spend = num(r.spend), impr = num(r.impressions), clicks = num(r.clicks);
        const cv = trendGroup ? corr(cvOfGroup(r.actions, trendGroup)) : 0;
        return {
          date: r.date_start!,
          spend: Math.round(spend), impressions: impr, clicks,
          cpm: impr > 0 ? Math.round((spend / impr) * 1000) : 0,
          ctr: impr > 0 ? Math.round((clicks / impr) * 10000) / 100 : 0,
          cpc: clicks > 0 ? Math.round(spend / clicks) : 0,
          cv, cvr: clicks > 0 ? Math.round((cv / clicks) * 1000) / 10 : 0,
          // CV 0の日を「CPA ¥0＝最良」に見せない
          cpa: cv > 0 ? Math.round(spend / cv) : null,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    let deltas: Record<string, number | null> | null = null;
    if (trend.length > 0) {
      const since = trend[0].date, until = trend[trend.length - 1].date;
      const days = daysInclusive(since, until);
      const prevSince = addDays(since, -days), prevUntil = addDays(since, -1);
      try {
        const prevRows = await fetchInsights(account, { range: { since: prevSince, until: prevUntil }, level: 'account', fields: 'spend,impressions,clicks,actions', filtering });
        let pSpend = 0, pImpr = 0, pClicks = 0, pCv = 0;
        // 前期比のCVは当期と同じCV群で数える（別種のCVと比較しない）
        for (const r of prevRows) { pSpend += num(r.spend); pImpr += num(r.impressions); pClicks += num(r.clicks); pCv += trendGroup ? cvOfGroup(r.actions, trendGroup) : 0; }
        pCv = corr(pCv); // 当期と同じ乖離補正（比較の土俵を揃える）
        const pCpm = pImpr > 0 ? (pSpend / pImpr) * 1000 : 0;
        const pCtr = pImpr > 0 ? (pClicks / pImpr) * 100 : 0;
        const pCpc = pClicks > 0 ? pSpend / pClicks : 0;
        const pCvr = pClicks > 0 ? (pCv / pClicks) * 100 : 0;
        const pCpa = pCv > 0 ? pSpend / pCv : 0;
        deltas = {
          spend: pctDelta(tSpend, pSpend), impressions: pctDelta(tImpr, pImpr), cpm: pctDelta(summary.cpm, pCpm),
          ctr: pctDelta(summary.ctr, pCtr), clicks: pctDelta(tClicks, pClicks), cpc: pctDelta(summary.cpc, pCpc),
          cvr: pctDelta(summary.cvr, pCvr), cv: pctDelta(tCv, pCv), cpa: summary.cpa != null && pCpa ? pctDelta(summary.cpa, pCpa) : null,
        };
      } catch { /* 前期データ無しは deltas=null のまま */ }
    }

    return NextResponse.json({
      ok: true,
      accounts: accountsList,
      account: { accountId: account, client: cfg?.client ?? info.name, accountName: info.name, currency: info.currency },
      range: { ...range, label: rangeLabel },
      // 絞り込みセレクタ用の全件一覧（フィルタの影響を受けない。絞った後も選択肢が消えないように）
      campaignOptions: campaigns.map((c) => ({ id: c.id, name: c.name ?? c.id })),
      adsetOptions: adsets.map((a) => ({ id: a.id, name: a.name ?? a.id, campaignId: a.campaign_id ?? null })),
      filter: { campaigns: filterCampaigns, adsets: filterAdsets },
      cvDeviationPct: settings.cvDeviationPct,
      summary,
      media, placement, age, gender, hierarchy, winningSummary,
      trend, deltas,
      creatives,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '広告レポートの取得に失敗しました';
    const isAuth = /token|expired|OAuth|session/i.test(message);
    return NextResponse.json(
      { ok: false, error: isAuth ? `Metaトークンエラー: ${message}` : message },
      { status: 500 },
    );
  }
}
