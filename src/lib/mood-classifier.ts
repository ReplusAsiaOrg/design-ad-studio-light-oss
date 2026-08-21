import { generateText } from './gemini';

// ============================================================
// AIベースのデザインムード分類
// ------------------------------------------------------------
// キーワードマッチ（/学ぶ|稼ぐ/）では副業系・ビジネス系などの曖昧なテキストが
// DEFAULT_MOODに落ちて、常に「bold impactful Gothic」になっていた。
// これをGeminiで意味的に判定し、適切なムード + フォントウェイトを返す。
// ============================================================

export type FontWeight = 'heavy' | 'bold' | 'medium' | 'regular' | 'light' | 'thin';

export interface MoodClassification {
  moodId: string;
  mainWeight: FontWeight;
  subWeight: FontWeight;
  reasoning: string;
}

// 分類候補のムード一覧（openai-prompt-builder.ts の MOOD_RULES と対応）
const MOOD_CATALOG = [
  { id: 'sale', theme: 'セール・プロモーション（激安、期間限定、値引き、キャンペーン）' },
  { id: 'natural', theme: 'ナチュラル・オーガニック（自然派、健康、素材重視、やさしい暮らし）' },
  { id: 'food', theme: '食品・グルメ（料理、レストラン、デリバリー、美味しさ）' },
  { id: 'fresh-produce', theme: '生鮮食品（野菜、果物、鮮度、産地直送）' },
  { id: 'beauty', theme: '美容・ウェルネス（コスメ、スキンケア、女性向け、上品）' },
  { id: 'luxury', theme: '高級・プレミアム（富裕層、ラグジュアリー、VIP、高価格帯）' },
  { id: 'tech', theme: 'テクノロジー（IT、ソフトウェア、デジタル、BtoB、SaaS）' },
  { id: 'education', theme: '教育・学習・スキルアップ・副業・稼ぎ方・自己啓発・コーチング' },
  { id: 'entertainment', theme: 'エンタメ（ゲーム、イベント、ライブ、音楽）' },
  { id: 'recruitment', theme: '採用・求人（仕事紹介、転職、未経験歓迎、職場）' },
  { id: 'travel', theme: '旅行・観光（ツアー、ホテル、旅、リゾート）' },
  { id: 'fashion', theme: 'ファッション（アパレル、トレンド、モード、スタイル）' },
  { id: 'summer', theme: '夏・サマー（海、涼しさ、夏休み、祭り）' },
  { id: 'winter', theme: '冬・ウィンター（クリスマス、年末年始、雪、暖かさ）' },
  { id: 'spring', theme: '春・スプリング（桜、新生活、入学、卒業、新年度）' },
  { id: 'autumn', theme: '秋・オータム（紅葉、ハロウィン、収穫、食欲の秋）' },
  { id: 'cute', theme: 'かわいい・キッズ（子供、ママ、ベビー、ポップ）' },
  { id: 'default', theme: '上記のどれにも明確には該当しない場合の汎用（バランス重視）' },
];

/**
 * テキスト内容からデザインムードとフォントウェイトをAI判定する。
 * 失敗時は null を返し、呼び出し元は従来のキーワードマッチにフォールバックする。
 */
export async function classifyDesignMood(
  mainText: string,
  subText: string,
  extraTexts: string[],
): Promise<MoodClassification | null> {
  const combinedText = [mainText, subText, ...extraTexts].filter(Boolean).join(' / ');
  if (!combinedText.trim()) return null;

  const catalog = MOOD_CATALOG.map(m => `- ${m.id}: ${m.theme}`).join('\n');

  const prompt = `あなたは日本の広告バナーのアートディレクターです。以下のバナーコピーから、もっとも適切なデザインムードとフォントウェイトを判定してください。

# バナーコピー
${combinedText}

# ムード候補（必ずこの中から1つ選ぶ）
${catalog}

# フォントウェイトの選択肢
heavy（極太）/ bold（太）/ medium（中）/ regular（標準）/ light（細）/ thin（極細）

# 判定ルール
- コピーの「空気感」で判断する（単語マッチではなく、文脈と情緒）
- インパクトが必要な煽り系コピー → main: heavy、sub: medium
- 上品・繊細・女性的なコピー → main: medium or light、sub: light or thin
- 親しみやすい・柔らかい → main: bold、sub: regular
- 高級感・ラグジュアリー → main: bold、sub: light
- main と sub は必ずウェイトに「差」をつける（同じウェイトにしない）

# 出力形式（JSON only、コードブロック禁止）
{"moodId": "xxx", "mainWeight": "xxx", "subWeight": "xxx", "reasoning": "簡潔な判定理由（20文字以内）"}`;

  try {
    const response = await generateText(prompt);
    const cleaned = response.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    const parsed = JSON.parse(cleaned);

    const validIds = MOOD_CATALOG.map(m => m.id);
    const validWeights: FontWeight[] = ['heavy', 'bold', 'medium', 'regular', 'light', 'thin'];

    if (
      typeof parsed.moodId !== 'string' ||
      !validIds.includes(parsed.moodId) ||
      !validWeights.includes(parsed.mainWeight) ||
      !validWeights.includes(parsed.subWeight)
    ) {
      return null;
    }

    return {
      moodId: parsed.moodId,
      mainWeight: parsed.mainWeight,
      subWeight: parsed.subWeight,
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
    };
  } catch {
    return null;
  }
}
