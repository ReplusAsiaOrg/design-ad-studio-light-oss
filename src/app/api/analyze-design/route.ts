import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { GEMINI_TEXT_MODEL } from '@/lib/gemini';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

const SYSTEM_PROMPT = `あなたはバナーデザインの分析専門家です。
アップロードされた画像のデザイン要素を分析し、2つのセクションに分けて出力してください。

===出力フォーマット===

【フォーム入力ガイド】
（このバナーを再現するためにフォームにどう入力すべきかの提案。ユーザーはこの情報をもとにフォームに入力する。）

メインテキスト: （画像内の最も目立つテキスト。複数行にまたがる場合は全行をまとめて記述）
改行候補: （メインテキストが長い場合、自然な改行位置を / で区切って提案。例: 本気で / 英語やるなら / プログリット）
サブテキスト: （補足・説明的なテキスト。なければ「なし」）
その他テキスト: （CTAボタン・注釈・キャッチコピーなど。複数あればそれぞれ記載。ボタン風のものは「（ボタン）」と注記。なければ「なし」）
メインカラー: （HEXコード1つ）
人物: （あり/なし）
フォント: （ゴシック/明朝/手書き風 のいずれか）
ロゴ注意: （ロゴがある場合「ロゴが含まれています。ロゴアップロード機能をご利用ください」と記載。なければ省略）

【カスタム指示】
（バナー生成AIへのデザイン仕様。テキスト内容は {{メインテキスト}} {{サブテキスト}} のプレースホルダーで記述。）

配色
背景: （背景の具体的な説明。色・パターン・グラデーション・テクスチャなど詳細に。例: 鮮やかなオレンジ（#f0ad4e）の単色背景）
文字: （メイン文字の色・効果。例: 白抜き文字（#ffffff）、黒い矩形ブロック上に配置して高コントラスト）
アクセント: （帯・バッジ・装飾・ボタンなどの色や効果。例: オレンジ色の角丸ボタン内に白文字）

人物
（人物やキャラクターがいる場合のみ記述。いない場合は「なし」とだけ書く）
描写:
- 種別: （実写/イラスト/アニメ風/デフォルメキャラ等）
- 性別・年代: （例: 30代男性）
- 髪型・髪色: （例: 短髪、茶髪）
- 服装: （例: 黒いスーツ、赤いネクタイ）
- 表情・ポーズ: （例: 真剣な表情でこちらを見ている）
- その他特徴: （ピアス、メガネ、髭など）
配置: （位置とサイズ。例: 画面右側40%にバストアップで配置）

フォント
（【重要】ゴシック体と明朝体を正確に判別すること。判別基準:
  - 明朝体: 横画が細く縦画が太い。画の端に「うろこ」装飾がある。
  - ゴシック体: 縦横の画の太さがほぼ均一。装飾なし。
メインとサブで異なる場合はそれぞれ記述。）

レイアウト
テキスト方向: （横書き/縦書き）
テキスト角度: （【重要】各テキストが水平でない場合は必ず記述。判別方法: テキストの左端と右端の高さが異なれば斜め。右端が上なら「右上がり」、右端が下なら「右下がり」。角度も推定すること。例: {{メインテキスト}}が右上がり約10度で斜めに配置。全て水平なら「全て水平」。）
テキスト配置: （具体的な位置指定。%や左右上下で明確に。例: 画面左60%に{{メインテキスト}}を3行に分けて配置。黒い矩形ブロック（画面左上から60%×50%の範囲）の上に白抜き文字。その直下に{{サブテキスト}}。画面下部10%にCTAボタンを横幅80%で中央配置。）
サイズ比率: （メイン：サブ の対比。例: 約3:1）
装飾・図形: （全ての視覚要素の配置関係を詳細に。ロゴは「ロゴ配置エリア」として場所のみ指定。例: 左下にロゴ配置エリア（画面の15%程度）。テキスト背後に黒い矩形ブロック。ボタンテキストの右に白い右向き三角アイコン。）

スタイル
（デザイン全体の雰囲気を表すキーワードを3〜5個。例: プロフェッショナル、信頼感、力強い）

===厳守ルール===
- 前置き・挨拶・説明文は一切不要。「【フォーム入力ガイド】」から始めること。
- 「はい」「承知しました」等の返答禁止。
- 各セクション見出しの前に # を付けない。
- 【カスタム指示】内のテキスト内容は必ず {{メインテキスト}} {{サブテキスト}} {{ボタンテキスト}} のプレースホルダーで記述。実際の文字内容は絶対に書かない。
- 【フォーム入力ガイド】では逆に、画像内の実際のテキスト内容を正確に読み取って記述すること。
- 人物の描写は具体的に書くこと。「人物」とだけ書くのは禁止。
- ロゴは再現不可能なので、【カスタム指示】では「ロゴ配置エリア」として場所のみ指定。見た目の描写は不要。
- レイアウトは%や具体的な位置関係で指定。「左側に」のような曖昧な表現は避ける。
- テキスト角度の検出は最重要項目の一つ。テキストの左端と右端の高さを注意深く比較し、少しでも傾いていれば「斜め」と報告すること。「水平」と判断する前に必ず再確認。
- 簡潔かつ具体的に。`;

interface FormSuggestion {
  mainText: string;
  subText: string;
  extraTexts: { text: string; decoration?: string }[];
  hasPersons: boolean;
  fontStyle: 'auto' | 'gothic' | 'mincho';
}

function parseGuide(guideText: string): { formSuggestion: FormSuggestion; mainColor: string | null } {
  const mainTextMatch = guideText.match(/メインテキスト:\s*(.+)/);
  const subTextMatch = guideText.match(/サブテキスト:\s*(.+)/);
  const colorMatch = guideText.match(/メインカラー:\s*(#[0-9a-fA-F]{6})/);
  const personMatch = guideText.match(/人物:\s*(あり|なし)/);
  const fontMatch = guideText.match(/フォント:\s*(ゴシック|明朝|手書き風)/);

  // その他テキストを抽出（複数行対応）
  const extraTexts: { text: string; decoration?: string }[] = [];
  const otherSection = guideText.match(/その他テキスト:\s*([\s\S]*?)(?=\nメインカラー:|\n\n|$)/);
  if (otherSection && otherSection[1].trim() !== 'なし') {
    const lines = otherSection[1].trim().split('\n');
    for (const line of lines) {
      const cleaned = line.replace(/^[-・]\s*/, '').trim();
      if (!cleaned || cleaned === 'なし') continue;
      const decoration = /（ボタン）|\(ボタン\)/.test(cleaned) ? 'button' : /（バッジ）|（ラベル）|\(バッジ\)/.test(cleaned) ? 'badge' : /（リボン）|\(リボン\)/.test(cleaned) ? 'ribbon' : /（円形）|（丸形）|\(円形\)/.test(cleaned) ? 'circle' : 'none';
      const text = cleaned.replace(/[（(](ボタン|バッジ|ラベル|リボン|円形|丸形)[）)]/g, '').trim();
      if (text) extraTexts.push({ text, decoration });
    }
  }

  const fontMap: Record<string, 'auto' | 'gothic' | 'mincho'> = {
    'ゴシック': 'gothic',
    '明朝': 'mincho',
    '手書き風': 'auto',
  };

  return {
    formSuggestion: {
      mainText: mainTextMatch?.[1]?.trim() || '',
      subText: subTextMatch?.[1]?.trim() === 'なし' ? '' : (subTextMatch?.[1]?.trim() || ''),
      extraTexts,
      hasPersons: personMatch?.[1] === 'あり',
      fontStyle: fontMap[fontMatch?.[1] || ''] || 'auto',
    },
    mainColor: colorMatch?.[1] ?? null,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { imageBase64 } = body as { imageBase64: string };

    if (!imageBase64) {
      return NextResponse.json({ error: '画像がありません' }, { status: 400 });
    }

    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const mimeType = imageBase64.match(/^data:(image\/\w+);/)?.[1] ?? 'image/png';

    const response = await ai.models.generateContent({
      model: GEMINI_TEXT_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { text: SYSTEM_PROMPT },
            {
              inlineData: {
                mimeType,
                data: base64Data,
              },
            },
            { text: 'この画像のデザイン要素を分析してください。' },
          ],
        },
      ],
    });

    let text = response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('分析結果を取得できませんでした');
    }

    // # 記号が残っていたら除去
    text = text.replace(/^#+\s*/gm, '');

    // 【フォーム入力ガイド】と【カスタム指示】を分離
    const guideMatch = text.match(/【フォーム入力ガイド】\s*([\s\S]*?)(?=【カスタム指示】)/);
    const promptMatch = text.match(/【カスタム指示】\s*([\s\S]*)/);

    const guideText = guideMatch?.[1]?.trim() || '';
    let promptText = promptMatch?.[1]?.trim() || '';

    // カスタム指示が取れなかった場合、全体をプロンプトとして扱う（フォールバック）
    if (!promptText) {
      const headerIndex = text.search(/^(配色|テキスト)\n/m);
      promptText = headerIndex >= 0 ? text.slice(headerIndex).trim() : text.trim();
    }

    // フォーム入力ガイドからフォーム提案を抽出
    const { formSuggestion, mainColor } = parseGuide(guideText);

    // カスタム指示からもメインカラーを抽出（ガイドになかった場合のフォールバック）
    const promptColorMatch = promptText.match(/メインカラー:\s*(#[0-9a-fA-F]{6})/);
    const finalMainColor = mainColor || promptColorMatch?.[1] || null;

    return NextResponse.json({
      guide: guideText,
      prompt: promptText,
      mainColor: finalMainColor,
      formSuggestion,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
