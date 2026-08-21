import { NextRequest, NextResponse } from 'next/server';
import { listAdAccounts } from '@/lib/meta/accounts';
import { loadSnapshot, isValidAccountId } from '@/lib/meta/store';
import { analyzeAd } from '@/lib/meta/analyze';
import { hasDb, q } from '@/lib/db/client';
import { getScoringSettings } from '@/lib/meta/scoring-settings';
import { buildPriorityRows, cpaLimits, correctCv, type AdMetricInput } from '@/lib/scoring';
import { requireAuth, assertAccountAccess, filterByAccount } from '@/lib/auth/guard';

export const runtime = 'nodejs';

/**
 * 優先順位ランキング（シートの OUT_優先順位 相当）。
 * 広告を名寄せ（統合名）で束ね、購入単価ランク・消化金額ランク・総合評価を付けて返す。
 *
 * query:
 *   account=act_xxx（省略時は登録済み先頭）
 *   since=YYYY-MM-DD&until=YYYY-MM-DD … 期間指定（fact_ad_daily集計・DB必須。リーチなし）
 *   省略時 … 全期間スナップショット（リーチあり）
 */
export async function GET(request: NextRequest) {
  try {
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

    let items: AdMetricInput[] = [];
    let reachAvailable = false;
    let rangeLabel = '全期間';
    let conversionLabel: string | null = null;
    let syncedAt: string | null = null;

    if (since && until) {
      // ---- 期間指定: fact_ad_daily から集計（DB必須・リーチは期間合算不可のため出さない） ----
      if (!hasDb()) {
        return NextResponse.json(
          { ok: false, error: '期間指定には DATABASE_URL（日次データ）の設定が必要です' },
          { status: 400 },
        );
      }
      rangeLabel = `${since} 〜 ${until}`;
      const params: unknown[] = [account, since, until];
      let where = 'f.account_id = $1 AND f.date BETWEEN $2 AND $3';
      if (filterCampaigns.length) { params.push(filterCampaigns); where += ` AND d.campaign_id = ANY($${params.length})`; }
      if (filterAdsets.length) { params.push(filterAdsets); where += ` AND d.adset_id = ANY($${params.length})`; }
      const rows = await q<{
        ad_id: string; name: string | null;
        spend: string; impressions: string; clicks: string;
        actions: { action_type: string; value: number }[];
      }>(
        `SELECT f.ad_id, d.name, f.spend, f.impressions, f.clicks, f.actions
         FROM fact_ad_daily f
         LEFT JOIN dim_ad d ON d.account_id = f.account_id AND d.ad_id = f.ad_id
         WHERE ${where}`,
        params,
      );
      // ad単位に合算（actionsは action_type ごとに加算）
      const byAd = new Map<string, { name: string; spend: number; impressions: number; clicks: number; actions: Map<string, number> }>();
      for (const r of rows) {
        const g = byAd.get(r.ad_id) ?? { name: r.name ?? '(no name)', spend: 0, impressions: 0, clicks: 0, actions: new Map() };
        g.spend += Number(r.spend) || 0;
        g.impressions += Number(r.impressions) || 0;
        g.clicks += Number(r.clicks) || 0;
        for (const a of r.actions ?? []) {
          g.actions.set(a.action_type, (g.actions.get(a.action_type) ?? 0) + a.value);
        }
        byAd.set(r.ad_id, g);
      }
      const labels = new Map<string, number>();
      items = [...byAd.entries()].map(([adId, g]) => {
        const analyzed = analyzeAd({
          id: adId, name: g.name, spend: g.spend, impressions: g.impressions,
          clicks: g.clicks, ctr: 0, cpc: 0,
          actions: [...g.actions.entries()].map(([action_type, value]) => ({ action_type, value })),
          costPerActionType: [],
        });
        if (analyzed.conversionLabel) labels.set(analyzed.conversionLabel, (labels.get(analyzed.conversionLabel) ?? 0) + 1);
        return {
          // CV乖離補正: 実CV換算で集計・判定（buildPriorityRows のCPA・ランクも補正後基準になる）
          name: g.name, reach: 0, purchases: correctCv(analyzed.cv, settings), spend: g.spend,
          impressions: g.impressions, clicks: g.clicks, adId,
        };
      });
      conversionLabel = [...labels.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    } else {
      // ---- 全期間: スナップショット（リーチあり） ----
      const snap = await loadSnapshot(account);
      if (!snap) {
        return NextResponse.json(
          { ok: false, error: '同期データがありません。「アカウント管理」タブから同期してください' },
          { status: 404 },
        );
      }
      syncedAt = snap.syncedAt;
      reachAvailable = true;
      const labels = new Map<string, number>();
      let adsList = snap.ads;
      if (filterCampaigns.length) adsList = adsList.filter((ad) => ad.campaignId != null && filterCampaigns.includes(ad.campaignId));
      if (filterAdsets.length) adsList = adsList.filter((ad) => ad.adsetId != null && filterAdsets.includes(ad.adsetId));
      items = adsList.map((ad) => {
        const analyzed = analyzeAd(ad);
        if (analyzed.conversionLabel) labels.set(analyzed.conversionLabel, (labels.get(analyzed.conversionLabel) ?? 0) + 1);
        return {
          name: ad.name, reach: ad.reach ?? 0, purchases: correctCv(analyzed.cv, settings), spend: ad.spend,
          impressions: ad.impressions, clicks: ad.clicks, adId: ad.id,
        };
      });
      conversionLabel = [...labels.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    }

    const rows = buildPriorityRows(items, settings);
    return NextResponse.json({
      ok: true,
      account,
      accounts: registered.map((a) => ({ accountId: a.accountId, client: a.client })),
      range: { label: rangeLabel, since, until },
      reachAvailable,
      conversionLabel,
      syncedAt,
      settings: { payoutPerCv: settings.payoutPerCv, roasPct: settings.roasPct, cpaLimits: cpaLimits(settings), spendRank: settings.spendRank, cvDeviationPct: settings.cvDeviationPct },
      rows,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ランキングの生成に失敗しました';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
