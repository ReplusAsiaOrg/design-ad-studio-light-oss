import OpenAI, { toFile } from 'openai';
import {
  parseCreativeTraits,
  renderTraitsVocabularyForPrompt,
  type CreativeTraits,
} from './genes';

// 遅延初期化: OPENAI_API_KEY はこのエンジンが実際に呼ばれた時にだけ要求する
let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (_openai) return _openai;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set');
  }
  _openai = new OpenAI({ apiKey });
  return _openai;
}

/**
 * Phase 2: 広告クリエイティブ画像を CreativeTraits（閉じた語彙）に分類する。
 * GEMINI_API_KEY不要・OPENAI_API_KEYのみで動く vision分類。
 * gpt-4o-mini に画像＋語彙を渡し JSON を生成、parseCreativeTraits で厳密検証する。
 */
export async function classifyCreativeTraits(
  imageBase64: string,
  mimeType = 'image/jpeg',
): Promise<CreativeTraits> {
  const imageUrl = imageBase64.startsWith('data:')
    ? imageBase64
    : `data:${mimeType};base64,${imageBase64}`;

  const prompt = `You are an advertising creative analyst. Look at this Japanese ad creative (a static banner OR a video thumbnail) and tag its STRUCTURE using a fixed vocabulary. Judge only what is visible.

${renderTraitsVocabularyForPrompt()}

Output rules:
- Return ONLY a JSON object of the form {"traits": { ... }}. No markdown, no commentary.
- Use ONLY the listed enum ids (the Japanese in parentheses is guidance, not a value). hooks is an array of 1-2 ids, most dominant appeal first.
- schemaVersion must be the number 1.`;

  // ライト版: GEMINI_API_KEY があれば Gemini vision、無ければ OpenAI（text-llm.ts と同じ切替方針。
  // OpenAIキーのクォータ切れでも genes分類が止まらないようにする）
  let text: string;
  if (process.env.GEMINI_API_KEY) {
    const { generateTextWithBase64Image: geminiVision } = await import('./gemini');
    text = await geminiVision(prompt, imageUrl);
  } else {
    const response = await getOpenAI().responses.create({
      model: 'gpt-4o-mini',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_image', image_url: imageUrl, detail: 'low' },
            { type: 'input_text', text: prompt },
          ],
        },
      ],
    });
    text = response.output_text ?? '';
  }
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('vision分類の応答にJSONが見つかりませんでした');
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    throw new Error('vision分類の応答JSONを解析できませんでした');
  }
  const traitsRaw = (parsed.traits as unknown) ?? parsed;
  const traits = parseCreativeTraits(traitsRaw);
  if (!traits) throw new Error('CreativeTraitsが語彙に適合しませんでした');
  return traits;
}

export async function generateBannerImage(
  prompt: string,
  size: '1024x1024' | '1536x1024' | '1024x1536' = '1024x1024'
): Promise<string> {
  try {
    const response = await getOpenAI().images.generate({
      model: 'gpt-image-2',
      prompt,
      n: 1,
      size,
      quality: 'high',
    });

    const imageData = response.data?.[0];
    if (!imageData) {
      throw new Error('画像データを取得できませんでした');
    }

    if (imageData.b64_json) {
      return imageData.b64_json;
    }

    if (imageData.url) {
      const imgRes = await fetch(imageData.url);
      const buffer = await imgRes.arrayBuffer();
      return Buffer.from(buffer).toString('base64');
    }

    throw new Error('画像データの形式が不明です');
  } catch (e) {
    handleApiError(e);
    throw e;
  }
}

export async function generateBannerImageWithReference(
  prompt: string,
  size: '1024x1024' | '1536x1024' | '1024x1536',
  imageBase64: string
): Promise<string> {
  try {
    // data:image/...;base64, プレフィックスを除去
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const file = await toFile(buffer, 'reference.png', { type: 'image/png' });

    const response = await getOpenAI().images.edit({
      model: 'gpt-image-2',
      image: file,
      prompt,
      n: 1,
      size,
      quality: 'high',
    });

    const imageData = response.data?.[0];
    if (!imageData) {
      throw new Error('画像データを取得できませんでした');
    }

    if (imageData.b64_json) {
      return imageData.b64_json;
    }

    if (imageData.url) {
      const imgRes = await fetch(imageData.url);
      const arrayBuf = await imgRes.arrayBuffer();
      return Buffer.from(arrayBuf).toString('base64');
    }

    throw new Error('画像データの形式が不明です');
  } catch (e) {
    handleApiError(e);
    throw e;
  }
}

export async function fixBannerText(
  prompt: string,
  size: '1024x1024' | '1536x1024' | '1024x1536',
  imageBase64: string
): Promise<string> {
  // data:image/...;base64, プレフィックスがなければ付与
  const imageUrl = imageBase64.startsWith('data:')
    ? imageBase64
    : `data:image/png;base64,${imageBase64}`;

  const response = await getOpenAI().responses.create({
    model: 'gpt-4o-mini',
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_image',
            image_url: imageUrl,
            detail: 'high',
          },
          {
            type: 'input_text',
            text: prompt,
          },
        ],
      },
    ],
    tools: [
      {
        type: 'image_generation',
        quality: 'high',
        size,
        output_format: 'png',
        input_fidelity: 'high',
      },
    ],
  });

  const imageOutput = response.output.find(
    (item: { type: string }) => item.type === 'image_generation_call'
  );

  if (imageOutput && 'result' in imageOutput && imageOutput.result) {
    return imageOutput.result as string;
  }

  throw new Error('画像の生成結果を取得できませんでした');
}

/**
 * テキスト生成（GEMINI不要のフォールバック）。gpt-4oで日本語品質・指示追従を確保。
 * 勝ち分析→6案生成のような重い構造化生成に使う。
 */
export async function generateTextOpenAI(prompt: string): Promise<string> {
  try {
    const response = await getOpenAI().responses.create({
      model: 'gpt-4o',
      input: prompt,
    });
    return response.output_text ?? '';
  } catch (e) {
    handleApiError(e);
    throw e;
  }
}

/** base64画像（data URI可）＋テキストで vision 問い合わせ（GEMINI不要のフォールバック）。 */
export async function generateTextWithBase64ImageOpenAI(
  prompt: string,
  imageBase64: string,
): Promise<string> {
  const imageUrl = imageBase64.startsWith('data:')
    ? imageBase64
    : `data:image/png;base64,${imageBase64}`;
  try {
    const response = await getOpenAI().responses.create({
      model: 'gpt-4o',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_image', image_url: imageUrl, detail: 'high' },
            { type: 'input_text', text: prompt },
          ],
        },
      ],
    });
    return response.output_text ?? '';
  } catch (e) {
    handleApiError(e);
    throw e;
  }
}

function handleApiError(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes('429') || msg.includes('rate_limit')) {
    // 「429」を残す（ルート側の isRateLimitError がこの文字列でHTTP 429を返す）
    throw new Error('API利用制限（429 rate limit）に達しました。しばらく待ってから再度お試しください。');
  }
  if (msg.includes('billing') || msg.includes('quota')) {
    // 課金上限・クレジット切れは待っても直らない恒久エラー。
    // isRateLimitError に誤マッチしないよう「429」「quota」を含む元文言は載せない
    throw new Error('APIの課金上限/クレジット切れです。OpenAI platform → Billing を確認してください。');
  }
  throw e;
}
