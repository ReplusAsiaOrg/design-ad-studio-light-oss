/**
 * 「テイスト替え」軸のイラストテイストカタログ。
 * Step2 の勝ちCR分析（/api/analyze-winning）が元画像の画風を判定し、
 * このカタログから「印象差が大きく商材に合う」3つを推薦して Tier A の3枠に割り当てる。
 * 目的: 同コピー・同レイアウトのままぱっと見の印象を一新し、CR疲れを防ぐ。
 */
export interface TasteOption {
  /** 分析AIとやり取りするキー（英語スラッグ） */
  key: string;
  /** カード表示用の日本語ラベル */
  label: string;
  /** 画像生成AIに渡す英語のスタイル指示 */
  prompt: string;
}

export const TASTE_CATALOG: TasteOption[] = [
  {
    key: 'anime',
    label: 'アニメ調',
    prompt: 'Japanese anime / cel-shaded illustration style with clean line art, expressive characters and vivid colors',
  },
  {
    key: 'irasutoya',
    label: 'いらすとや風',
    prompt: 'simple, friendly Japanese flat clipart style (like Irasutoya): soft pastel fills, rounded simplified shapes, minimal facial features, approachable and gentle',
  },
  {
    key: 'flat',
    label: 'フラットイラスト',
    prompt: 'modern flat vector illustration style (corporate / IT-SaaS look): geometric simplified people, solid color blocks, minimal or no outlines, clean and professional',
  },
  {
    key: 'watercolor',
    label: '水彩風',
    prompt: 'soft hand-painted watercolor style with gentle brush strokes, paper texture and pastel bleeding colors',
  },
  {
    key: 'scandinavian',
    label: '北欧風',
    prompt: 'Scandinavian minimal illustration style: muted earthy palette, simple organic shapes, cozy and warm mood',
  },
  {
    key: 'retro-pop',
    label: 'レトロポップ',
    prompt: 'bold retro pop-art / comic style with halftone dots, thick outlines and punchy flat colors',
  },
  {
    key: 'photoreal',
    label: '実写風',
    prompt: 'photorealistic live-action style — replace illustrations with realistic photographic rendering (real-looking people and objects), like a photo-based ad',
  },
];

/** 分析が推薦を返せなかった場合のフォールバック（印象差が出やすい並び） */
export const DEFAULT_TASTE_KEYS = ['photoreal', 'irasutoya', 'retro-pop'];

export function tasteByKey(key: string): TasteOption | undefined {
  return TASTE_CATALOG.find((t) => t.key === key);
}

/**
 * 「背景替え」軸の選択肢カタログ（見た目替えカードのプルダウン用）。
 * いずれも「一目で分かる変化」＋「元画像の明暗ゾーン対比の維持」を明示する。
 */
export const BACKGROUND_OPTIONS: TasteOption[] = [
  {
    key: 'scene',
    label: '別シーン',
    prompt:
      'a COMPLETELY DIFFERENT real-world scene (e.g. room interior, sky, street) — obviously different at a glance, while each zone keeps its original mood (gloomy scene on the dark side, sunny scene on the bright side)',
  },
  {
    key: 'solid',
    label: '単色ポップ',
    prompt:
      'a bold SOLID-COLOR background in a clearly different hue family from the original — use a dark, muted shade on the negative zone and a bright, vivid shade on the positive zone (do NOT use one flat color across both)',
  },
  {
    key: 'pattern',
    label: '柄パターン',
    prompt:
      'a clearly visible decorative PATTERN background (e.g. wide diagonal stripes, polka dots, or confetti) in fresh colors distinct from the original palette, rendered dark & subdued on the negative zone and bright & lively on the positive zone',
  },
];

export function backgroundByKey(key: string): TasteOption | undefined {
  return BACKGROUND_OPTIONS.find((b) => b.key === key);
}

/**
 * 「テーマ替え（作り直し）」の世界観カタログ。
 * 編集（img2img）ではなく、formatBlueprint を骨格に装飾モチーフ・キャラ・背景・
 * フォント処理まで丸ごと新テーマで描き直す。同じ設計思想・同じコピーの「別の広告」を作る。
 */
export const THEME_OPTIONS: TasteOption[] = [
  {
    key: 'retro-game',
    label: 'レトロゲーム風',
    prompt: 'retro pixel-game world: pixelated decorations, GAME OVER screen aesthetics on the negative side, level-up / treasure celebration on the positive side, 8-bit style badges and arcade-style lettering accents',
  },
  {
    key: 'news-flash',
    label: 'ニュース速報風',
    prompt: 'breaking-news TV broadcast theme: news ticker bars, bold headline banner straps, urgent red accents on the negative side, bright relieved morning-show mood on the positive side',
  },
  {
    key: 'manga',
    label: 'マンガ誌面風',
    prompt: 'manga magazine page theme: comic panel frames, speed lines, halftone screentones, dramatic shocked expressions on the negative side, sparkling joyful panels on the positive side',
  },
  {
    key: 'blackboard',
    label: '黒板・学校風',
    prompt: 'school blackboard theme: chalk hand-drawn illustrations and lettering on a dark green board for the negative side, bright notebook / graduation celebration mood on the positive side',
  },
  {
    key: 'neon',
    label: 'ネオン看板風',
    prompt: 'neon sign theme: dim city night with flickering broken neon on the negative side, vividly glowing celebratory neon tubes (cyan/magenta/gold) on the positive side',
  },
  {
    key: 'magazine',
    label: '雑誌表紙風',
    prompt: 'editorial magazine cover theme: clean grid layout, big bold cover lines, monochrome gloomy photo treatment on the negative side, vibrant colorful cover treatment on the positive side',
  },
  {
    key: 'showa-retro',
    label: '昭和レトロ風',
    prompt: 'retro Showa-era Japanese poster theme: vintage typography, aged paper texture, dark old-fashioned mood on the negative side, festive hanamaru / sunburst celebration on the positive side',
  },
];

export function themeByKey(key: string): TasteOption | undefined {
  return THEME_OPTIONS.find((t) => t.key === key);
}

/**
 * テーマ替えカードの customPrompt を組み立てる。
 * formatBlueprint（ゾーン構造の設計図）を骨格に、新テーマで丸ごと再構築させる。
 */
export function buildThemeRemakeDirection(formatBlueprint: string, themePrompt: string): string {
  return [
    formatBlueprint.trim(),
    '',
    `REMAKE DIRECTION: Rebuild the EXACT zone structure above as a COMPLETELY NEW ad in this decorative theme: ${themePrompt}.`,
    'Replace ALL decorative motifs, character artwork, badge shapes, background art and typographic decorations with the new theme — nothing should look copied from the original artwork.',
    'KEEP unchanged: the zone layout and eye-flow, the negative-vs-positive mood contrast (dark & gloomy problem side vs bright & hopeful solution side), a prominent CTA button with a right arrow, and every Japanese copy text exactly as provided.',
    'The result must read as the SAME message and structure, but look like a totally different creative at first glance.',
  ].join('\n');
}
