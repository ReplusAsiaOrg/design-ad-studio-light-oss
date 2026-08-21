import type { CreativeCrossResult } from '@/lib/meta/creative-cross';

/**
 * AI分析（/api/meta/report-insights）と質問チャット（/api/meta/insights-chat）が
 * 共用するプロンプトのデータセクション組み立て。
 * 分析と会話で「AIが見ている数値」を完全に一致させるため、必ずここを経由する。
 */

/** 優先順位ランキング（/api/meta/priority 由来・クライアント側で圧縮済み） */
export interface PriorityPayload {
  settings?: { payoutPerCv?: number; cpaLimits?: { excellent?: number | null; good?: number | null; keep?: number | null; improve?: number | null } };
  conversionLabel?: string | null;
  verdictCounts?: Record<string, number>;
  totalRows?: number;
  rows?: { name: string; spend: number; purchases: number; cpa: number | null; cpaRank: string; spendRank: string; verdict: string; adCount: number }[];
}
/** セグメント別評価（/api/meta/segments 由来） */
export interface SegmentsPayload {
  dimensions?: { label: string; cvAvailable: boolean; conversionLabel: string | null; rows: { segment: string; spend: number; cv: number; cpa: number | null; verdict: string | null; spendRankLabel: string }[] }[];
  /** 入稿判断層（年齢×性別・配置）の★★★/★★ */
  winners?: { dimensionLabel: string; segment: string; verdict: string; cpa: number | null; spend: number; cv: number }[];
  /** スクリーニング層（年齢単独・性別単独）の★★★/★★。これだけで配分を決めさせない */
  screening?: { dimensionLabel: string; segment: string; verdict: string; cpa: number | null; spend: number; cv: number }[];
}

/** 分析・会話リクエストが共通で受け取る集計データ（クライアントが送る） */
export interface InsightsDataBody {
  client?: string;
  rangeLabel?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  summary?: any;
  deltas?: Record<string, number | null | undefined>;
  media?: { key: string; spend: number; cv: number }[];
  placement?: { key: string; spend: number }[];
  age?: { key: string; spend: number; cv: number; clicks: number }[];
  gender?: { key: string; spend: number; cv: number; clicks: number }[];
  winningSummary?: { winnerCount?: number; loserCount?: number; imageWinRate?: number | null; imageTotal?: number; videoWinRate?: number | null; videoTotal?: number };
  topCreatives?: { name: string; cpa: number | null; verdict: string; active?: boolean }[];
  worstCreatives?: { name: string; cpa: number | null; spend: number; active?: boolean }[];
  priority?: PriorityPayload | null;
  segments?: SegmentsPayload | null;
}

const cyen = (n: number | null | undefined) => (n == null ? '—' : `¥${Math.round(n).toLocaleString()}`);

/** 優先順位ランキング（シートv5評価済み）のプロンプトセクション。 */
function prioritySection(p: PriorityPayload | null | undefined): string {
  if (!p?.rows?.length) return '# 優先順位ランキング（評価済みデータ）\n  - データなし（期間内の日次データ未蓄積など）';
  const lim = p.settings?.cpaLimits ?? {};
  const counts = Object.entries(p.verdictCounts ?? {}).map(([k, v]) => `${k} ${v}件`).join(' / ');
  const rows = p.rows.map((r) =>
    `  - 【${r.verdict}】[単価${r.cpaRank}/消化${r.spendRank}] ${r.name}: 広告費${cyen(r.spend)} / 購入${r.purchases} / CPA${cyen(r.cpa)}${r.adCount > 1 ? `（${r.adCount}広告を名寄せ）` : ''}`,
  ).join('\n');
  const omitted = (p.totalRows ?? p.rows.length) - p.rows.length;
  return `# 優先順位ランキング（社内集計シート基準の評価済みデータ。クリエイティブ名寄せ単位・優先順）
- 評価基準: 報酬単価${cyen(p.settings?.payoutPerCv)}/CV（CV種別: ${p.conversionLabel ?? '不明'}）。CPAランク A=${cyen(lim.excellent)}以下 / B=${cyen(lim.good)}以下 / C=${cyen(lim.keep)}以下 / D=${cyen(lim.improve)}以下 / E=それ超
- 総合評価の意味: ★★★優秀=最優先で予算拡大 / ★★良好=継続・増額候補 / ★継続 / 要改善=改善か縮小 / 損切り=停止・差替候補 / 判定不可=消化不足で評価不能
- 総合評価の分布（全${p.totalRows ?? p.rows.length}件）: ${counts}
${rows}${omitted > 0 ? `\n  - （他${omitted}件は優先度が低いため省略）` : ''}`;
}

/** セグメント別評価（内訳★判定）のプロンプトセクション。 */
function segmentsSection(s: SegmentsPayload | null | undefined): string {
  if (!s?.dimensions?.length) return '# セグメント別評価（内訳の★判定）\n  - データなし（内訳の日次データ未蓄積など）';
  const dims = s.dimensions.map((d) => {
    const head = `## ${d.label}${d.cvAvailable ? `（CV種別: ${d.conversionLabel}）` : '（この期間はCVデータ取得不可→★判定なし）'}`;
    const rows = d.rows.map((r) =>
      `  - ${r.segment}: 広告費${cyen(r.spend)} / CV${r.cv} / CPA${cyen(r.cpa)}${r.verdict ? ` / 判定${r.verdict}` : ''}`,
    ).join('\n');
    return `${head}\n${rows || '  - データなし'}`;
  }).join('\n');
  const line = (w: { dimensionLabel: string; segment: string; verdict: string; cpa: number | null; spend: number; cv: number }) =>
    `  - ${w.dimensionLabel}=${w.segment}（${w.verdict}・CPA${cyen(w.cpa)}・広告費${cyen(w.spend)}・CV${w.cv}）`;
  const winners = (s.winners ?? []).map(line).join('\n');
  const screening = (s.screening ?? []).map(line).join('\n');
  // スクリーニング層がある＝掛け合わせ（年齢×性別）が蓄積済み。その場合だけ2層で提示する。
  const screeningSection = (s.screening?.length ?? 0) > 0
    ? `
## スクリーニング（年齢単独・性別単独の★★★/★★）
- 用途: 当たりを付けるための参考値。**この数値だけで配分・絞り込みを指示してはいけない**。
  単独軸は合計値のため、内側に負けセグメントを抱えていることがある
  （例:「65+」全体は★★でも「65+・female」は基準超えのCPA）。
  配分を提案するときは必ず上の「入稿ターゲティング候補」の該当マスを確認し、その数値を根拠に挙げること。
${screening}`
    : '';
  return `# セグメント別評価（性別/年齢/年齢×性別/配置の内訳★判定。★★★=勝ちセグメント・最優先で配分強化 / ★★=良好 / ★継続 / 停止推奨 / 判定不可=消化不足）
${dims}
## 入稿ターゲティング候補（年齢×性別・配置の★★★/★★）
- 絞り込んで入稿する単位はここ。上位から配分を検討する。
${winners || '  - なし'}${screeningSection}`;
}

/** クリエイティブ×セグメントクロス（化ける候補の発掘）のプロンプトセクション。 */
function crossSection(crosses: CreativeCrossResult[]): string {
  if (crosses.length === 0) {
    return '# クリエイティブ×セグメントクロス\n  - データなし（内訳の日次データ未蓄積など）';
  }
  return crosses.map(crossSectionOne).join('\n\n');
}

function crossSectionOne(c: CreativeCrossResult): string {
  const head = `# クリエイティブ×${c.dimensionLabel}クロス`;
  if (!c.cvAvailable) return `${head}\n  - この期間は${c.dimensionLabel}別CVが取得できないため省略（消化のみのデータ）`;
  const lines = c.creatives.map((cr) => {
    const segs = cr.segments.map((s) => {
      const tag = cr.reviveSegments.includes(s.segment) ? ` ←★全体不調でもこの${c.dimensionLabel}は基準内`
        : cr.cutSegments.includes(s.segment) ? ' ←▲消化のみでCV0（除外候補）' : '';
      return `    - ${s.segment}: 広告費${cyen(s.spend)} / CV${s.cv} / CPA${cyen(s.cpa)}${tag}`;
    }).join('\n');
    return `  - ${cr.name}（全体: 広告費${cyen(cr.spend)} / CV${cr.cv} / CPA${cyen(cr.cpa)}）\n${segs}`;
  }).join('\n');
  return `${head}（${c.dimensionLabel}別の実績。CV種別: ${c.conversionLabel}・CPA基準内=${cyen(c.keepCpaLimit)}以下）
- 見方: 全体では不調でも特定の${c.dimensionLabel}ではCPAが基準内なら、そこに絞った再配信で「勝ち」に化ける可能性がある。逆に全体が好調でも消化だけ食ってCV0の${c.dimensionLabel}は除外候補。
- 除外判断の最低消化額: ${cyen(c.cutMinSpend)}。CV0でも消化がこの額未満の${c.dimensionLabel}は「データ不足＝判断保留」であり、除外候補ではない。
${lines}`;
}

/**
 * プロンプトのデータセクション（# 対象 〜 クリエイティブ×セグメントクロス）を組み立てる。
 * 出力ルール・出力フォーマットは呼び出し側（分析/会話）がそれぞれ付ける。
 */
export function buildInsightsDataSections(
  body: InsightsDataBody,
  cross: CreativeCrossResult | CreativeCrossResult[] | null,
  opts?: { cvDeviationPct?: number },
): string {
  const { client, rangeLabel, summary, deltas, media, placement, age, gender, winningSummary, topCreatives, worstCreatives, priority, segments } = body;
  const dev = opts?.cvDeviationPct ?? 0;
  const devNote = dev !== 0
    ? `\n- CV乖離補正: Meta計測CVは実CVと乖離するため、全データのCV/CPA/CVRに補正済み（実CV = Meta CV × ${1 - dev / 100}。乖離率${dev}%）。数値はそのまま実CVとして扱ってよい（CVが小数なのは補正のため）。`
    : '';

  const fmtDelta = (d: number | null | undefined) => (d == null ? '前期比なし' : `前期比${d > 0 ? '+' : ''}${d}%`);
  const mediaLines = (media ?? []).slice(0, 4).map((m) => `  - ${m.key}: 広告費¥${m.spend.toLocaleString()} / CV${m.cv}`).join('\n');
  const placeLines = (placement ?? []).slice(0, 5).map((p) => `  - ${p.key}: ¥${p.spend.toLocaleString()}`).join('\n');
  const GENDER_JA: Record<string, string> = { male: '男性', female: '女性', unknown: '不明' };
  const demoLine = (d: { key: string; spend: number; cv: number; clicks: number }) => {
    const cpa = d.cv > 0 ? `CPA¥${Math.round(d.spend / d.cv).toLocaleString()}` : 'CV0';
    return `広告費¥${d.spend.toLocaleString()} / CV${d.cv} / ${cpa}`;
  };
  const genderLines = (gender ?? []).map((g) => `  - ${GENDER_JA[g.key] ?? g.key}: ${demoLine(g)}`).join('\n');
  const ageLines = (age ?? []).map((a) => `  - ${a.key}: ${demoLine(a)}`).join('\n');
  const st = (active?: boolean) => (active === false ? '【停止中】' : active === true ? '【配信中】' : '');
  const topLines = (topCreatives ?? []).slice(0, 5).map((c) => `  - ${st(c.active)}${c.name}（CPA¥${c.cpa ?? '—'}・${c.verdict}）`).join('\n');
  const worstLines = (worstCreatives ?? []).slice(0, 5).map((c) => `  - ${st(c.active)}${c.name}（CPA¥${c.cpa ?? '—'}・広告費¥${c.spend?.toLocaleString?.() ?? c.spend}）`).join('\n');

  return `# 対象
- クライアント: ${client ?? '(不明)'}
- 期間: ${rangeLabel ?? '(不明)'}
- 主要コンバージョン: ${(summary.conversionLabels ?? []).join('・') || '不明'}${devNote}

# サマリ（カッコ内は前期＝直前の同じ長さの期間との比較）
- 広告費: ¥${summary.spend?.toLocaleString?.() ?? summary.spend}（${fmtDelta(deltas?.spend)}）
- 表示回数: ${summary.impressions?.toLocaleString?.() ?? summary.impressions}（${fmtDelta(deltas?.impressions)}） / CPM: ¥${summary.cpm}（${fmtDelta(deltas?.cpm)}）
- CTR: ${summary.ctr}%（${fmtDelta(deltas?.ctr)}） / クリック: ${summary.clicks?.toLocaleString?.() ?? summary.clicks}（${fmtDelta(deltas?.clicks)}） / CPC: ¥${summary.cpc}（${fmtDelta(deltas?.cpc)}）
- CV: ${summary.cv}（${fmtDelta(deltas?.cv)}） / CVR: ${summary.cvr}%（${fmtDelta(deltas?.cvr)}） / CPA: ¥${summary.cpa ?? '—'}（${fmtDelta(deltas?.cpa)}）
- 配信広告数: ${summary.adCount}（うちCVあり${summary.withCvCount}）

# 媒体別 広告費/CV
${mediaLines || '  - データなし'}

# 配置別 広告費（上位）
${placeLines || '  - データなし'}

# 性別別 広告費/CV/CPA
${genderLines || '  - データなし'}

# 年齢別 広告費/CV/CPA
${ageLines || '  - データなし'}

# クリエイティブの勝ち負け
- 勝ち ${winningSummary?.winnerCount ?? 0} 件 / 負け ${winningSummary?.loserCount ?? 0} 件
- 勝率: 静止画 ${winningSummary?.imageWinRate ?? '—'}%（${winningSummary?.imageTotal ?? 0}件）/ 動画 ${winningSummary?.videoWinRate ?? '—'}%（${winningSummary?.videoTotal ?? 0}件）
- 好調CR:
${topLines || '  - なし'}
- 不調・コスト高CR（見直し候補）:
${worstLines || '  - なし'}

${prioritySection(priority)}

${segmentsSection(segments)}

${crossSection(Array.isArray(cross) ? cross : cross ? [cross] : [])}`;
}
