import { NextRequest, NextResponse } from 'next/server';
import { generateText, generateTextWithImages, GEMINI_TEXT_MODEL } from '@/lib/gemini';
import { AD_POLICY_PROMPT_GUIDE, checkAdPolicy } from '@/lib/ad-policy';
import type { ScrapedPageData, BannerConcept } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      scrapedData: ScrapedPageData;
      screenshotBase64?: string;
    };
    const { scrapedData, screenshotBase64 } = body;

    if (!scrapedData) {
      return NextResponse.json({ error: 'スクレイピングデータがありません' }, { status: 400 });
    }

    // スクリーンショットがある場合は最優先で使う
    const hasScreenshot = !!screenshotBase64;

    // 画像URLを収集（OG画像 + ヒーロー画像）※スクショがない場合のフォールバック
    const imageUrls: string[] = [];
    if (!hasScreenshot) {
      if (scrapedData.ogImage) imageUrls.push(scrapedData.ogImage);
      if (scrapedData.heroImageUrls) {
        for (const u of scrapedData.heroImageUrls) {
          if (!imageUrls.includes(u)) imageUrls.push(u);
        }
      }
    }

    const imageNote = hasScreenshot
      ? `\n\nSCREENSHOT ATTACHED: A screenshot of the page's first-view (above the fold) is attached. This is the MOST RELIABLE source for identifying the page's catchphrase, key messaging, AND design style. READ ALL TEXT visible in this screenshot carefully. Also ANALYZE the visual design: color palette, typography style, overall mood/atmosphere, and design aesthetic.`
      : imageUrls.length > 0
        ? `\n\nATTACHED IMAGES: I have attached ${Math.min(imageUrls.length, 3)} images from the page. CAREFULLY read any text visible in these images. Also ANALYZE the visual design style of these images.`
        : '';

    const prompt = `You are a marketing expert and banner designer. Analyze the following landing page data and generate exactly 6 banner concepts.

## Landing Page Data
- URL: ${scrapedData.url}
- Page title: ${scrapedData.title}
- Description: ${scrapedData.description}
- Hero/first-view texts (in DOM order from page top): ${scrapedData.heroTexts?.join(' / ') || 'none'}
- Headings: ${scrapedData.headings.join(' / ')}
- CTA texts: ${scrapedData.ctaTexts.join(' / ')}
- Body text: ${scrapedData.bodyTextSummary}
- Brand colors: ${scrapedData.primaryColors.join(', ') || 'not detected'}${imageNote}

## Step 1: Identify Core Subject Keyword
Before generating concepts, identify the CORE SUBJECT of this page — what product, service, or topic is this LP about? Extract the essential keyword(s) that tell viewers what this banner is for (e.g. "料理教室", "英会話", "プログラミング講座", "脱毛サロン"). This is NOT the page title — it's the 1-3 word subject that must appear in EVERY banner so viewers instantly know what the banner is advertising.

## Step 2: Analyze Design Style
Analyze the LP's design style from the attached images/screenshot and page data:
- Primary brand colors and color palette
- Design mood/atmosphere (e.g. elegant, natural, cute, corporate, pop, warm, cool)
- Typography style tendency (serif/mincho? sans-serif/gothic? rounded? handwritten?)
- Overall aesthetic (e.g. clean/minimal, rich/decorative, organic/natural)

ALL 6 concepts MUST follow this LP's design language. Do NOT create generic sale-style (red/yellow starburst) or unrelated designs.

## Step 3: Generate 6 Concepts

### RULE: Subject clarity varies by concept type
The core subject keyword from Step 1 is important, but how strictly it must appear depends on the marketing angle:

- **Concepts 2-4 (直接訴求/課題解決/信頼訴求)**: The subject should be clear from the combination of mainText + subText, but the brand/service name does NOT need to appear in every single one. A benefit-focused headline like "スキルを収入に！" is fine if subText adds context like "学びながら稼げるコミュニティ". Prioritize catchy, natural-sounding copy over forcing a brand name in.
- **Concept 5 (限定訴求)**: MUST explicitly state WHAT is free/limited/urgent. "今だけ無料！" alone is NEVER acceptable — the viewer must know what they're being urged to act on. Example: "無料体験 今だけ開催中" or "〇〇講座 残席わずか"
- **Concept 6 (感情訴求)**: Brand name is optional. Emotional, aspirational copy is OK (e.g. "夢を叶える新しい働き方"). The mood matters more than explicit naming.

BAD (concept 5 only — urgency without subject):
- "今だけ無料！" → What is free? Nobody knows.
- "残席わずか！" → Seats for what?

GOOD variety across concepts:
- Concept 2: "スキルを収入に！" (subText: "学びながら稼げるコミュニティ") — subject clear from context
- Concept 3: "未経験でもOK" (subText: "サンプル講座なら専任サポート付き") — brand in subText
- Concept 5: "サンプル講座無料体験 今だけ" — urgency concept MUST be explicit
- Concept 6: "夢を叶える新しい働き方" — emotional, brand-free is OK

### Concept 1: "ファーストビュー活用" (MANDATORY - reproduce REAL first-view copy)
${hasScreenshot ? 'The attached screenshot shows the page\'s first-view. READ ALL TEXT visible in it.' : 'Look at the hero texts, headings, and attached images.'}

Reproduce ALL text from the first-view as a banner. The first-view usually has multiple text elements stacked together (e.g. a lead-in line, the main catchphrase, a sub-heading). Capture ALL of them — do not selectively pick only part of it.

Rules for Concept 1:
- mainText: ALL the prominent text from the first-view combined. NO character limit. Include the full catchphrase AND any key modifier text (like the service/product name). For example, if the first-view shows "＼ゼロから始める／ 実践英会話メソッド はじめての授業", then mainText should include ALL of these elements, not just "ゼロから始める".
- subText: Any remaining supporting text from the first-view. NO character limit.
- extraTexts: Use a real CTA text from the page if available
- MUST preserve the EXACT original page wording — do NOT rewrite, summarize, or paraphrase
- mainColor: Use the LP's primary brand color
- customPrompt: Describe a design that closely matches the LP's first-view visual style

### Concepts 2-6: Different marketing angles (AI-generated copy)
2. Direct benefit appeal (直接訴求) - highlight the main value proposition. Prioritize catchy copy; brand name optional if the benefit is clear from mainText + subText combined
3. Problem-solution (課題解決型) - address pain points, present the solution. Brand/service name can go in either mainText or subText — wherever it reads most naturally
4. Social proof / trust (信頼訴求) - credibility, numbers, testimonials. Mention the brand/service name in mainText or subText for attribution
5. Urgency / scarcity (限定訴求) - time-limited, exclusive. **MUST explicitly state WHAT is limited/free** (e.g. "〇〇無料体験 今だけ" not just "今だけ無料！"). This is the ONE concept where the subject keyword is absolutely required in mainText
6. Emotional appeal (感情訴求) - aspirational, lifestyle. Brand name is optional — prioritize emotional impact and natural-sounding copy

Each concept (2-6) should have:
- angle: Marketing angle name in Japanese (2-4 words)
- mainText: Bold headline in Japanese (5-15 chars). Should be catchy and impactful — prioritize natural-sounding marketing copy. Brand name is required only for concept 5 (限定訴求)
- subText: Supporting text in Japanese (10-25 chars). Complements mainText — together they should convey what the service/product is about
- extraTexts: Array of 1-2 additional texts, each with { text, decoration }. decoration can be: "none", "button", "badge", "ribbon", "circle". Use "button" for CTA texts, "badge" for short labels like "期間限定" or "NEW", "ribbon" for promotional sashes, "circle" for emphasis like "無料". Include at least one CTA button
- mainColor: Hex color from the LP's brand palette (vary shades but stay on-brand)
- customPrompt: DETAILED English design instruction (2-4 sentences). This prompt goes to an image generation AI that has NEVER seen the LP, so you must describe EVERYTHING explicitly:
  * What specific visual/scene to show (e.g. "Japanese woman cooking with herbs and spices in a warm kitchen" NOT just "warm natural design")
  * The exact color palette (e.g. "warm green (#6B8E23) and cream (#FFF8DC) tones")
  * The visual mood and style (e.g. "soft, warm, organic Japanese wellness aesthetic with natural textures")
  * What type of imagery relates to this specific product/service
  The image generation AI will create a completely wrong image if the customPrompt is vague. Be SPECIFIC.
- hasPersons: boolean - whether a person should appear in the banner

IMPORTANT:
- All text content (mainText, subText, extraTexts) MUST be in Japanese
- EVERY concept (including concept 1) MUST make the subject clear — a viewer must instantly know what is being advertised
- customPrompt MUST be in English and MUST be detailed enough for an AI that knows NOTHING about this LP to generate an appropriate image
- mainColor for ALL concepts should come from the LP's brand color palette

${AD_POLICY_PROMPT_GUIDE}

Respond with ONLY a JSON array of 6 objects. No markdown, no explanation. Example:
[{"angle":"ファーストビュー活用","mainText":"...","subText":"...","extraTexts":[{"text":"詳しくはこちら","decoration":"button"}],"mainColor":"#FF5733","customPrompt":"Warm, inviting scene of a Japanese woman preparing herbal dishes in a bright kitchen. Use soft green and cream color palette. Natural, organic wellness aesthetic with wooden textures and fresh herbs visible.","hasPersons":true},...]`;

    // スクリーンショットがある場合はそれを直接Geminiに送る
    let result: string;
    if (hasScreenshot) {
      result = await generateTextWithScreenshot(prompt, screenshotBase64!);
    } else if (imageUrls.length > 0) {
      result = await generateTextWithImages(prompt, imageUrls);
    } else {
      result = await generateText(prompt);
    }

    // Parse JSON from response
    let concepts: BannerConcept[];
    try {
      const jsonMatch = result.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error('JSON not found in response');
      }
      const parsed = JSON.parse(jsonMatch[0]);
      concepts = parsed.map((c: Record<string, unknown>, i: number) => ({
        id: `concept-${i}`,
        angle: c.angle as string,
        mainText: c.mainText as string,
        subText: c.subText as string,
        extraTexts: ((c.extraTexts as { text: string; decoration?: string; isButton?: boolean }[]) || []).map(et => ({
          text: et.text,
          decoration: et.decoration ?? (et.isButton ? 'button' : 'none'),
        })),
        mainColor: c.mainColor as string,
        customPrompt: c.customPrompt as string,
        hasPersons: c.hasPersons as boolean ?? false,
        selected: true,
        isGenerating: false,
      }));
    } catch {
      return NextResponse.json({ error: 'コンセプトの生成に失敗しました。再度お試しください。' }, { status: 500 });
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

/** スクリーンショット(base64 data URI)を直接Geminiに送る */
async function generateTextWithScreenshot(prompt: string, screenshotBase64: string): Promise<string> {
  // gemini.tsのgenerateTextWithImagesはURL→fetchだが、スクショは既にbase64なので直接API呼び出し
  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

  const base64Data = screenshotBase64.replace(/^data:image\/\w+;base64,/, '');
  const mimeType = screenshotBase64.match(/^data:(image\/\w+);base64,/)?.[1] || 'image/png';

  const response = await ai.models.generateContent({
    model: GEMINI_TEXT_MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: base64Data } },
          { text: prompt },
        ],
      },
    ],
  });

  return response.candidates?.[0]?.content?.parts?.[0]?.text || '';
}
