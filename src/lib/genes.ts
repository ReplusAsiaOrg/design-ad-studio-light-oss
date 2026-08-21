/**
 * CreativeTraits v1 — 勝ちパターン分析用のクリエイティブ分類語彙（Ad Studio Light 独自設計）。
 *
 * 日本のダイレクトレスポンス広告の運用現場で使う訴求分類をもとに、
 * 「CPA成果と掛け合わせて集計できること」を優先して次元と値を選定している。
 * 分類は vision LLM が行い、この語彙に厳密一致しない応答は破棄する（閉じた語彙）。
 *
 * 次元を増減する場合はここだけ変えれば、分類プロンプト・検証・集計・表示ラベルが
 * すべて追従する（TRAIT_VOCABULARY が単一の情報源）。
 */

export const TRAIT_VOCABULARY = {
  hooks: {
    label: 'フック（訴求）',
    values: {
      discount: 'お得・割引',
      limited: '限定・締切',
      results: '実績・数字',
      testimonial: '口コミ・体験談',
      empathy: '悩み共感',
      before_after: 'ビフォーアフター',
      know_how: 'ノウハウ提示',
      surprise: '意外性・ギャップ',
    },
  },
  impression: {
    label: '印象',
    values: {
      trust: '誠実・信頼感',
      friendly: '親しみやすい',
      aggressive: '強め・煽り',
      elegant: '上品・洗練',
      lively: '明るい・にぎやか',
    },
  },
  visualFocus: {
    label: 'ビジュアル主役',
    values: {
      person_face: '人物（顔・表情）',
      person_scene: '人物（利用シーン）',
      product_shot: '商品カット',
      text_design: '文字・図解主体',
      illustration: 'イラスト・漫画',
      comparison: '比較・対比',
    },
  },
  palette: {
    label: '色使い',
    values: {
      warm: '暖色系',
      cool: '寒色系',
      high_contrast: '高コントラスト',
      soft: '淡色・やわらか',
      colorful: '多色・カラフル',
    },
  },
  composition: {
    label: 'レイアウト',
    values: {
      center_hero: '中央主役',
      headline_top: '見出し上部',
      split_lr: '左右分割',
      multi_block: '複数ブロック',
      full_photo: '写真全面',
    },
  },
  textAmount: {
    label: '文字量',
    values: {
      none: '文字なし',
      accent: 'ワンポイント',
      heavy: '文字たっぷり',
    },
  },
  language: {
    label: '言語',
    values: {
      ja: '日本語',
      en: '英語',
      mixed: '混在',
    },
  },
} as const;

export type TraitDimension = keyof typeof TRAIT_VOCABULARY;
export type TraitValue<D extends TraitDimension> =
  keyof (typeof TRAIT_VOCABULARY)[D]['values'] & string;

export interface CreativeTraits {
  schemaVersion: 1;
  /** 訴求フック。1〜2個・支配的なものが先頭。 */
  hooks: TraitValue<'hooks'>[];
  impression: TraitValue<'impression'>;
  visualFocus: TraitValue<'visualFocus'>;
  palette: TraitValue<'palette'>;
  composition: TraitValue<'composition'>;
  textAmount: TraitValue<'textAmount'>;
  /** 申込ボタン・行動喚起の導線が見えるか。 */
  hasCta: boolean;
  language: TraitValue<'language'>;
}

/** 勝ち/負けパターン集計に使う次元（language は分析価値が薄いので除外）。 */
export const TRAIT_AGG_DIMENSIONS = [
  'hooks',
  'impression',
  'visualFocus',
  'palette',
  'composition',
  'textAmount',
] as const satisfies readonly TraitDimension[];

export function traitDimensionLabel(dim: TraitDimension): string {
  return TRAIT_VOCABULARY[dim].label;
}

const VALUE_LABELS: Record<string, string> = Object.fromEntries(
  Object.values(TRAIT_VOCABULARY).flatMap((d) => Object.entries(d.values)),
);

/** 語彙値 → 日本語ラベル（未知の値はそのまま返す）。 */
export function traitLabel(value: string): string {
  return VALUE_LABELS[value] ?? value;
}

function pickValue<D extends TraitDimension>(dim: D, v: unknown): TraitValue<D> | null {
  if (typeof v !== 'string') return null;
  return v in TRAIT_VOCABULARY[dim].values ? (v as TraitValue<D>) : null;
}

/** 閉じた語彙に厳密一致するかを検証し、外れていれば null を返す。 */
export function parseCreativeTraits(value: unknown): CreativeTraits | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const src = value as Record<string, unknown>;
  if (src.schemaVersion !== 1) return null;

  if (!Array.isArray(src.hooks) || src.hooks.length < 1 || src.hooks.length > 2) return null;
  const hooks: TraitValue<'hooks'>[] = [];
  for (const h of src.hooks) {
    const v = pickValue('hooks', h);
    if (!v || hooks.includes(v)) return null;
    hooks.push(v);
  }

  const impression = pickValue('impression', src.impression);
  const visualFocus = pickValue('visualFocus', src.visualFocus);
  const palette = pickValue('palette', src.palette);
  const composition = pickValue('composition', src.composition);
  const textAmount = pickValue('textAmount', src.textAmount);
  const language = pickValue('language', src.language);
  if (!impression || !visualFocus || !palette || !composition || !textAmount || !language) {
    return null;
  }
  if (typeof src.hasCta !== 'boolean') return null;

  return {
    schemaVersion: 1,
    hooks,
    impression,
    visualFocus,
    palette,
    composition,
    textAmount,
    hasCta: src.hasCta,
    language,
  };
}

/** 生成プロンプトに埋め込む1行サマリ（例: フック=悩み共感・実績、印象=誠実…）。 */
export function describeTraitsForPrompt(t: CreativeTraits): string {
  return [
    `${traitDimensionLabel('hooks')}=${t.hooks.map(traitLabel).join('・')}`,
    `${traitDimensionLabel('impression')}=${traitLabel(t.impression)}`,
    `${traitDimensionLabel('visualFocus')}=${traitLabel(t.visualFocus)}`,
    `${traitDimensionLabel('palette')}=${traitLabel(t.palette)}`,
    `${traitDimensionLabel('composition')}=${traitLabel(t.composition)}`,
    `${traitDimensionLabel('textAmount')}=${traitLabel(t.textAmount)}`,
    `CTA${t.hasCta ? 'あり' : 'なし'}`,
    traitLabel(t.language),
  ].join('、');
}

/** vision分類プロンプトに差し込む選択肢一覧。日本語ラベルを判断ヒントとして併記する。 */
export function renderTraitsVocabularyForPrompt(): string {
  const lines: string[] = [
    'Classify into a `traits` JSON object. Every field is required; enum values MUST come from these lists (id — meaning in Japanese):',
  ];
  for (const [dim, def] of Object.entries(TRAIT_VOCABULARY)) {
    const options = Object.entries(def.values)
      .map(([id, ja]) => `${id}(${ja})`)
      .join(', ');
    const note = dim === 'hooks' ? ' — array of 1-2 ids, dominant appeal first' : '';
    lines.push(`- ${dim}: ${options}${note}`);
  }
  lines.push('- hasCta: true/false — 申込ボタンや「今すぐ」等の行動喚起導線が見えるか');
  lines.push('- schemaVersion: the number 1');
  return lines.join('\n');
}
