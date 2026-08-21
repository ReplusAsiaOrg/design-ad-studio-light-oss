export type AspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | 'custom';
export type StandardAspectRatio = Exclude<AspectRatio, 'custom'>;

export const ASPECT_RATIO_DIMENSIONS: Record<StandardAspectRatio, { width: number; height: number }> = {
  '1:1': { width: 1024, height: 1024 },
  '16:9': { width: 1280, height: 720 },
  '9:16': { width: 720, height: 1280 },
  '4:3': { width: 1024, height: 768 },
  '3:4': { width: 768, height: 1024 },
};

/** カスタムサイズの許容範囲（px）。sharpの暴発と極端な生成くずれを防ぐ */
export const CUSTOM_SIZE_MIN = 100;
export const CUSTOM_SIZE_MAX = 4000;

/** カスタム指定が有効か（aspectRatio='custom' かつ幅・高さが範囲内） */
export function hasValidCustomSize(f: { aspectRatio: AspectRatio; customWidth?: number; customHeight?: number }): f is { aspectRatio: 'custom'; customWidth: number; customHeight: number } {
  return (
    f.aspectRatio === 'custom' &&
    typeof f.customWidth === 'number' && typeof f.customHeight === 'number' &&
    f.customWidth >= CUSTOM_SIZE_MIN && f.customWidth <= CUSTOM_SIZE_MAX &&
    f.customHeight >= CUSTOM_SIZE_MIN && f.customHeight <= CUSTOM_SIZE_MAX
  );
}

/** 最終的なバナー寸法。custom は指定px、無効なcustomは1:1にフォールバック */
export function getBannerDimensions(f: { aspectRatio: AspectRatio; customWidth?: number; customHeight?: number }): { width: number; height: number } {
  if (f.aspectRatio === 'custom') {
    if (hasValidCustomSize(f)) return { width: f.customWidth, height: f.customHeight };
    return ASPECT_RATIO_DIMENSIONS['1:1'];
  }
  return ASPECT_RATIO_DIMENSIONS[f.aspectRatio];
}

/** custom を縦横比が最も近い標準比率に落とす（Gemini等、標準比率しか受けないAPI用） */
export function nearestStandardAspect(f: { aspectRatio: AspectRatio; customWidth?: number; customHeight?: number }): StandardAspectRatio {
  if (f.aspectRatio !== 'custom') return f.aspectRatio;
  const { width, height } = getBannerDimensions(f);
  const ratio = width / height;
  const candidates = Object.entries(ASPECT_RATIO_DIMENSIONS) as [StandardAspectRatio, { width: number; height: number }][];
  let best: StandardAspectRatio = '1:1';
  let bestDiff = Infinity;
  for (const [key, d] of candidates) {
    const diff = Math.abs(d.width / d.height - ratio);
    if (diff < bestDiff) { bestDiff = diff; best = key; }
  }
  return best;
}

// DesignElement用（Konvaレンダリング用 — 現在未使用）
export type DecorationStyle = 'none' | 'ribbon' | 'badge' | 'highlight' | 'arrow' | 'circle';

// extraTexts用（AIプロンプト生成時の装飾指示に使用）
export type TextDecoration = 'none' | 'auto' | 'button' | 'badge' | 'ribbon' | 'circle' | 'annotation';

export interface DesignElement {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  color: string;
  rotation: number;
  letterSpacing: number;
  decoration: DecorationStyle;
  decorationColor: string;
  stroke: boolean;
  strokeColor: string;
  strokeWidth: number;
  shadow: boolean;
  shadowColor: string;
}

export interface DesignPlan {
  elements: DesignElement[];
}

export type FontStyle = 'auto' | 'gothic' | 'mincho' | 'rounded-gothic' | 'light-mincho' | 'handwritten';
export type ImageEngine = 'gemini' | 'openai' | 'nano-pro' | 'gpt-image-2';

export interface BannerFormData {
  engine: ImageEngine;
  mainText: string;
  subText: string;
  subTextDecoration?: TextDecoration;
  extraTexts: { id: string; text: string; decoration?: TextDecoration }[];
  mainColor: string;
  aspectRatio: AspectRatio;
  /** aspectRatio='custom' のときの最終出力サイズ（px）。近い比率で生成→中央クロップで正確に合わせる */
  customWidth?: number;
  customHeight?: number;
  fontStyle: FontStyle;
  /** @deprecated personMode に移行中。後方互換のため残す（personMode 未指定時のフォールバック） */
  hasPersons: boolean;
  /**
   * 人物の扱い。
   * - 'yes': 人物を含める
   * - 'none': 人物を明示的に除外（「なし」が文字通り効く）
   * - 'auto': 指示を出さずAI判断
   * 未指定時は hasPersons から ('yes' | 'auto') にフォールバックする。
   */
  personMode?: 'none' | 'yes' | 'auto';
  customPrompt: string;
  referenceImageBase64?: string;
  /**
   * 参照画像の使い方:
   * - 'style': 配色・トーン・構図リズムだけ借りる（物はコピーしない）
   * - 'asset': 添付の被写体（商品/人物/書籍）をそのまま素材として使い、レイアウトは再構成
   * - 'clone': 添付画像をそのまま土台に、コピー文言だけ差し替える（勝ちフォーマット直系の編集）
   */
  referenceImageMode?: 'style' | 'asset' | 'clone';
  /**
   * clone（勝ちフォーマット直系・編集）で「何を1軸だけ変えるか」。
   * - 'copy'      : コピー文言を差し替える（書籍・レイアウト・配色は維持）＝既定
   * - 'season'    : コピーは据え置き、背景と装飾の色を季節パレットに替える（variationDetail=季節名）
   * - 'taste'     : コピー・レイアウトは据え置き、画風（テイスト）ごと描き直す（variationDetail=画風の説明）
   * - 'background': コピー・書籍は据え置き、背景パターン/シーンを替える（variationDetail=指示）
   * 汎用: 季節性が強い商材は'season'が効くが、他案件は'taste'/'background'/'copy'を選べる。
   */
  variationAxis?: 'copy' | 'season' | 'taste' | 'background';
  /** variationAxis の具体指定（季節名 / 画風 / 背景指示など）。 */
  variationDetail?: string;
  /** true なら人物も別人に描き換える（配置・役割・感情は維持。見た目替え枠のチェックボックス） */
  variationSwapPersons?: boolean;
  referenceUrl?: string;
  logoImageBase64?: string;
  logoPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

/**
 * /api/generate のモード。
 * - 未指定: 既存通り engine 別の最適経路で生成（buildGptImage2Prompt または buildOpenAIPrompt）
 * - 'winning-strict': 「勝ち分析再現」用。engine に関わらず buildOpenAIPrompt 経路を強制し、
 *   末尾に「テキスト1回限り / zone跨ぎ禁止 / CTA重複禁止」の Forbidden ブロックを追加する。
 */
export type GenerateMode = 'winning-strict';

export interface GenerateRequest {
  formData: BannerFormData;
  mode?: GenerateMode;
}

export interface GenerateResponse {
  imageBase64: string;
  designPlan: DesignPlan;
  error?: string;
}

// URL自動バナー生成用
export interface ScrapedPageData {
  url: string;
  title: string;
  description: string;
  ogImage?: string;
  heroImageUrls: string[];
  heroTexts: string[];
  headings: string[];
  ctaTexts: string[];
  bodyTextSummary: string;
  primaryColors: string[];
}

export interface BannerConcept {
  id: string;
  angle: string;
  mainText: string;
  subText: string;
  extraTexts: { text: string; decoration?: TextDecoration }[];
  mainColor: string;
  customPrompt: string;
  hasPersons: boolean;
  selected: boolean;
  imageBase64?: string;
  isGenerating: boolean;
  error?: string;
  /** 広告審査NG表現の検出結果（Issue #31。サーバー側 checkAdPolicy の結果を同梱） */
  policyWarnings?: import('./ad-policy').PolicyHit[];
}

// バリエーション作成用
/**
 * バリエーション生成時の用途プリセット。「最低1つは指定カテゴリから出す」を保証する。
 * - auto: AI おまかせ（カテゴリ縛りなし）
 * - serious: B2B / 経営者向け → Serious/Premium カテゴリ必須
 * - soft:    化粧品・物販     → Soft/Friendly カテゴリ必須
 * - bold:    イベント・ローンチ → Bold/Energetic カテゴリ必須
 */
export type VariationCategory = 'auto' | 'serious' | 'soft' | 'bold';

export interface BannerAnalysis {
  mainText: string;
  subText: string;
  extraTexts: { text: string; decoration?: TextDecoration }[];
  primaryColors: string[];
  hasPersons: boolean;
  /** 画像から推定した業種・主旨（日本語、1-2文）。スタイル生成プロンプトの文脈用 */
  contextSummary: string;
  /** 画像内容から推定した用途カテゴリ（ユーザーが手動上書きしなければ採用される） */
  suggestedCategory: VariationCategory;
}

export interface VariationStyle {
  /** 「コーポレートプレミアム」等の日本語名 */
  name: string;
  /** 配色を示すHexコード配列（先頭がメインカラー） */
  paletteHex: string[];
  /** 1-2行の日本語説明（カードに表示） */
  descriptionJa: string;
  /** 画像生成AIに渡す英語の design direction */
  customPrompt: string;
  /** このスタイルで人物を含めるか（バリエーションごとに AI が判断） */
  hasPersons: boolean;
}

export interface Variation extends VariationStyle {
  id: string;
  imageBase64?: string;
  isGenerating: boolean;
  error?: string;
}

// 勝ち分析再現用
/**
 * 勝ちCR画像から抽出した3観点の分析結果。
 * 「効いている要素」を言語化し、再現プロンプトの土台にする。
 */
export interface WinningAnalysis {
  /** ビジュアル要素 */
  visual: {
    /** 配色とコントラストの特徴（日本語1-2文） */
    colorContrast: string;
    /** レイアウト構成（日本語1-2文） */
    layout: string;
    /** フォントの印象（日本語1-2文） */
    typography: string;
    /** 視線誘導の流れ（日本語1-2文） */
    eyeFlow: string;
    /** 主要色のHexコード（2-4色） */
    paletteHex: string[];
  };
  /** メッセージ要素 */
  message: {
    /** キャッチコピーの訴求軸（日本語1-2文） */
    appealAxis: string;
    /** ターゲットに刺さっているポイント（日本語1-2文） */
    hookPoint: string;
    /** CTAの文言と配置（日本語1-2文） */
    cta: string;
    /** 画像から読み取った原文テキスト */
    mainText: string;
    subText: string;
    extraTexts: { text: string; decoration?: TextDecoration }[];
  };
  /** 心理的トリガー */
  psychology: {
    /** 検出されたトリガー（複数可）。日本語名 */
    triggers: WinningTrigger[];
    /** 全体としてのトリガー設計の要約（日本語1-2文） */
    summary: string;
  };
  /** 推定される業種・対象（日本語1文。プロンプト文脈用） */
  contextSummary: string;
  /** 勝ちパターンの総括（5パターン生成時のベースラインとなる日本語2-3文） */
  winningPattern: string;
  hasPersons: boolean;
  /**
   * 勝ちフォーマットの詳細構造記述（英語、画像生成AI用の青写真）。
   * Tier A（勝ちフォーマット直系・コピーだけAB）の customPrompt 土台として使う。
   * zone 構造・配色・モチーフ・人物配置・CTA形状などを画像AIが再現できるレベルで記述する。
   */
  formatBlueprint: string;
  /** 元CRの画風（winning-tastes.ts の TASTE_CATALOG キー、該当なしは 'other'） */
  currentTaste?: string;
  /** テイスト替え3枠へのAI推薦（TASTE_CATALOGキー×3。元の画風と明確に異なるもの・印象差が大きい順） */
  tasteSuggestions?: string[];
}

/** 心理トリガーの種別 */
export type WinningTriggerKind =
  | 'scarcity'        // 希少性
  | 'social-proof'    // 社会的証明
  | 'authority'       // 権威性
  | 'loss-aversion'   // 損失回避
  | 'anchoring'       // アンカリング
  | 'urgency'         // 緊急性
  | 'reciprocity'     // 返報性
  | 'curiosity'       // 好奇心
  | 'other';

export interface WinningTrigger {
  /** トリガー種別 */
  kind: WinningTriggerKind;
  /** 日本語ラベル（例: 「希少性」） */
  label: string;
  /** どこにどう効いているかの根拠（日本語1-2文） */
  evidence: string;
}

/**
 * レイアウト軸。5案を視覚的に差別化するため強制的に別々の軸を割り当てる。
 * - split-comparison: 左右分割（他社 vs 自社、Before/After 等の意味的対比）
 * - centered-hero: 中央集中（ヒーロー要素＋CTA。最も汎用的）
 * - asymmetric-text-left: 左寄せ大コピー＋右側にビジュアル
 * - full-bleed-photo: 写真全面＋オーバーレイで文字を重ねる
 * - stacked-typographic: タイポ主役の縦三段（写真控えめ）
 */
export type LayoutAxis =
  | 'split-comparison'
  | 'centered-hero'
  | 'asymmetric-text-left'
  | 'full-bleed-photo'
  | 'stacked-typographic';

/**
 * 勝ちパターンを踏襲した新規構成案。
 * Tier A は勝ちフォーマット直系（同レイアウト・コピーAB）、
 * Tier B は DNA継承・別レイアウト展開（Meta多様性スコア向上用）。
 */
export type WinningTier = 'A' | 'B';

/**
 * 勝ち分析再現タブの2モード。実物アセットの扱いが正反対。
 * - 'same-project'  : 同プロジェクト改善。商材が同じ＝実物を1pxも変えず保持（clone編集）。流用するのはコピー/季節色など"1軸"。
 * - 'cross-project' : 別プロジェクト流用。商材が違う＝流用元の実物画像は土台にしない（盗用事故防止）。
 *                     流用するのは勝ち"構造"だけ（formatBlueprint/配色ロジック/心理トリガー）。出力は流用先の商材・コピー・配色で再構築。
 */
export type WinningStudioMode = 'same-project' | 'cross-project';

/** cross-project（別プロジェクト流用）で流用先プロジェクトの文脈を伝える。 */
export interface DestinationBrief {
  /** 流用先アカウントID（act_...）。任意。 */
  accountId?: string;
  /** 流用先のブランド名（カード/コピー生成の文脈に使う） */
  name?: string;
  /** 流用先の商材・ブランドの説明（コピー生成のステアリング用・編集可能） */
  brief?: string;
  /** 流用先ブランドの配色（Hex配列）。mainColor のステアリングに使う。 */
  paletteHex?: string[];
  /** 流用先の商材画像が参照として添付されているか（プロンプト分岐用）。 */
  hasProductImage?: boolean;
}

export interface WinningConcept {
  id: string;
  /** Tier 区分。A=勝ちフォーマット直系、B=別レイアウト展開 */
  tier: WinningTier;
  /** 訴求軸の日本語名（例: 「希少性強化」「ベネフィット直球」） */
  angle: string;
  /** レイアウト軸。Tier A は元画像のフォーマット踏襲（"format-clone" 固定）、Tier B は分散 */
  layoutAxis: LayoutAxis | 'format-clone';
  /** レイアウト軸の日本語ラベル（カード表示用） */
  layoutLabel: string;
  /** どの「効いている要素」を踏襲・強化したかの説明（日本語1-2文） */
  inheritedFrom: string;
  mainText: string;
  subText: string;
  extraTexts: { text: string; decoration?: TextDecoration }[];
  /** メインカラー（勝ちCRのパレットを基本にしつつバリエーション） */
  mainColor: string;
  /** 画像生成AIに渡す英語のdesign direction */
  customPrompt: string;
  /**
   * Tier A の再現方式。
   * - 'edit': 元の勝ちCR画像をそのまま土台に、コピー（または1軸）だけ差し替える clone 編集（実物・レイアウト維持）
   * Tier B は未指定（別レイアウトを style 継承で新規生成）。
   * ※ 旧 'asset'（被写体を素材として再配置）は、実在の商品/書籍を AI が描き換える事故が起きたため廃止。
   *    実在物を1pxも変えない原則のもと、Tier A は全枠 clone 編集に統一した。
   */
  reproductionMode?: 'edit';
  hasPersons: boolean;
  /**
   * 見た目替え枠（same-project 下段3案）。コピー案・cross-project では未設定。
   * - taste / background: 元画像を土台にした1軸編集（reproductionMode='edit'）
   * - theme: formatBlueprint を骨格にテーマごと描き直す再構築生成（編集ではない）
   * key は winning-tastes.ts の TASTE_CATALOG / BACKGROUND_OPTIONS / THEME_OPTIONS のキー
   * （カードのプルダウンで変更可）。
   * swapPersons: true なら人物も別人に描き換える（編集系のみ。テーマ替えは常に別人）。
   */
  visualVariation?: { axis: 'taste' | 'background' | 'theme'; key: string; swapPersons?: boolean };
  /** 生成結果 */
  imageBase64?: string;
  isGenerating: boolean;
  error?: string;
  /** 広告審査NG表現の検出結果（Issue #31。サーバー側 checkAdPolicy の結果を同梱） */
  policyWarnings?: import('./ad-policy').PolicyHit[];
}
