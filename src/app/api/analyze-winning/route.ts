import { NextRequest, NextResponse } from 'next/server';
import { generateTextWithBase64Image } from '@/lib/text-llm';
import type { WinningAnalysis, WinningTrigger, WinningTriggerKind } from '@/lib/types';
import { TASTE_CATALOG, DEFAULT_TASTE_KEYS } from '@/lib/winning-tastes';

const validTasteKeys = TASTE_CATALOG.map((t) => t.key);

/**
 * AI が返した tasteSuggestions を検証して必ず3件にする。
 * 不正キー・重複・元画風と同じものを除き、足りなければ DEFAULT_TASTE_KEYS で補完。
 */
function normalizeTasteSuggestions(raw: unknown, currentTaste: string): string[] {
  const fromAi = Array.isArray(raw)
    ? (raw as unknown[]).filter(
        (k): k is string => typeof k === 'string' && validTasteKeys.includes(k) && k !== currentTaste,
      )
    : [];
  const merged = [
    ...new Set([
      ...fromAi,
      ...DEFAULT_TASTE_KEYS.filter((k) => k !== currentTaste),
      ...validTasteKeys.filter((k) => k !== currentTaste),
    ]),
  ];
  return merged.slice(0, 3);
}

const VALID_TRIGGER_KINDS: WinningTriggerKind[] = [
  'scarcity',
  'social-proof',
  'authority',
  'loss-aversion',
  'anchoring',
  'urgency',
  'reciprocity',
  'curiosity',
  'other',
];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { imageBase64: string };
    const { imageBase64 } = body;

    if (!imageBase64) {
      return NextResponse.json({ error: '画像がありません' }, { status: 400 });
    }

    const prompt = `You are a senior advertising creative strategist analyzing a HIGH-PERFORMING ("winning") Japanese ad creative banner. The user wants to understand WHY this creative is working so they can produce new creatives that inherit the same winning formula.

Analyze the image across 3 dimensions and extract its winning elements. Be specific and concrete — vague statements like "good design" are useless. Cite actual elements visible in the image.

## 1. Visual elements (ビジュアル要素)
- colorContrast: 配色とコントラストの特徴。どの色とどの色が支配的で、どこにコントラストが効いているか (Japanese, 1-2 sentences)
- layout: レイアウト構成。どこに何が配置されているか、どんなグリッド/構図か (Japanese, 1-2 sentences)
- typography: フォントの印象。明朝/ゴシック/手書き/丸ゴ等の使い分けと太さ・大きさが与える印象 (Japanese, 1-2 sentences)
- eyeFlow: 視線誘導の流れ。Z字/F字/中央集中など、どの順で目が動くように設計されているか (Japanese, 1-2 sentences)
- paletteHex: 主要色のHexコード配列 (2-4 colors, dominant first)

## 2. Message elements (メッセージ要素)
- appealAxis: キャッチコピーの訴求軸。何を一番訴えているか — ベネフィット型/問題提起型/権威型/感情型など (Japanese, 1-2 sentences)
- hookPoint: ターゲットに刺さっているポイント。なぜこの言い回しがターゲットに刺さるのか、具体的な刺さりどころ (Japanese, 1-2 sentences)
- cta: CTAの文言と配置。どんなボタン/フレーズで、どこに置かれているか。ボタンが無ければ無い旨を書く (Japanese, 1-2 sentences)
- mainText / subText / extraTexts: 画像内のEXACTな日本語テキストを忠実に抽出。意訳・要約・翻訳しない。decoration は "none" | "button" | "badge" | "ribbon" | "circle"

## 3. Psychological triggers (心理的トリガー)
画像から読み取れる心理トリガーを列挙する。検出された分だけ含める（1個でも5個でも可）。当てはまらないトリガーは含めない。

判定基準（kind の値と意味）:
- "scarcity" — 希少性: 「数量限定」「先着〇名」など量の限定
- "social-proof" — 社会的証明: 「〇万人が選んだ」「満足度93%」「口コミ多数」など
- "authority" — 権威性: メディア掲載/専門家監修/受賞/数値による実績など
- "loss-aversion" — 損失回避: 「今やらないと損」「失敗しない選び方」「逃すと…」など
- "anchoring" — アンカリング: 「通常〇円→今だけ〇円」のような価格比較
- "urgency" — 緊急性: 「今だけ」「本日締切」「期間限定」など時間の限定
- "reciprocity" — 返報性: 「無料プレゼント」「特典あり」など先に与える系
- "curiosity" — 好奇心: 問いかけ・伏字・「実は…」など未開示で続きを読ませる
- "other" — 上記に当てはまらないが明確に効いている要素があれば

各 trigger の evidence は「画像のどこを根拠にそう判定したか」を日本語1-2文で書く。"summary" には全体としてのトリガー設計の意図を1-2文で書く。

## イラストテイスト判定（テイスト替えA/Bテスト用）
- currentTaste: 元画像の描画スタイルを次から1つだけ選ぶ:
  "anime"（アニメ調・セル画）| "irasutoya"（いらすとや風・ゆるいフラットクリップアート）| "flat"（フラットベクターイラスト・IT/BtoB風）| "watercolor"（水彩・手描き風）| "scandinavian"（北欧ミニマル風）| "retro-pop"（レトロポップ・アメコミ調）| "photoreal"（実写・写真）| "other"
- tasteSuggestions: 同じリスト（"other"除く）から3つ選ぶ。条件:
  1. currentTaste と明確に「ぱっと見の印象」が変わるもの（似た画風は選ばない。例: アニメ調のCRに水彩やレトロポップを選んでも差が出にくい → 実写・いらすとや・フラットのような距離の遠い画風を優先）
  2. この商材・ターゲット層に広告として成立するもの
  3. 印象差が大きい順に並べる。currentTaste と同じ値・重複は禁止

## その他
- contextSummary: 推定される業種・対象（日本語1文。例: 「30代女性向け美容・スキンケア商品の購入訴求バナー」）
- winningPattern: この勝ちCRの「勝ちパターン」を2-3文で総括する。配色・コピー・トリガーの組み合わせとして何が効いているのか — 後続のパターン生成のベースラインとして使う、最も重要なフィールド
- hasPersons: 人物/キャラクターが映っているか

## formatBlueprint（勝ちフォーマットの詳細構造記述、英語）
これは Tier A（勝ちフォーマット直系・コピーだけABテスト）の画像生成プロンプト土台として使う、最重要フィールド。画像AIが元画像を見ない前提で、構図・配色・モチーフを忠実に再現できるレベルで記述する。

含めるべき要素:
- Canvas structure: zone を %座標で記述（例: "left half (0-50%) holds problem panel, right half (50-100%) holds solution panel, top 12% reserved for headline, bottom 18% reserved for CTA button"）
- Each zone's content: 各 zone に何が描かれているか — 色、人物の有無と配置、イラスト/写真、装飾要素（バッジ、ribbon、円形吹き出し等）
- Color palette: zone別の正確な配色（Hex でなくても "deep navy + electric red on left", "bright sky blue + warm yellow on right" のように具体的に）
- Typography placement: 見出し・サブ・CTAそれぞれが zone のどこに、どんなウェイト/フォントで配置されているか
- Decorative motifs: 「ピクセル風スポーン文字」「縁取り太ゴシック」「コインの装飾」「キラキラ」など独自のモチーフ
- CTA style: ボタン色・形状・矢印有無・配置位置
- Person/character details: 人物が居る場合、性別・年齢層・服装・表情・ポーズ・どこに配置か
- Style reference cues: pixel-art / cel-shading / photographic / hand-drawn など描画スタイル

書き方のルール:
- 英語で書く（画像生成AI用）
- 具体的・断定的に記述（"maybe", "could be" 禁止）
- 8-15文程度。短すぎると再現できず、長すぎるとAIがフリーズする
- 元画像の Japanese テキスト内容は formatBlueprint には書かない（テキストは Tier A 側で別途差し替えるため。ただしテキストの **位置/扱い** は記述する。例: "headline placed in top band, sub copy inside left/right panels, CTA button at bottom center"）

良い例:
"Square 1:1 banner split vertically at 50%. Top band (0-12% height) carries the headline in extra-bold rounded gothic, white on dark background. Left half (12-82%): deep purple/red gradient background, pixel-art style 'GAME OVER' decorative text in retro yellow at top of the zone, illustrated worried male figure (anime style) clutching head with red coin/cost overlays scattered around, large red price callouts in bold pixel font. Right half (12-82%): bright sky-blue gradient background with golden coin sparkles, two cheerful illustrated figures (one female, one male, anime style, business casual) high-fiving, large bold yellow text with white outline. Bottom band (82-100%): single full-width green rounded CTA button with white bold text and right-pointing triangle arrow, slight glow. Overall art direction: Japanese mobile-game ad aesthetic, cel-shaded anime illustrations, high contrast, attention-grabbing."

## 出力ルール
- マークダウンや説明文は禁止。JSONオブジェクトのみ出力
- 日本語フィールドは日本語、Hexコードは大文字 #RRGGBB 形式
- decoration は列挙値以外を出さない
- 元のテキストを書き換えない

Schema:
{
  "visual": {
    "colorContrast": "...",
    "layout": "...",
    "typography": "...",
    "eyeFlow": "...",
    "paletteHex": ["#RRGGBB", "#RRGGBB"]
  },
  "message": {
    "appealAxis": "...",
    "hookPoint": "...",
    "cta": "...",
    "mainText": "...",
    "subText": "...",
    "extraTexts": [{"text":"...","decoration":"none|button|badge|ribbon|circle"}]
  },
  "psychology": {
    "triggers": [
      {"kind":"scarcity|social-proof|authority|loss-aversion|anchoring|urgency|reciprocity|curiosity|other","label":"日本語名","evidence":"..."}
    ],
    "summary": "..."
  },
  "contextSummary": "...",
  "winningPattern": "...",
  "hasPersons": false,
  "formatBlueprint": "...",
  "currentTaste": "anime|irasutoya|flat|watercolor|scandinavian|retro-pop|photoreal|other",
  "tasteSuggestions": ["...", "...", "..."]
}`;

    const result = await generateTextWithBase64Image(prompt, imageBase64);

    let analysis: WinningAnalysis;
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('JSON not found');
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

      const visual = (parsed.visual as Record<string, unknown>) || {};
      const message = (parsed.message as Record<string, unknown>) || {};
      const psychology = (parsed.psychology as Record<string, unknown>) || {};
      const triggersRaw = (psychology.triggers as Record<string, unknown>[]) || [];

      const triggers: WinningTrigger[] = triggersRaw
        .map(t => {
          const rawKind = t.kind as string;
          const kind = (VALID_TRIGGER_KINDS as string[]).includes(rawKind)
            ? (rawKind as WinningTriggerKind)
            : 'other';
          return {
            kind,
            label: (t.label as string) || kind,
            evidence: (t.evidence as string) || '',
          };
        })
        .filter(t => t.label && t.evidence);

      analysis = {
        visual: {
          colorContrast: (visual.colorContrast as string) || '',
          layout: (visual.layout as string) || '',
          typography: (visual.typography as string) || '',
          eyeFlow: (visual.eyeFlow as string) || '',
          paletteHex: ((visual.paletteHex as string[]) || []).filter(c => /^#[0-9A-Fa-f]{6}$/.test(c)),
        },
        message: {
          appealAxis: (message.appealAxis as string) || '',
          hookPoint: (message.hookPoint as string) || '',
          cta: (message.cta as string) || '',
          mainText: (message.mainText as string) || '',
          subText: (message.subText as string) || '',
          extraTexts: ((message.extraTexts as { text: string; decoration?: string }[]) || []).map(et => ({
            text: et.text,
            decoration: (et.decoration as WinningAnalysis['message']['extraTexts'][number]['decoration']) ?? 'none',
          })),
        },
        psychology: {
          triggers,
          summary: (psychology.summary as string) || '',
        },
        contextSummary: (parsed.contextSummary as string) || '',
        winningPattern: (parsed.winningPattern as string) || '',
        hasPersons: !!parsed.hasPersons,
        formatBlueprint: (parsed.formatBlueprint as string) || '',
        currentTaste: validTasteKeys.includes(parsed.currentTaste as string)
          ? (parsed.currentTaste as string)
          : 'other',
        tasteSuggestions: normalizeTasteSuggestions(
          parsed.tasteSuggestions,
          parsed.currentTaste as string,
        ),
      };
    } catch {
      return NextResponse.json({ error: '画像の分析に失敗しました。再度お試しください。' }, { status: 500 });
    }

    return NextResponse.json({ analysis });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
