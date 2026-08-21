import { NextRequest, NextResponse } from 'next/server';
import { isValidAccountId } from '@/lib/meta/store';
import { hasDb, q } from '@/lib/db/client';
import { getScoringSettings } from '@/lib/meta/scoring-settings';
import { correctCv } from '@/lib/scoring';
import { CONVERSION_PRIORITY, type ConversionGroup } from '@/lib/meta/analyze';
import { requireAuth, assertAccountAccess } from '@/lib/auth/guard';

export const runtime = 'nodejs';

type Action = { action_type: string; value: number };

/** actions から指定CV群のCV数（重複種別は最大値）を取る。segments API と同じ規則 */
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
  gender: '性別', age: '年齢', age_gender: '年齢×性別', placement: '配置（媒体）',
};
const AGE_ORDER = ['13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+', 'unknown'];
/** 単独軸（スクリーニング）→ 掛け合わせ（入稿判断）の順 */
const DIMENSION_ORDER = ['gender', 'age', 'age_gender', 'placement'];

/**
 * 1クリエイティブ（広告ID単位）の内訳実績（性別・年齢・配置）。
 * レポートタブのクリエイティブ詳細モーダル「表示先の内訳」用。
 * fact_ad_segment_daily（広告×日×内訳）を期間集計して返す。
 *
 * query: account=act_xxx & adId=xxx [& since=YYYY-MM-DD & until=YYYY-MM-DD]
 */
export async function GET(request: NextRequest) {
  try {
    if (!hasDb()) {
      return NextResponse.json(
        { ok: false, error: '内訳表示には DATABASE_URL（内訳の日次データ）の設定が必要です' },
        { status: 400 },
      );
    }
    const sp = request.nextUrl.searchParams;
    const account = sp.get('account');
    const adId = sp.get('adId');
    if (!account || !isValidAccountId(account)) {
      return NextResponse.json({ ok: false, error: `不正なアカウントIDです: ${account}` }, { status: 400 });
    }
    if (!adId || !/^\d+$/.test(adId)) {
      return NextResponse.json({ ok: false, error: `不正な広告IDです: ${adId}` }, { status: 400 });
    }
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const denied = assertAccountAccess(auth, account);
    if (denied) return denied;
    const since = sp.get('since');
    const until = sp.get('until');
    const settings = await getScoringSettings(account);

    const params: unknown[] = [account, adId];
    let where = 'account_id = $1 AND ad_id = $2';
    if (since && until) {
      where += ' AND date BETWEEN $3 AND $4';
      params.push(since, until);
    }
    const rows = await q<{
      dimension: string; segment: string;
      spend: string; impressions: string; clicks: string;
      actions: Action[];
    }>(
      `SELECT dimension, segment, spend, impressions, clicks, actions
       FROM fact_ad_segment_daily WHERE ${where}`,
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
        const group = pickConversionGroup(aggregated.map((a) => ({ actions: a.actionsArr })));
        const segRows = aggregated.map((a) => {
          // CV乖離補正: 実CV換算
          const cv = group ? correctCv(cvOfGroup(a.actionsArr, group), settings) : 0;
          return {
            segment: a.segment,
            spend: Math.round(a.spend),
            impressions: a.impressions,
            clicks: a.clicks,
            ctr: a.impressions > 0 ? Math.round((a.clicks / a.impressions) * 1000) / 10 : 0,
            cv,
            cpa: cv > 0 ? Math.round(a.spend / cv) : null,
          };
        });
        segRows.sort((x, y) => {
          if (dimension === 'age') {
            const ix = AGE_ORDER.indexOf(x.segment), iy = AGE_ORDER.indexOf(y.segment);
            return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy);
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

    const [range] = await q<{ min: string | null; max: string | null }>(
      `SELECT min(date)::text AS min, max(date)::text AS max FROM fact_ad_segment_daily WHERE ${where}`,
      params,
    );

    return NextResponse.json({
      ok: true,
      account, adId,
      range: { since, until, dataMin: range?.min ?? null, dataMax: range?.max ?? null },
      dimensions,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '内訳の集計に失敗しました';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
