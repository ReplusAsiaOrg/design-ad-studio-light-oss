import { q } from '@/lib/db/client';
import { CONVERSION_PRIORITY, type ConversionGroup } from './analyze';
import { normalizeAdName, cpaLimits, correctCv, type ScoringSettings } from '@/lib/scoring';

/**
 * クリエイティブ（名寄せ後）×配置（媒体/配置）のクロス集計。
 * 「全体では負けだが特定の媒体・配置では勝っている」クリエイティブを見つけるための
 * AI分析用データ。fact_ad_segment_daily（広告×日×内訳）を dimension='placement' で
 * 統合名×セグメントに畳む。
 */

type Action = { action_type: string; value: number };

/** actions から指定CV群のCV数（重複種別は最大値）を取る。segments API と同じ規則 */
function cvOfGroup(actions: Map<string, number>, group: ConversionGroup): number {
  let cv = 0;
  for (const t of group.matchTypes) {
    const v = actions.get(t);
    if (v && v > cv) cv = v;
  }
  return cv;
}

export interface CrossSegmentRow {
  segment: string;
  spend: number;
  cv: number;
  cpa: number | null;
}

export interface CreativeCross {
  /** 名寄せ後の統合名 */
  name: string;
  spend: number;
  cv: number;
  cpa: number | null;
  /** 配置別実績（spend降順・少額はまとめ済み） */
  segments: CrossSegmentRow[];
  /** 全体は基準超えだが、この配置だけならCPA基準内（配置絞り込みで化ける候補） */
  reviveSegments: string[];
  /** 全体は基準内だが、消化だけ食ってCV0の配置（除外候補） */
  cutSegments: string[];
}

export interface CreativeCrossResult {
  /** 集計対象の内訳次元（'placement' | 'age_gender'） */
  dimension: string;
  /** 表示用ラベル（配置 / 年齢×性別） */
  dimensionLabel: string;
  cvAvailable: boolean;
  conversionLabel: string | null;
  /** CPA基準（★継続ライン）。この額以下なら「基準内」 */
  keepCpaLimit: number;
  /** 除外候補判定に使った最低消化額（設定 cutMinSpend、未設定はCPA基準に連動） */
  cutMinSpend: number;
  creatives: CreativeCross[];
}

const MAX_CREATIVES = 12;
const MAX_SEGMENTS_PER_CREATIVE = 8;
/** ギャップ判定に使うセグメントの最低消化額（ノイズ除去） */
const MIN_SEGMENT_SPEND = 1000;

export interface CrossFilter { campaigns?: string[]; adsets?: string[] }

/** リクエストbodyの未検証値から CrossFilter を作る（文字列以外は捨てる）。 */
export function idFilter(campaigns: unknown, adsets: unknown): CrossFilter {
  const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : []);
  return { campaigns: ids(campaigns), adsets: ids(adsets) };
}

/** クロス集計に使える内訳次元。単独軸（age/gender）はスクリーニング層なので対象外。 */
export const CROSS_DIMENSIONS = ['placement', 'age_gender'] as const;
export type CrossDimension = (typeof CROSS_DIMENSIONS)[number];
const CROSS_DIMENSION_LABELS: Record<CrossDimension, string> = {
  placement: '配置',
  age_gender: '年齢×性別',
};

/**
 * クリエイティブ×セグメントクロスを集計して返す。DBなし・データなしのときは null。
 * since/until 省略時は蓄積済み全期間。filter でキャンペーン/広告セット絞り込み。
 *
 * dimension で対象の内訳次元を選ぶ（既定は配置）。age_gender を指定すると
 * 「全体は負けだが 65+・female なら基準内」といったデモグラ側の救済候補も拾える。
 * age / gender の単独軸は打ち消し合いで中身が見えないため、ここでは対象にしない。
 */
export async function buildCreativeCross(
  account: string,
  since: string | null,
  until: string | null,
  settings: ScoringSettings,
  filter?: CrossFilter | null,
  dimension: CrossDimension = 'placement',
): Promise<CreativeCrossResult | null> {
  const params: unknown[] = [account, dimension];
  let where = `f.account_id = $1 AND f.dimension = $2`;
  if (since && until) {
    params.push(since, until);
    where += ` AND f.date BETWEEN $${params.length - 1} AND $${params.length}`;
  }
  if (filter?.campaigns?.length) { params.push(filter.campaigns); where += ` AND d.campaign_id = ANY($${params.length})`; }
  if (filter?.adsets?.length) { params.push(filter.adsets); where += ` AND d.adset_id = ANY($${params.length})`; }
  const rows = await q<{
    ad_id: string; name: string | null; segment: string;
    spend: string; actions: Action[];
  }>(
    `SELECT f.ad_id, d.name, f.segment, f.spend, f.actions
     FROM fact_ad_segment_daily f
     LEFT JOIN dim_ad d ON d.account_id = f.account_id AND d.ad_id = f.ad_id
     WHERE ${where}`,
    params,
  );
  if (rows.length === 0) return null;

  // 統合名（名寄せ）×セグメントに集計
  const byCreative = new Map<string, Map<string, { spend: number; actions: Map<string, number> }>>();
  for (const r of rows) {
    const name = normalizeAdName(r.name ?? r.ad_id, settings.brandPrefixes);
    if (!byCreative.has(name)) byCreative.set(name, new Map());
    const segs = byCreative.get(name)!;
    const g = segs.get(r.segment) ?? { spend: 0, actions: new Map() };
    g.spend += Number(r.spend) || 0;
    for (const a of r.actions ?? []) g.actions.set(a.action_type, (g.actions.get(a.action_type) ?? 0) + a.value);
    segs.set(r.segment, g);
  }

  // CV群は全体で1つに固定（クリエイティブ間・セグメント間で別種のCVを混ぜない）
  let group: ConversionGroup | null = null;
  outer: for (const g of CONVERSION_PRIORITY) {
    for (const segs of byCreative.values()) {
      for (const s of segs.values()) {
        if (cvOfGroup(s.actions, g) > 0) { group = g; break outer; }
      }
    }
  }

  const keepLimit = cpaLimits(settings).keep;
  // 除外候補の最低消化額。CV0でもこの額に達するまでは「判断保留」で除外候補にしない
  // （少額消化でのCV0は統計的に判断材料にならない＝早計な除外推奨を防ぐ）。
  const cutMinSpend = settings.cutMinSpend ?? keepLimit;
  const creatives: CreativeCross[] = [...byCreative.entries()].map(([name, segs]) => {
    const segRows: CrossSegmentRow[] = [...segs.entries()].map(([segment, g]) => {
      // CV乖離補正: 実CV換算（revive/cut判定・CPAも補正後基準）
      const cv = group ? correctCv(cvOfGroup(g.actions, group), settings) : 0;
      return { segment, spend: Math.round(g.spend), cv, cpa: cv > 0 ? Math.round(g.spend / cv) : null };
    }).sort((a, b) => b.spend - a.spend);

    const spend = segRows.reduce((s, r) => s + r.spend, 0);
    // 補正で小数になるため合算後に1桁へ丸め（浮動小数の桁ゴミをプロンプトに出さない）
    const cv = Math.round(segRows.reduce((s, r) => s + r.cv, 0) * 10) / 10;
    const cpa = cv > 0 ? Math.round(spend / cv) : null;

    // ギャップ検出（CVが取れている場合のみ）
    const overallBad = group != null && (cpa == null || cpa > keepLimit);
    const overallGood = group != null && cpa != null && cpa <= keepLimit;
    const reviveSegments = overallBad
      ? segRows.filter((r) => r.spend >= MIN_SEGMENT_SPEND && r.cv >= 1 && r.cpa != null && r.cpa <= keepLimit).map((r) => r.segment)
      : [];
    const cutSegments = overallGood
      ? segRows.filter((r) => r.cv === 0 && r.spend >= Math.max(cutMinSpend, spend * 0.2)).map((r) => r.segment)
      : [];

    // 表示は上位のみ。ただしギャップ検出に掛かったセグメントは必ず残す
    const keep = new Set([...reviveSegments, ...cutSegments]);
    const top = segRows.filter((r, i) => i < MAX_SEGMENTS_PER_CREATIVE || keep.has(r.segment));
    const rest = segRows.filter((r) => !top.includes(r));
    if (rest.length > 0) {
      const rSpend = rest.reduce((s, r) => s + r.spend, 0);
      const rCv = Math.round(rest.reduce((s, r) => s + r.cv, 0) * 10) / 10;
      top.push({ segment: `（他${rest.length}${dimension === 'age_gender' ? '区分' : '配置'}まとめ）`, spend: rSpend, cv: rCv, cpa: rCv > 0 ? Math.round(rSpend / rCv) : null });
    }
    return { name, spend, cv, cpa, segments: top, reviveSegments, cutSegments };
  });

  // 消化額上位＋ギャップ候補を優先して上限件数に絞る
  creatives.sort((a, b) => b.spend - a.spend);
  const flagged = creatives.filter((c) => c.reviveSegments.length > 0 || c.cutSegments.length > 0);
  const picked = [...new Set([...flagged, ...creatives])].slice(0, MAX_CREATIVES);
  picked.sort((a, b) => b.spend - a.spend);

  return {
    dimension,
    dimensionLabel: CROSS_DIMENSION_LABELS[dimension] ?? dimension,
    cvAvailable: group != null,
    conversionLabel: group?.label ?? null,
    keepCpaLimit: Math.round(keepLimit),
    cutMinSpend: Math.round(cutMinSpend),
    creatives: picked,
  };
}

/**
 * 全クロス次元（配置・年齢×性別）をまとめて集計する。
 * データが無い次元は落として返すため、age_gender 未バックフィルのアカウントでも従来どおり動く。
 */
export async function buildAllCreativeCrosses(
  account: string,
  since: string | null,
  until: string | null,
  settings: ScoringSettings,
  filter?: CrossFilter | null,
): Promise<CreativeCrossResult[]> {
  const results = await Promise.all(
    CROSS_DIMENSIONS.map((d) =>
      buildCreativeCross(account, since, until, settings, filter, d).catch(() => null),
    ),
  );
  return results.filter((r): r is CreativeCrossResult => r != null);
}
