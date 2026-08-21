import { GoogleGenAI } from '@google/genai';
import type { AspectRatio } from './types';

// 遅延初期化: GEMINI_API_KEY はこのエンジンが実際に呼ばれた時にだけ要求する
// （モジュール読み込み時にthrowすると、他エンジン利用時までルート全体が落ちるため）
let _ai: GoogleGenAI | null = null;
function getAi(): GoogleGenAI {
  if (_ai) return _ai;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set');
  }
  _ai = new GoogleGenAI({ apiKey });
  return _ai;
}

// モデルは固定名でなくGoogleが維持するエイリアス/安定版を既定にする。
// 固定名（例: gemini-2.5-flash）は新規APIキーのユーザーに404で拒否されることがある
// （2026-08 メンバーテストで発生）。環境変数で上書き可能。
const BANNER_MODEL = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-3-pro-image';
export const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL ?? 'gemini-flash-latest';
const TEXT_MODEL = GEMINI_TEXT_MODEL;

// Gemini がサポートするアスペクト比にマッピング
function mapAspectRatioForGemini(ar: AspectRatio): string {
  // Gemini: 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9
  // 全てそのまま使える
  return ar;
}

function extractImageFromResponse(response: { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }> }): string {
  const imagePart = response.candidates?.[0]?.content?.parts?.find(
    (part) => part.inlineData?.mimeType?.startsWith('image/')
  );

  if (!imagePart?.inlineData?.data) {
    throw new Error('画像を生成できませんでした。プロンプトを変えて試してください。');
  }

  return imagePart.inlineData.data;
}

function handleGeminiError(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
    // 「429」を残す（ルート側の isRateLimitError がこの文字列でHTTP 429を返す）
    throw new Error('API利用制限（429 rate limit）に達しました。1〜2分待ってから再度お試しください。');
  }
  throw e;
}

/**
 * Gemini 3 Pro Image でバナー画像を生成する。
 * テキスト描画も含めてAIに一括生成させる。
 */
export async function generateBannerImageWithGemini(
  prompt: string,
  aspectRatio: AspectRatio
): Promise<string> {
  try {
    const response = await getAi().models.generateContent({
      model: BANNER_MODEL,
      contents: prompt,
      config: {
        responseModalities: ['IMAGE'],
        imageConfig: {
          aspectRatio: mapAspectRatioForGemini(aspectRatio),
        },
      },
    });

    return extractImageFromResponse(response);
  } catch (e) {
    handleGeminiError(e);
  }
}

/**
 * Gemini 3 Pro Image で参照画像付きバナーを生成する。
 */
export async function generateBannerImageWithReferenceGemini(
  prompt: string,
  aspectRatio: AspectRatio,
  imageBase64: string
): Promise<string> {
  try {
    // data:image/...;base64, プレフィックスを除去
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const mimeType = imageBase64.match(/^data:(image\/\w+);base64,/)?.[1] || 'image/png';

    const response = await getAi().models.generateContent({
      model: BANNER_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64Data,
              },
            },
            {
              text: prompt,
            },
          ],
        },
      ],
      config: {
        responseModalities: ['IMAGE'],
        imageConfig: {
          aspectRatio: mapAspectRatioForGemini(aspectRatio),
        },
      },
    });

    return extractImageFromResponse(response);
  } catch (e) {
    handleGeminiError(e);
  }
}

/**
 * Gemini 3 Pro Image で既存バナーを部分修正する。
 * テキスト指示を先に、画像を後に渡す（公式推奨順序）。
 * TEXT+IMAGE の responseModalities でモデルに編集内容を推論させる。
 */
export async function editBannerImageWithGemini(
  editInstruction: string,
  aspectRatio: AspectRatio,
  imageBase64: string
): Promise<string> {
  try {
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    // Gemini から返る画像は JPEG なので、実際の形式を推定
    const isJpeg = base64Data.startsWith('/9j/');
    const mimeType = isJpeg ? 'image/jpeg' : 'image/png';

    const response = await getAi().models.generateContent({
      model: BANNER_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: editInstruction,
            },
            {
              inlineData: {
                mimeType,
                data: base64Data,
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: {
          aspectRatio: mapAspectRatioForGemini(aspectRatio),
        },
      },
    });

    return extractImageFromResponse(response);
  } catch (e) {
    handleGeminiError(e);
  }
}

/**
 * カスタム指示（日本語）をバナー生成用の英語に翻訳する。
 * 表示テキスト（「」内）はそのまま日本語で保持。
 */
export async function translateCustomPromptToEnglish(japanesePrompt: string): Promise<string> {
  if (!japanesePrompt.trim()) return '';
  try {
    const response = await getAi().models.generateContent({
      model: TEXT_MODEL,
      contents: `You are a translator for image generation prompts. Translate the following Japanese design instructions into English.

RULES:
- Translate design/layout/style instructions into natural English
- Keep any text content in Japanese that appears in 「」brackets or is clearly meant to be displayed on the banner (product names, slogans, etc.)
- Keep color codes (like #ff0000) as-is
- Keep technical terms (like "Gothic", "Mincho") as-is
- Be concise and direct — this will be used as part of a prompt
- Output ONLY the translated text, no explanations

Japanese input:
${japanesePrompt.trim()}`,
    });
    const result = response.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return result || japanesePrompt.trim();
  } catch {
    // 翻訳失敗時は元の日本語をそのまま返す
    return japanesePrompt.trim();
  }
}

/**
 * Gemini 2.0 Flash でテキスト+画像を入力にテキストを生成する。
 * 画像URLを取得してbase64変換し、マルチモーダルで分析する。
 */
export async function generateTextWithImages(prompt: string, imageUrls: string[]): Promise<string> {
  try {
    // 画像をダウンロードしてbase64に変換（最大3枚、タイムアウト5秒）
    const imageParts: { inlineData: { mimeType: string; data: string } }[] = [];
    for (const url of imageUrls.slice(0, 3)) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BannerGenerator/1.0)' },
        });
        clearTimeout(timeout);
        if (!res.ok) continue;
        const contentType = res.headers.get('content-type') || 'image/jpeg';
        if (!contentType.startsWith('image/')) continue;
        const buffer = await res.arrayBuffer();
        // 5MB以上はスキップ
        if (buffer.byteLength > 5 * 1024 * 1024) continue;
        const base64 = Buffer.from(buffer).toString('base64');
        imageParts.push({
          inlineData: { mimeType: contentType.split(';')[0], data: base64 },
        });
      } catch {
        // 画像取得失敗は無視して続行
        continue;
      }
    }

    if (imageParts.length === 0) {
      // 画像なしの場合はテキストのみで実行
      return generateText(prompt);
    }

    const response = await getAi().models.generateContent({
      model: TEXT_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            ...imageParts,
            { text: prompt },
          ],
        },
      ],
    });

    return response.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
      throw new Error('API利用制限に達しました。');
    }
    // 画像読み込みエラー時はテキストのみにフォールバック
    return generateText(prompt);
  }
}

export async function generateText(prompt: string): Promise<string> {
  try {
    const response = await getAi().models.generateContent({
      model: TEXT_MODEL,
      contents: prompt,
    });

    return response.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
      throw new Error('API利用制限に達しました。');
    }
    throw e;
  }
}

/** base64 (data URI 可) の画像 + テキストプロンプトで Gemini に問い合わせる。extraImagesBase64 で2枚目以降も渡せる */
export async function generateTextWithBase64Image(prompt: string, imageBase64: string, extraImagesBase64: string[] = []): Promise<string> {
  const toPart = (dataUri: string) => {
    const data = dataUri.replace(/^data:image\/\w+;base64,/, '');
    const mimeType = dataUri.match(/^data:(image\/\w+);base64,/)?.[1] || 'image/png';
    return { inlineData: { mimeType, data } };
  };

  try {
    const response = await getAi().models.generateContent({
      model: TEXT_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            toPart(imageBase64),
            ...extraImagesBase64.map(toPart),
            { text: prompt },
          ],
        },
      ],
    });
    return response.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
      throw new Error('API利用制限に達しました。');
    }
    throw e;
  }
}
