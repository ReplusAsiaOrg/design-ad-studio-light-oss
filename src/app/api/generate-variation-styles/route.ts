import { NextRequest, NextResponse } from 'next/server';
import { generateText } from '@/lib/gemini';
import type { AspectRatio, BannerAnalysis, VariationCategory, VariationStyle } from '@/lib/types';

const ASPECT_HINT: Record<AspectRatio, string> = {
  '1:1': 'square (1:1) — equal width and height. Compose centrally or with balanced elements; do NOT spread elements horizontally as a wide banner.',
  '16:9': 'landscape (16:9) — wide horizontal canvas. Design for left-right composition.',
  '9:16': 'vertical / portrait (9:16) — tall narrow canvas. Stack elements vertically.',
  '4:3': 'landscape (4:3) — slightly wide. Balanced horizontal layout.',
  '3:4': 'portrait (3:4) — slightly tall. Vertical-leaning layout.',
  'custom': 'custom pixel size — the exact final size is enforced by center-crop after generation. Compose centrally with safe margins.',
};

const CATEGORY_RULE: Record<VariationCategory, string> = {
  auto: '',
  serious: 'REQUIREMENT: At least 1 of the 6 variations MUST come from the **Serious / Premium** category (Corporate Premium / Editorial Magazine / Monochrome Sophistication / Executive Luxury). The user is targeting B2B / executive / financial audiences and expects at least one refined, premium option as a baseline. The other 5 should span at least 3 OTHER categories for variety.',
  soft:    'REQUIREMENT: At least 1 of the 6 variations MUST come from the **Soft / Friendly** category (Hand-drawn / Anime / Pastel & Playful / Watercolor Botanical / Kawaii). The user is targeting cosmetics, retail, lifestyle, or consumer-friendly audiences and expects at least one warm, approachable option. The other 5 should span at least 3 OTHER categories for variety.',
  bold:    'REQUIREMENT: At least 1 of the 6 variations MUST come from the **Bold / Energetic** category (Dynamic Impact / Pop Art / Retro 80s/90s / Risograph Print). The user is targeting events, launches, or campaigns where attention-grabbing impact matters. The other 5 should span at least 3 OTHER categories for variety.',
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { analysis: BannerAnalysis; aspectRatio?: AspectRatio; category?: VariationCategory };
    const { analysis, aspectRatio = '1:1', category = 'auto' } = body;

    if (!analysis) {
      return NextResponse.json({ error: '解析結果がありません' }, { status: 400 });
    }

    const allTexts = [
      analysis.mainText,
      analysis.subText,
      ...analysis.extraTexts.map(t => t.text),
    ].filter(Boolean);

    const aspectHint = ASPECT_HINT[aspectRatio] || ASPECT_HINT['1:1'];

    const prompt = `You are a creative director. The user has an existing Japanese banner with the following content, and wants 6 design variations — same content, completely different visual design moods.

## Banner content (must remain identical across all 6 variations)
- Main text: ${analysis.mainText || '(none)'}
- Sub text: ${analysis.subText || '(none)'}
- Supporting texts: ${analysis.extraTexts.map(t => `「${t.text}」`).join(', ') || '(none)'}
- Has persons: ${analysis.hasPersons ? 'yes' : 'no'}
- Context: ${analysis.contextSummary || '(unknown)'}
- Original colors used: ${analysis.primaryColors.join(', ') || '(none)'}

## Output canvas (CRITICAL)
- Aspect ratio: ${aspectRatio} — ${aspectHint}
- ALL 6 variations will be rendered in this exact aspect ratio. The composition you describe MUST fit this canvas naturally.
- DO NOT use words like "wide", "landscape", "panoramic", "horizontal banner", "letterbox", "widescreen", "cinematic" in customPrompt unless the aspect ratio is actually wide (16:9 or 4:3).
- DO NOT use words like "tall", "vertical poster", "portrait" unless the aspect ratio is actually vertical (9:16 or 3:4).
- For square (1:1): describe centered, balanced compositions. Avoid implying horizontal or vertical orientation.

## Task
Generate exactly 6 design variations. Each must be visually DRAMATICALLY different from the others — different color palettes, different typography, different composition, different visual genres. The point is variety, NOT safety.

${CATEGORY_RULE[category]}

### IMPORTANT: Maximize variety
- Even if the content is for B2B / executives / financial / serious topics, you CAN and SHOULD include playful, illustrated, hand-drawn, anime-style, retro, pop, or unconventional designs. Variety surfaces unexpected winners.
- Do NOT pick 6 styles that all feel "serious / corporate / refined." That's the most common failure mode.
- Do NOT include two styles that are siblings (e.g. "Corporate Premium" + "Executive Luxury", or "3D Render" + "3D Character (Pixar)", or "Kawaii / Mascot" + "3D Character (Pixar)" are nearly identical / overlapping — pick at most ONE from any sibling group).
- The 6 styles should look like they belong to 6 DIFFERENT design genres.

### Style category library — pick 6 from at LEAST 4 different categories

【Serious / Premium】
- Corporate Premium (dark navy × gold, refined authority)
- Editorial Magazine (serif typography, asymmetric, sophisticated)
- Monochrome Sophistication (pure black/white/grey, high-end fashion)
- Executive Luxury (burgundy × cream, jewel tones)  ← do NOT combine with Corporate Premium

【Bold / Energetic】
- Dynamic Impact (black × orange/red, high contrast, kinetic)
- Pop Art (saturated primary colors, large flat shapes, comic-book energy)
- Retro 80s/90s (neon, gradients, geometric patterns)
- Risograph Print (limited 2-3 color palette, grain texture, artisan feel)

【Tech / Modern】
- Tech Forward (blue gradients, digital grid, glow, futuristic)
- Glassmorphism (frosted glass blur, soft pastel gradients)
- Brutalist (raw type, stark white/black, ungroomed, deconstructed)
- Y2K / Cyber (chrome, holographic, futuristic kawaii)

【Soft / Friendly】
- Hand-drawn / Sketch (illustrated, casual, warm, organic lines)
- Anime / Manga (Japanese pop illustration, cel-shading, expressive)
- Pastel & Playful (soft pinks/mint/coral, rounded shapes, cheerful)
- Watercolor Botanical (washed colors, leaves, gentle)
- Kawaii / Mascot (cute flat-illustrated animal or character mascot — e.g. a shiba dog or original character, friendly Japanese sticker/LINE-stamp vibe, bright pop palette, the mascot is the hero of the composition)
- Flat Line Art (clean minimal flat-color illustration with uniform outlined line work — people, furniture and objects drawn as simple flat shapes with thin even strokes, generous whitespace, soft pastel palette, calm editorial feel)

【Editorial / Unique】
- Newspaper Editorial (mono serif, columns, vintage feel)
- Vaporwave (purple/pink gradients, marble textures, surreal)
- 3D Render (clay material, soft shadows, isometric objects)
- 3D Character (Pixar) (Pixar/Disney-style expressive 3D character as the hero — big eyes, glossy rounded forms, soft cinematic lighting, shallow depth of field, warm friendly mood)

### Composition rules
Each variation should:
- Keep ALL text content identical (do NOT rewrite or translate)
- Use a completely different color palette from the others
- Have a clearly distinct visual mood
- Fit the ${aspectRatio} canvas

### Person inclusion (MIX, don't copy the original)
Original has persons: ${analysis.hasPersons ? 'yes' : 'no'}.
For variety, distribute persons across the 6 variations as roughly:
- 2-3 with persons (photographic OR illustrated character — vary the style)
- 2-3 without persons (typographic, graphic, illustration without human figures)
- Even if the original has a person, some variations should be person-free (e.g. Brutalist, Editorial Magazine, Risograph typically work better without people)
- Even if the original has no person, some variations CAN add an illustrated character (e.g. Anime, Kawaii, Hand-drawn)

### Output format for each variation
- name: Japanese style name in 6-14 chars (e.g. 「コーポレートプレミアム」「ポップアート」「アニメ調」「リソグラフ」「ハンドドロー」)
- paletteHex: Array of 2-4 Hex codes. The first is the dominant color used as mainColor for layout
- descriptionJa: 1-2 short Japanese sentences. e.g. 「ダークネイビーとゴールドの高級感ある配色。」
- customPrompt: DETAILED English design instruction (3-5 sentences) for the image generation AI. Describe:
  * Exact color palette with Hex codes
  * Typography mood (serif vs sans, bold vs thin, hand-lettered, etc)
  * Composition fitting the ${aspectRatio} canvas (centered, layered, grid-based — match the aspect, not "wide horizontal" unless actually wide)
  * Overall atmosphere and specific visual motifs (geometric shapes, texture, gradients, glass, paper, photographic, illustrative, anime, etc)
  * Whether and how to include people (match this variation's hasPersons; be specific about style — photographic / illustrated / anime / no people)
  The image AI has NEVER seen the original — be specific and concrete. The canvas is ${aspectRatio}; do NOT describe a layout that implies a different aspect ratio.
- hasPersons: boolean — whether THIS variation should show a person (mix across the 6 as described above)

Respond with ONLY a JSON array of exactly 6 objects, no markdown fences, no explanation. Schema:
[{"name":"...","paletteHex":["#...","#..."],"descriptionJa":"...","customPrompt":"...","hasPersons":true|false},...]

Total text elements that will be rendered: ${allTexts.length}.`;

    const result = await generateText(prompt);

    let styles: VariationStyle[];
    try {
      const jsonMatch = result.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('JSON not found');
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>[];
      if (!Array.isArray(parsed) || parsed.length < 6) {
        throw new Error(`Expected 6 styles, got ${Array.isArray(parsed) ? parsed.length : 0}`);
      }
      styles = parsed.slice(0, 6).map(s => ({
        name: (s.name as string) || 'スタイル',
        paletteHex: ((s.paletteHex as string[]) || []).filter(c => /^#[0-9A-Fa-f]{6}$/.test(c)),
        descriptionJa: (s.descriptionJa as string) || '',
        customPrompt: (s.customPrompt as string) || '',
        hasPersons: typeof s.hasPersons === 'boolean' ? s.hasPersons : analysis.hasPersons,
      }));
    } catch {
      return NextResponse.json({ error: 'スタイル案の生成に失敗しました。再度お試しください。' }, { status: 500 });
    }

    return NextResponse.json({ styles });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
