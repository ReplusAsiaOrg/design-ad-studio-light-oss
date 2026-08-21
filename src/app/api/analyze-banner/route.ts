import { NextRequest, NextResponse } from 'next/server';
import { generateTextWithBase64Image } from '@/lib/gemini';
import type { BannerAnalysis, VariationCategory } from '@/lib/types';

const VALID_CATEGORIES: VariationCategory[] = ['auto', 'serious', 'soft', 'bold'];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { imageBase64: string; assetImageBase64?: string };
    const { imageBase64, assetImageBase64 } = body;

    if (!imageBase64) {
      return NextResponse.json({ error: '画像がありません' }, { status: 400 });
    }

    // 素材画像（書籍・商品・パッケージ・人物）が別途アップロードされている場合:
    // 素材はそのまま写真として配置されるので、素材上に印刷された文字を
    // バナーテキストとして抽出させない（帯の細かい文字の誤読→生成画像への焼き込み対策）
    const assetNote = assetImageBase64
      ? `

IMPORTANT — PROTECTED ASSET (second image):
The FIRST image is the banner to analyze. The SECOND image is a protected asset photo (book, product, package, or person) that will be placed into the new design AS-IS, without being redrawn.
- Do NOT extract any text that is printed ON this asset (book cover text, obi/band text, package labels, author name on the cover, publisher name) into mainText / subText / extraTexts. That text already lives inside the asset photo.
- Where this asset appears inside the banner, treat it as a single visual object — do not read text out of it there either.
- You may mention the asset briefly in contextSummary.`
      : '';

    const prompt = `You are analyzing a Japanese promotional banner image. Extract its content for redesign purposes.${assetNote}

Read ALL Japanese text visible in the image carefully. Identify the visual hierarchy:
- mainText: The largest / most prominent headline (the main catchphrase)
- subText: The secondary supporting text (usually smaller, near the headline)
- extraTexts: Any additional supporting elements — date, price, CTA button text, badges, callouts. For each, also identify if it appears as a button, badge (small label), ribbon, circle, or no decoration.
- primaryColors: 2-4 dominant Hex colors used in the design (background, text, accent)
- hasPersons: true if a person/character appears in the image, false otherwise
- contextSummary: 1-2 short Japanese sentences describing what this banner is for (industry, product, intended audience). This is NOT user-facing — it's used as design context.
- suggestedCategory: Suggested use-case category for design variations. Pick ONE that best matches the banner's audience and purpose:
  * "serious" — B2B, executive, finance, consulting, recruiting (white-collar), professional services. The audience expects refined / authoritative / premium tone.
  * "soft" — cosmetics, skincare, fashion, lifestyle, parenting, food (gentle), wellness, retail consumer goods. The audience expects warm / friendly / approachable tone.
  * "bold" — events, launches, sales, promotions, campaigns, entertainment, sports. The audience expects high-impact / energetic / attention-grabbing tone.
  * "auto" — if the banner doesn't clearly fit any of the above, or you're not confident.

IMPORTANT:
- Preserve the EXACT original Japanese text — do not paraphrase or translate
- Do not invent text that is not visible in the image
- decoration values: "none" | "button" | "badge" | "ribbon" | "circle"
- suggestedCategory values: "auto" | "serious" | "soft" | "bold"

Respond with ONLY a JSON object. No markdown fences, no explanation. Schema:
{"mainText":"...","subText":"...","extraTexts":[{"text":"...","decoration":"none|button|badge|ribbon|circle"}],"primaryColors":["#RRGGBB","#RRGGBB"],"hasPersons":false,"contextSummary":"...","suggestedCategory":"auto|serious|soft|bold"}`;

    const result = await generateTextWithBase64Image(prompt, imageBase64, assetImageBase64 ? [assetImageBase64] : []);

    let analysis: BannerAnalysis;
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('JSON not found');
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      const rawCategory = parsed.suggestedCategory as string | undefined;
      const suggestedCategory = (VALID_CATEGORIES as string[]).includes(rawCategory ?? '')
        ? (rawCategory as VariationCategory)
        : 'auto';

      analysis = {
        mainText: (parsed.mainText as string) || '',
        subText: (parsed.subText as string) || '',
        extraTexts: ((parsed.extraTexts as { text: string; decoration?: string }[]) || []).map(et => ({
          text: et.text,
          decoration: (et.decoration as BannerAnalysis['extraTexts'][number]['decoration']) ?? 'none',
        })),
        primaryColors: ((parsed.primaryColors as string[]) || []).filter(c => /^#[0-9A-Fa-f]{6}$/.test(c)),
        hasPersons: !!parsed.hasPersons,
        contextSummary: (parsed.contextSummary as string) || '',
        suggestedCategory,
      };
    } catch {
      return NextResponse.json({ error: '画像の解析に失敗しました。再度お試しください。' }, { status: 500 });
    }

    return NextResponse.json({ analysis });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
