/**
 * クリエイティブ評価ロジック（「汎用クリエイティブ集計シート v5」準拠）。
 *
 * シートの判定を完全移植したもの。既定値のとき、同じ入力からシートと同じ
 * ランク・総合評価が出ることを scripts/verify-scoring.mjs で検証している。
 *
 * - 名寄せ: 「YYYYMMDD_素材名」「YYMMDD 素材名」→「素材名」に統合（接頭辞も設定で除去可）
 * - CPA上限: 報酬単価 × 100 / ROAS下限(%) から自動計算
 * - 購入単価ランク A〜E / 消化金額ランク A〜D / 総合評価 ★★★優秀〜判定不可
 *
 * 設定はクライアント（アカウント）別に account_settings テーブルで上書きできる。
 * ランクはDBに保存せず表示時に計算する（閾値変更が全期間に即反映されるように）。
 */

export interface ScoringSettings {
  /** 報酬単価(円)。1成果あたりの報酬 */
  payoutPerCv: number;
  /** 名寄せで日付の次に除去するブランド接頭辞（例: ['brandname']） */
  brandPrefixes: string[];
  /** ROAS判定基準(%)。CPA上限 = payoutPerCv * 100 / roasPct */
  roasPct: { excellent: number; good: number; keep: number; improve: number };
  /** 消化金額ランク境界(円)・広告単体系 */
  spendRank: { a: number; b: number; c: number };
  /** 消化金額ランク境界(円)・内訳系（性年齢/配置） */
  spendRankBreakdown: { a: number; b: number; c: number };
  /** ★判定に必要な消化下限(円)・内訳系（AND条件） */
  starSpendMin: { s3: number; s2: number };
  /** 勝ち抽出フィルタ */
  winFilter: { roasMinPct: number; minPurchases: number };
  /**
   * 配置「除外候補」判定に必要な最低消化額(円)。CV0でもこの額に達するまでは
   * 「判断保留（データ不足）」とし、AI分析でも除外を推奨しない。
   * null = CPA基準（★継続ライン = 報酬単価×100/ROAS基準keep）に自動連動。
   */
  cutMinSpend: number | null;
  /**
   * CV乖離率(%)。Meta計測CVと実CVの乖離を補正する: 実CV = Meta CV × (1 − 乖離率/100)。
   * 例: MetaのCVが実際より2割多い → 20。Metaが少なく出る場合は負値（例: -25 → ×1.25）。
   * 0 = 補正なし。表示・ランク判定・AI分析のCV/CPAすべてに適用される。
   */
  cvDeviationPct: number;
}

/** シートのSETTINGS既定値そのまま */
export const DEFAULT_SCORING_SETTINGS: ScoringSettings = {
  payoutPerCv: 10000,
  brandPrefixes: [],
  roasPct: { excellent: 200, good: 150, keep: 100, improve: 75 },
  spendRank: { a: 200000, b: 50000, c: 20000 },
  spendRankBreakdown: { a: 50000, b: 20000, c: 10000 },
  starSpendMin: { s3: 100000, s2: 30000 },
  winFilter: { roasMinPct: 100, minPurchases: 1 },
  cutMinSpend: null,
  cvDeviationPct: 0,
};

/** CV乖離率 → 補正係数（実CV = Meta CV × 係数）。 */
export function cvCorrectionFactor(s: ScoringSettings): number {
  const pct = s.cvDeviationPct ?? 0;
  return pct === 0 ? 1 : 1 - pct / 100;
}

/** Meta計測CV → 実CV換算（乖離補正・小数1桁）。補正なしなら値そのまま。 */
export function correctCv(cv: number, s: ScoringSettings): number {
  const f = cvCorrectionFactor(s);
  return f === 1 ? cv : Math.round(cv * f * 10) / 10;
}

/** ROAS基準から逆算したCPA上限(円) */
export function cpaLimits(s: ScoringSettings): {
  excellent: number; good: number; keep: number; improve: number;
} {
  const limit = (pct: number) => (pct > 0 ? (s.payoutPerCv * 100) / pct : Infinity);
  return {
    excellent: limit(s.roasPct.excellent),
    good: limit(s.roasPct.good),
    keep: limit(s.roasPct.keep),
    improve: limit(s.roasPct.improve),
  };
}

/**
 * 名寄せ: 広告名 → 統合名（クリエイティブ名）。
 * 先頭の日付トークン（8桁 YYYYMMDD / 6桁 YYMMDD ＋区切り _ または空白）を除去し、
 * 続けてブランド接頭辞（接頭辞_）があれば除去する。
 * 9桁等の日付でない数字（例: 202500902_）は除去しない（シート準拠）。
 */
export function normalizeAdName(raw: string, brandPrefixes: string[] = []): string {
  let name = raw.trim();
  const m = name.match(/^(\d{8}|\d{6})[_\s]+/);
  if (m) name = name.slice(m[0].length);
  for (const p of brandPrefixes) {
    const prefix = p.trim();
    if (!prefix) continue;
    if (name.startsWith(`${prefix}_`)) {
      name = name.slice(prefix.length + 1);
      break;
    }
  }
  name = name.trim();
  return name || raw.trim();
}

/**
 * 入稿用名称の生成（normalizeAdName の逆変換）: 「YYYYMMDD_[接頭辞_]素材名」。
 * 生成した名称は normalizeAdName で必ず元の素材名に戻る（名寄せが壊れない）ことを
 * scripts/verify-scoring.mjs でラウンドトリップ検証している。
 * date は 'YYYYMMDD' または 'YYYY-MM-DD' を受け付ける。
 */
export function buildAdName(
  materialName: string,
  opts: { date?: string; brandPrefix?: string } = {},
): string {
  const ymd = (opts.date ?? '').replaceAll('-', '');
  if (!/^\d{8}$/.test(ymd)) throw new Error(`日付は YYYYMMDD / YYYY-MM-DD で指定してください: ${opts.date}`);
  const prefix = opts.brandPrefix?.trim();
  const material = materialName.trim();
  return prefix ? `${ymd}_${prefix}_${material}` : `${ymd}_${material}`;
}

export type CpaRank = 'A' | 'B' | 'C' | 'D' | 'E' | '-';
export type SpendRank = 'A' | 'B' | 'C' | 'D';
export type Verdict = '★★★優秀' | '★★良好' | '★継続' | '要改善' | '損切り' | '判定不可';

/** 購入単価ランク。CV=0（CPAなし）は「-」 */
export function cpaRank(cpa: number | null, s: ScoringSettings): CpaRank {
  if (cpa == null) return '-';
  const L = cpaLimits(s);
  if (cpa <= L.excellent) return 'A';
  if (cpa <= L.good) return 'B';
  if (cpa <= L.keep) return 'C';
  if (cpa <= L.improve) return 'D';
  return 'E';
}

/** 消化金額ランク（データ量の担保）。bounds は 単体系/内訳系 のどちらかを渡す */
export function spendRankOf(spend: number, bounds: { a: number; b: number; c: number }): SpendRank {
  if (spend >= bounds.a) return 'A';
  if (spend >= bounds.b) return 'B';
  if (spend >= bounds.c) return 'C';
  return 'D';
}

function fmtYen(n: number): string {
  return n % 10000 === 0 ? `${n / 10000}万` : `${n.toLocaleString('ja-JP')}円`;
}

/** シート表記のランクラベル（例: A（20万以上）/ D（2万未満）） */
export function spendRankLabel(rank: SpendRank, bounds: { a: number; b: number; c: number }): string {
  switch (rank) {
    case 'A': return `A（${fmtYen(bounds.a)}以上）`;
    case 'B': return `B（${fmtYen(bounds.b)}以上）`;
    case 'C': return `C（${fmtYen(bounds.c)}以上）`;
    case 'D': return `D（${fmtYen(bounds.c)}未満）`;
  }
}

/**
 * 総合評価（広告単体系）。
 * 消化が判定不可ライン未満 → 判定不可 / 購入0 → 損切り / 以降はCPA上限で段階評価。
 */
export function overallVerdict(
  spend: number,
  purchases: number,
  cpa: number | null,
  s: ScoringSettings,
): Verdict {
  if (spend < s.spendRank.c) return '判定不可';
  if (purchases <= 0 || cpa == null) return '損切り';
  const L = cpaLimits(s);
  if (cpa <= L.excellent) return '★★★優秀';
  if (cpa <= L.good) return '★★良好';
  if (cpa <= L.keep) return '★継続';
  if (cpa <= L.improve) return '要改善';
  return '損切り';
}

export type SegmentVerdict = '★★★' | '★★' | '★継続' | '停止推奨' | '判定不可';

/**
 * 総合評価（性年齢・配置の内訳系）。Phase 1cの勝ちセグメント抽出で使用。
 * ★★★: 単価≤優秀 AND 消化≥下限優秀 / ★★: ≤良好 AND ≥下限良好 / ★継続: ≤継続 / 他は停止推奨。
 */
export function segmentVerdict(
  spend: number,
  purchases: number,
  cpa: number | null,
  s: ScoringSettings,
): SegmentVerdict {
  if (spend < s.spendRankBreakdown.c) return '判定不可';
  if (purchases <= 0 || cpa == null) return '停止推奨';
  const L = cpaLimits(s);
  if (cpa <= L.excellent && spend >= s.starSpendMin.s3) return '★★★';
  if (cpa <= L.good && spend >= s.starSpendMin.s2) return '★★';
  if (cpa <= L.keep) return '★継続';
  return '停止推奨';
}

// ---- 優先順位集計（OUT_優先順位 相当） ----

export interface AdMetricInput {
  name: string;
  reach: number;
  purchases: number;
  spend: number;
  impressions?: number;
  clicks?: number;
  adId?: string;
}

export interface PriorityRow {
  /** 統合名（名寄せ後のクリエイティブ名） */
  integratedName: string;
  reach: number;
  purchases: number;
  spend: number;
  impressions: number;
  clicks: number;
  /** 消化金額合計 ÷ 購入数合計。購入0ならnull */
  cpa: number | null;
  /** 購入数 ÷ リーチ (%)。シート準拠のリーチベースCVR */
  cvr: number | null;
  /** 1件獲得リーチ数 */
  reachPerPurchase: number | null;
  cpaRank: CpaRank;
  spendRank: SpendRank;
  spendRankLabel: string;
  verdict: Verdict;
  /** 統合された元広告の数と広告ID（サムネ紐付け用） */
  adCount: number;
  adIds: string[];
}

const VERDICT_ORDER: Verdict[] = ['★★★優秀', '★★良好', '★継続', '要改善', '損切り', '判定不可'];
const RANK_ORDER: CpaRank[] = ['-', 'A', 'B', 'C', 'D', 'E'];

/**
 * 広告単位の実績 → 名寄せ集計 → ランク付け → シートと同じ優先順に並べて返す。
 * 並び: 総合評価 → 購入単価ランク（-が先頭） → CPA昇順 → 消化金額降順。
 */
export function buildPriorityRows(
  ads: AdMetricInput[],
  settings: ScoringSettings = DEFAULT_SCORING_SETTINGS,
): PriorityRow[] {
  const groups = new Map<string, { reach: number; purchases: number; spend: number; impressions: number; clicks: number; adIds: string[] }>();
  for (const ad of ads) {
    const key = normalizeAdName(ad.name, settings.brandPrefixes);
    const g = groups.get(key) ?? { reach: 0, purchases: 0, spend: 0, impressions: 0, clicks: 0, adIds: [] };
    g.reach += ad.reach || 0;
    g.purchases += ad.purchases || 0;
    g.spend += ad.spend || 0;
    g.impressions += ad.impressions || 0;
    g.clicks += ad.clicks || 0;
    if (ad.adId) g.adIds.push(ad.adId);
    groups.set(key, g);
  }

  const rows: PriorityRow[] = [...groups.entries()].map(([name, g]) => {
    const cpa = g.purchases > 0 ? g.spend / g.purchases : null;
    const rank = spendRankOf(g.spend, settings.spendRank);
    return {
      integratedName: name,
      reach: g.reach,
      purchases: g.purchases,
      spend: g.spend,
      impressions: g.impressions,
      clicks: g.clicks,
      cpa,
      cvr: g.reach > 0 ? (g.purchases / g.reach) * 100 : null,
      reachPerPurchase: g.purchases > 0 ? g.reach / g.purchases : null,
      cpaRank: cpaRank(cpa, settings),
      spendRank: rank,
      spendRankLabel: spendRankLabel(rank, settings.spendRank),
      verdict: overallVerdict(g.spend, g.purchases, cpa, settings),
      adCount: g.adIds.length || 1,
      adIds: g.adIds,
    };
  });

  rows.sort((x, y) => {
    const v = VERDICT_ORDER.indexOf(x.verdict) - VERDICT_ORDER.indexOf(y.verdict);
    if (v !== 0) return v;
    const r = RANK_ORDER.indexOf(x.cpaRank) - RANK_ORDER.indexOf(y.cpaRank);
    if (r !== 0) return r;
    // CPAなし（null）同士は消化金額降順へ。Infinity同士の減算はNaNになるため明示比較
    const cx = x.cpa ?? Infinity;
    const cy = y.cpa ?? Infinity;
    if (cx !== cy) return cx < cy ? -1 : 1;
    return y.spend - x.spend;
  });
  return rows;
}
