import { NextRequest, NextResponse } from 'next/server';
import { generateText } from '@/lib/text-llm';
import { AD_POLICY_PROMPT_GUIDE, checkAdPolicy } from '@/lib/ad-policy';
import { buildLearningNotes } from '@/lib/generation-history';
import type { AspectRatio, DestinationBrief, LayoutAxis, WinningAnalysis, WinningConcept, WinningStudioMode, WinningTier } from '@/lib/types';

const ASPECT_HINT: Record<AspectRatio, string> = {
  '1:1': 'square (1:1) — equal width and height. Compose centrally or with balanced elements; do NOT spread elements horizontally.',
  '16:9': 'landscape (16:9) — wide horizontal canvas. Design for left-right composition.',
  '9:16': 'vertical / portrait (9:16) — tall narrow canvas. Stack elements vertically.',
  '4:3': 'landscape (4:3) — slightly wide. Balanced horizontal layout.',
  '3:4': 'portrait (3:4) — slightly tall. Vertical-leaning layout.',
  'custom': 'custom pixel size — the exact final size is enforced by center-crop after generation. Compose centrally with safe margins.',
};

interface LayoutSpec {
  axis: LayoutAxis;
  /** カードに表示する日本語名 */
  label: string;
  /** AI に渡す英語の zone 構造テンプレ */
  template: string;
}

/**
 * Tier B（DNA継承・別レイアウト）で使うレイアウト軸テンプレ。
 * Meta の類似広告グルーピングを回避し、配信枠の多様性を稼ぐためのバリエ。
 */
const LAYOUT_SPECS: LayoutSpec[] = [
  {
    axis: 'centered-hero',
    label: '中央集中ヒーロー',
    template: `# Canvas Structure (centered-hero)
- Single central focal area: hero visual + main headline stacked vertically in the middle 60% of the canvas.
- TOP MARGIN (top ~10%): small badge / category tag — ONE element only.
- BOTTOM AREA (bottom ~20%): one CTA button + one supporting line. CTA is the second-most prominent element after the headline.

# Forbidden
- Do NOT add side panels, divider lines, or split layouts.
- Do NOT scatter decorative icons across empty corners.

# Composition rules
- Headline is the largest text. Sub headline is ~40% of headline size.
- Generous breathing room around every element. No element touches the image edge (≥8% inner margin).`,
  },
  {
    axis: 'full-bleed-photo',
    label: '全面写真 × 文字オーバーレイ',
    template: `# Canvas Structure (full-bleed-photo)
- Background: a single full-bleed photographic image filling the entire canvas (or strong illustration with photographic feel).
- Apply a darkening / lightening gradient overlay (~30-50% opacity) over the photo so the foreground text is fully readable.
- Foreground: headline + sub + CTA stacked in the lower-third or upper-third of the canvas (NOT center). Choose the third with the calmest part of the photo.

# Forbidden
- Do NOT split the canvas into zones with divider lines or color blocks.
- Do NOT place the headline directly over the busiest part of the photo.
- Do NOT scatter additional decorative elements over the photo.

# Composition rules
- Photo must look professional (cinematic lighting, shallow DoF feel) — never a stock-photo grid.
- Text shadow / outline is allowed for readability.`,
  },
  {
    axis: 'stacked-typographic',
    label: '縦三段タイポ主役',
    template: `# Canvas Structure (stacked-typographic)
- Three horizontal bands stacked vertically:
  - TOP BAND (top ~33%): the headline, very large, dominant. Solid background color (brand primary or near-black).
  - MIDDLE BAND (middle ~34%): the sub text + 1-2 supporting bullets, in a contrasting background (white / light tint).
  - BOTTOM BAND (bottom ~33%): the CTA button + closing tagline, on a brand accent color.
- Each band has a clean horizontal edge — bands do NOT bleed into each other.

# Forbidden
- Do NOT use photographic imagery — this is a typographic / poster design.
- Do NOT add center-stage illustrations. At most: one small icon / emblem per band.

# Composition rules
- Treat as a Swiss / editorial poster. Contrast between bands is achieved by background color shift, not divider lines.
- Type weight contrast is essential: headline = ultra-bold, sub = regular, CTA = bold.`,
  },
];

/**
 * Tier A 3案：勝ちフォーマット直系。
 * 3枠すべて「元の勝ちCR画像をそのまま土台に1軸だけ差し替える」clone編集（実物写真・レイアウト維持）。
 * ※ 旧 A-3 の「素材再配置(asset)」は、実在の書籍を AI が描き換える事故が起きたため廃止。
 *    実在物を1pxも変えない原則のもと、A-1/A-2/A-3 を全枠 clone 編集に統一した。
 *    バリエーション軸（copy/season/tone/background）は hook 側で3スロットに割り当てる。
 */
const TIER_A_PAIRINGS: {
  angle: string;
  angleDescription: string;
  reproductionMode: 'edit';
  layoutLabel: string;
}[] = [
  {
    angle: '訴求軸強化',
    angleDescription: 'original の訴求軸を一段強くする方向。原文の訴求を磨き直して切れ味を上げる',
    reproductionMode: 'edit',
    layoutLabel: '元画像を編集・コピー差替',
  },
  {
    angle: 'ベネフィット直球',
    angleDescription: 'ターゲットが手に入れる結果・ベネフィットを真正面から打ち出す',
    reproductionMode: 'edit',
    layoutLabel: '元画像を編集・別コピー',
  },
  {
    angle: '限定・緊急性ブースト',
    angleDescription: '「今だけ」「先着」等の限定性。ただし「今だけ無料」だけのような主語不明は禁止 — 何が限定なのか明示',
    reproductionMode: 'edit',
    layoutLabel: '元画像を編集・第3コピー',
  },
];

/** Tier B 3案：DNA継承・別レイアウト（Meta多様性スコア向上用） */
const TIER_B_PAIRINGS: { angle: string; angleDescription: string; layout: LayoutSpec }[] = [
  {
    angle: '課題提起・損失回避',
    angleDescription: 'ターゲットが抱える悩み or 「やらないことで失うもの」から入る',
    layout: LAYOUT_SPECS[1], // full-bleed-photo
  },
  {
    angle: '社会的証明・権威性',
    angleDescription: '数値・実績・第三者評価で信頼を立てる（数値は原文に明記が無ければ「多数の」等の定性語に留め、捏造禁止）',
    layout: LAYOUT_SPECS[0], // centered-hero
  },
  {
    angle: 'ベネフィット別軸',
    angleDescription: '元の訴求とは異なる側面のベネフィットや、感情面・ライフスタイル面の魅力に焦点を当てる',
    layout: LAYOUT_SPECS[2], // stacked-typographic
  },
];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      analysis: WinningAnalysis;
      aspectRatio?: AspectRatio;
      mode?: WinningStudioMode;
      destination?: DestinationBrief;
    };
    const { analysis, aspectRatio = '1:1', mode = 'same-project', destination } = body;

    if (!analysis) {
      return NextResponse.json({ error: '分析結果がありません' }, { status: 400 });
    }

    const isCross = mode === 'cross-project';
    const aspectHint = ASPECT_HINT[aspectRatio] || ASPECT_HINT['1:1'];
    const triggers = analysis.psychology?.triggers ?? [];
    const triggerLines = triggers.length > 0
      ? triggers.map(t => `  - ${t.label}: ${t.evidence}`).join('\n')
      : '  - (検出なし)';

    // 流用先（cross-project）の文脈ブロック。
    const destName = destination?.name?.trim();
    const destBrief = destination?.brief?.trim();
    const destPalette = (destination?.paletteHex ?? []).filter(Boolean);
    const destHasImage = !!destination?.hasProductImage;
    const destinationBlock = isCross ? `

## ====== DESTINATION (流用先) — this is what the NEW ads are FOR ======
- Destination brand: ${destName || '(unspecified)'}
- Destination brief: ${destBrief || '(none provided — infer a tasteful, on-brand direction)'}
- Destination brand palette: ${destPalette.join(', ') || '(none — you may reuse the winning palette family)'}
- Destination product image attached as reference: ${destHasImage ? 'YES — the attached photo IS the destination product. Feature it as the hero subject; do NOT redraw the source winning creative.' : 'NO — there is no destination product photo. Build the visual from the destination brief and palette.'}
` : '';

    const tierABlock = isCross
      ? TIER_A_PAIRINGS.map((p, i) => `### Concept A-${i + 1}: ${p.angle} (Tier A — winning STRUCTURE transplant)
- Angle: ${p.angle} — ${p.angleDescription} (rewritten for the DESTINATION brand, NOT the original product)
- tier: "A"
- layoutAxis: "format-clone"
- LayoutLabel (Japanese): 勝ち構造を流用
- The customPrompt MUST take the formatBlueprint below as the LAYOUT SKELETON (zone structure, eye-flow, composition rhythm), then rebuild it for the DESTINATION:
  (a) the hero subject is the DESTINATION product / brand (${destHasImage ? 'use the attached destination photo' : 'depict per the destination brief'}) — NOT the original product.
  (b) write fresh Japanese copy for the destination brand.
  (c) apply the destination brand palette (fallback to the winning palette family if none).
- The 3 Tier A concepts share the SAME structural skeleton (same winning layout). They differ in copy angle.
`).join('\n')
      : TIER_A_PAIRINGS.map((p, i) => `### Concept A-${i + 1}: ${p.angle} (Tier A — winning format clone)
- Angle: ${p.angle} — ${p.angleDescription}
- tier: "A"
- layoutAxis: "format-clone"
- LayoutLabel (Japanese): 勝ちフォーマット踏襲
- The customPrompt for this concept MUST start with the formatBlueprint VERBATIM (the "${'${formatBlueprint}'}" content described below as the canvas structure), then add at most 2-3 sentences clarifying:
  (a) where this concept's NEW headline / sub / CTA go (mirror the original's text placement zones — do NOT relocate them)
  (b) any subtle styling adjustments (e.g. accent color shift) — keep changes minimal so all 3 Tier A concepts feel like the SAME ad with different copy
- The 3 Tier A concepts share the SAME formatBlueprint. They differ ONLY in the headline / sub copy.
`).join('\n');

    const tierBBlock = TIER_B_PAIRINGS.map((p, i) => `### Concept B-${i + 1}: ${p.angle} × ${p.layout.label} (Tier B — DNA-inherited new layout)
- Angle: ${p.angle} — ${p.angleDescription}
- tier: "B"
- layoutAxis: "${p.layout.axis}"
- LayoutLabel (Japanese): ${p.layout.label}
- This concept inherits the winning palette / typography mood / overall feeling, but uses a DIFFERENT layout from the original to give the ad set visual diversity (Meta favors visually distinct creatives).
- The customPrompt for this concept MUST follow this layout template VERBATIM as its zone structure, then add color / motif / mood details on top:

\`\`\`
${p.layout.template}
\`\`\`
`).join('\n');

    // 学習ループの出口: 過去に生成→採用→入稿したバナーの実績（あれば）を判断材料として注入
    const learningNotes = await buildLearningNotes().catch(() => '');

    const prompt = `You are a senior advertising creative director. The user has a HIGH-PERFORMING ("winning") Japanese ad creative, and you have already analyzed WHY it works.
${learningNotes ? `\n${learningNotes}\n` : ''}

${isCross
  ? `## MODE: CROSS-PROJECT REPURPOSE (別プロジェクト流用)
The winning creative is from a DIFFERENT project. You will transplant ONLY its winning *structure* (layout skeleton, palette logic, eye-flow, psychological triggers) onto a DIFFERENT destination brand/product (see DESTINATION section).
- DO NOT reproduce the original product, the original book/object, or the original brand names. The original is a reference for STRUCTURE only.
- The subject, copy, brand names, and palette must all belong to the DESTINATION.`
  : `## MODE: SAME-PROJECT IMPROVEMENT (同プロジェクト改善)
The winning creative is for the SAME product you are improving. Keep the proven product/visual and AB-test the copy within the winning format.`}

${isCross
  ? `Now generate exactly 6 NEW creative concepts in TWO TIERS:

- **Tier A (3 concepts)**: Winning STRUCTURE transplant. Reuse the original's layout skeleton / composition / eye-flow, but the subject, copy, and palette are the DESTINATION's. Used for "apply the proven winning structure to a new product."
- **Tier B (3 concepts)**: Structure family with alternative layouts. Same structural sensibility, but different layouts (centered hero / full-bleed photo / stacked typographic), all for the DESTINATION brand. Gives Meta visually-distinct creatives.`
  : `Now generate exactly 3 NEW creative concepts (Tier A only):

- **Tier A (3 concepts)**: Winning format clone. Same layout, same color palette, same composition, same person placement, same decorative motifs as the original — ONLY the Japanese copy is different. Used for "AB-test the headline within the proven winning format."
（テーマ替え3案 — 世界観ごと描き直す見た目バリエーション — はアプリ側で決定論的に組み立てるため、あなたは生成しない）`}
${destinationBlock}
## Winning analysis (the formula to inherit)

### Visual
- 配色とコントラスト: ${analysis.visual.colorContrast}
- レイアウト構成: ${analysis.visual.layout}
- フォント印象: ${analysis.visual.typography}
- 視線誘導の流れ: ${analysis.visual.eyeFlow}
- パレット: ${analysis.visual.paletteHex.join(', ') || '(none)'}

### Message
- 訴求軸: ${analysis.message.appealAxis}
- 刺さりどころ: ${analysis.message.hookPoint}
- CTA: ${analysis.message.cta}
- 元のmainText: ${analysis.message.mainText || '(なし)'}
- 元のsubText: ${analysis.message.subText || '(なし)'}
- 元のextraTexts: ${analysis.message.extraTexts.map(t => `「${t.text}」(${t.decoration ?? 'none'})`).join(', ') || '(なし)'}

### Psychology triggers
${triggerLines}
- 総括: ${analysis.psychology.summary}

### Context
- 業種・対象: ${analysis.contextSummary || '(unknown)'}
- 勝ちパターン総括: ${analysis.winningPattern}
- Has persons: ${analysis.hasPersons ? 'yes' : 'no'}

### formatBlueprint (the EXACT visual reproduction recipe — Tier A uses this verbatim)
${analysis.formatBlueprint || '(formatBlueprint missing — fall back to inferring from the visual analysis above. Reconstruct a detailed canvas blueprint as best you can.)'}

## Output canvas
- Aspect ratio: ${aspectRatio} — ${aspectHint}

## Inheritance rules (apply to ALL concepts)
${isCross
  ? `1. INHERIT the winning **structural logic** (layout skeleton, eye-flow, contrast rhythm). Apply the DESTINATION palette (fallback to the winning palette family only if the destination has none).
2. INHERIT the winning **typography mood** if it suits the destination brand.
3. WRITE fresh Japanese copy FOR THE DESTINATION brand. Do NOT reuse the original's mainText / subText, and do NOT mention the original product.
4. Use the DESTINATION's brand / product names. Do NOT carry over the original project's brand or product names (that would be misappropriation of another project's assets).`
  : `1. KEEP the winning **palette family**. Tier A uses the EXACT palette.
2. KEEP the winning **typography mood**.
3. CHANGE the **copy** — DO NOT reuse the exact mainText / subText from the original. Write fresh Japanese copy.
4. Specific brand / product names from the original SHOULD carry over (don't invent fake products), but it's OK if a few concepts omit the brand name when the angle works better without it.`}

## Number / fact integrity
- 数値や実績は、明記されているもの以外は捏造禁止。「多数の」「業界最高水準」等の定性語に留めること。
${isCross
  ? '- 固有名詞は流用先（DESTINATION）のブランド/商品名を使う。流用元の商品名・会社名は持ち込まない。'
  : '- 固有名詞（商品名・サービス名・会社名）は原文の通り保持する。'}

## ====== TIER A (3 concepts: ${isCross ? 'winning structure transplant' : 'winning format clone'}) ======

CRITICAL for Tier A:
${isCross
  ? `- All 3 Tier A concepts MUST share the SAME structural skeleton derived from the formatBlueprint (same zone layout, same eye-flow), but rebuilt for the DESTINATION brand.
- The subject is the DESTINATION product/brand, the copy is fresh Japanese for the destination, and the palette is the destination's. Do NOT depict the original product.
- The customPrompt for each Tier A concept MUST take the formatBlueprint as the layout skeleton, then describe the destination subject, destination copy zones, and destination palette.`
  : `- All 3 Tier A concepts MUST share the SAME formatBlueprint as their canvas structure. They are visually almost-identical; only the Japanese copy differs. This mirrors the proven AB-test pattern of "same winning format, different headline angle."
- Do NOT modify the layout, color palette, person positions, or decorative motifs across A-1, A-2, A-3.
- The customPrompt for each Tier A concept MUST embed the formatBlueprint VERBATIM at the top, then add 2-3 sentences mapping the new copy onto the existing zones.`}

${tierABlock}
${isCross ? `
## ====== TIER B (3 concepts: DNA-inherited new layouts) ======

CRITICAL for Tier B:
- Each Tier B concept uses a DIFFERENT layout template (assigned below).
- They are for the DESTINATION brand: destination subject, destination copy, destination palette. They borrow the winning structural sensibility but do NOT depict the original product.

${tierBBlock}` : ''}

## Output schema for each concept
- tier: "A" | "B"
- angle: 上記の角度の日本語名（そのまま使う）
- layoutAxis: "format-clone" (Tier A) / "centered-hero" / "full-bleed-photo" / "stacked-typographic" (Tier B)
- layoutLabel: 上記のレイアウト日本語ラベル（そのまま使う。A は「勝ちフォーマット踏襲」固定）
- inheritedFrom: ${isCross ? '勝ちCRから何の「構造」を流用したかを日本語1-2文で説明（レイアウト骨格/視線誘導/トリガー）' : '勝ちCRから何を踏襲したかを日本語1-2文で説明'}
- mainText: 5-15字の日本語ヘッドライン${isCross ? '（流用先ブランド向け）' : ''}
- subText: 10-25字の補助コピー
- extraTexts: 1-2個。{text, decoration}。decoration は "none" | "button" | "badge" | "ribbon" | "circle"。最低1つは "button" のCTAを含めること
- mainColor: Hex (#RRGGBB)。${isCross ? '流用先ブランドのパレット（DESTINATION palette）から選ぶ。無ければ勝ちCRのパレット近似でよい' : '勝ちCRの paletteHex 内から選ぶか、近い色相'}
- customPrompt: 画像生成AI用の英語の design direction。${isCross ? 'Tier A/B とも formatBlueprint（またはレイアウトテンプレ）を骨格に、流用先の被写体・コピー・配色で再構築する指示を書く。流用元の商品は描写しない。' : 'formatBlueprint を冒頭に置いてその後に2-3文補足。'}
- hasPersons: boolean。${isCross ? '流用先の被写体に応じて判断する' : `元画像と同じ値（${analysis.hasPersons}）必須`}

${AD_POLICY_PROMPT_GUIDE}

## Output format
${isCross
  ? 'Respond with ONLY a JSON array of EXACTLY 6 objects in this order: A-1, A-2, A-3, B-1, B-2, B-3. No markdown fences, no explanation.'
  : 'Respond with ONLY a JSON array of EXACTLY 3 objects in this order: A-1, A-2, A-3. No markdown fences, no explanation.'}

Schema:
[
  {
    "tier": "A",
    "angle": "訴求軸強化",
    "layoutAxis": "format-clone",
    "layoutLabel": "勝ちフォーマット踏襲",
    "inheritedFrom": "...",
    "mainText": "...",
    "subText": "...",
    "extraTexts": [{"text":"...","decoration":"button|badge|ribbon|circle|none"}],
    "mainColor": "#RRGGBB",
    "customPrompt": "...",
    "hasPersons": ${analysis.hasPersons}
  },
  ${isCross ? '... (5 more in the fixed order above: A-2, A-3, B-1, B-2, B-3)' : '... (2 more in the fixed order above: A-2, A-3)'}
]`;

    const result = await generateText(prompt);

    let concepts: WinningConcept[];
    try {
      const jsonMatch = result.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('JSON not found');
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>[];
      const expectedCount = isCross ? 6 : 3;
      if (!Array.isArray(parsed) || parsed.length < expectedCount) {
        throw new Error(`Expected ${expectedCount} concepts, got ${Array.isArray(parsed) ? parsed.length : 0}`);
      }

      const VALID_LAYOUT_AXES: (LayoutAxis | 'format-clone')[] = [
        'format-clone',
        'centered-hero',
        'full-bleed-photo',
        'stacked-typographic',
        'split-comparison',
        'asymmetric-text-left',
      ];

      // 期待される順序を組み立てる（same-project: A-1〜A-3 / cross-project: A-1〜B-3）
      const expected: { tier: WinningTier; angle: string; layoutAxis: LayoutAxis | 'format-clone'; layoutLabel: string; reproductionMode?: 'edit' }[] = [
        ...TIER_A_PAIRINGS.map(p => ({
          tier: 'A' as WinningTier,
          angle: p.angle,
          layoutAxis: 'format-clone' as const,
          layoutLabel: p.layoutLabel,
          reproductionMode: p.reproductionMode,
        })),
        ...(isCross
          ? TIER_B_PAIRINGS.map(p => ({
              tier: 'B' as WinningTier,
              angle: p.angle,
              layoutAxis: p.layout.axis,
              layoutLabel: p.layout.label,
            }))
          : []),
      ];

      concepts = parsed.slice(0, expected.length).map((c, i) => {
        const exp = expected[i];
        const rawTier = c.tier as string;
        const tier: WinningTier = (rawTier === 'A' || rawTier === 'B') ? rawTier : exp.tier;
        const rawAxis = c.layoutAxis as string;
        const layoutAxis = (VALID_LAYOUT_AXES as string[]).includes(rawAxis)
          ? (rawAxis as LayoutAxis | 'format-clone')
          : exp.layoutAxis;

        return {
          id: `winning-concept-${i}`,
          tier,
          angle: (c.angle as string) || exp.angle,
          layoutAxis,
          // Tier A のラベル/再現方式は決め打ち（LLM出力に依存しない）
          layoutLabel: exp.reproductionMode ? exp.layoutLabel : ((c.layoutLabel as string) || exp.layoutLabel),
          ...(exp.reproductionMode ? { reproductionMode: exp.reproductionMode } : {}),
          inheritedFrom: (c.inheritedFrom as string) || '',
          mainText: (c.mainText as string) || '',
          subText: (c.subText as string) || '',
          extraTexts: ((c.extraTexts as { text: string; decoration?: string }[]) || []).map(et => ({
            text: et.text,
            decoration: (et.decoration as WinningConcept['extraTexts'][number]['decoration']) ?? 'none',
          })),
          mainColor: /^#[0-9A-Fa-f]{6}$/.test(c.mainColor as string)
            ? (c.mainColor as string)
            : (analysis.visual.paletteHex[0] || '#333333'),
          customPrompt: (c.customPrompt as string) || '',
          hasPersons: typeof c.hasPersons === 'boolean' ? c.hasPersons : analysis.hasPersons,
          isGenerating: false,
        };
      });
    } catch {
      return NextResponse.json({ error: '構成案の生成に失敗しました。再度お試しください。' }, { status: 500 });
    }

    // 広告審査NG表現の機械チェック（プロンプト注入だけでは徹底されないため。Issue #31）
    concepts = concepts.map((c) => {
      const copyText = [c.mainText, c.subText, ...c.extraTexts.map((et) => et.text)].filter(Boolean).join('\n');
      const policyWarnings = checkAdPolicy(copyText);
      return policyWarnings.length > 0 ? { ...c, policyWarnings } : c;
    });

    return NextResponse.json({ concepts });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
