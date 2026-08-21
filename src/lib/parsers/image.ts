import { generateTextWithBase64Image } from '@/lib/gemini';
import type { ScrapedPageData } from '@/lib/types';

const EXTRACT_PROMPT = `あなたは広告LPの画像から訴求要素を構造化抽出するエキスパートです。
この画像は広告ランディングページ（LP）のスクリーンショット、もしくはLP本文に使われている画像（UTAGE等の画像型LPでよくある形式）です。
バナー広告生成の「素材（URLの代わり）」として使うため、**画像内に書かれているテキストを可能な限り正確に読み取り**、訴求要素として整理してください。

以下の JSON 形式で返してください（コードブロックなし、純粋なJSONのみ。トップレベルにメッセージを書かない）:

{
  "title": "ページ全体の主旨を表すタイトル（1文・40文字以内）",
  "description": "サブコピー・第二訴求の要約（1-2文・150文字以内）",
  "heroTexts": ["ファーストビューや強調コピーで使われている短文。原文どおりに（10件以内・各80文字以内）"],
  "headings": ["セクション見出しに相当するテキスト（10件以内）"],
  "ctaTexts": ["『今すぐ申し込む』『無料で試す』のような CTA ボタン文言。原文どおり。引用記号「」は外して入れる（5件以内・各30文字以内）"],
  "primaryColors": ["画像中で目立つ主要色を Hexコード で 2-5件。#RRGGBB 形式"]
}

ルール:
- 画像にない情報を捏造しない。読み取れなければ空配列・空文字で返す
- 装飾的な記号（☑ ✓ ●など）は外し、本文だけ抽出する
- 同じ文言の重複を避ける
- 必ず JSON 単体で返す`;

interface ExtractedJson {
  title?: string;
  description?: string;
  heroTexts?: string[];
  headings?: string[];
  ctaTexts?: string[];
  primaryColors?: string[];
}

/**
 * 画像（広告LPのスクショや UTAGE 等の本文画像）を Gemini Vision に渡し、
 * 画像内テキスト・訴求要素を抽出して ScrapedPageData に変換する。
 *
 * URLの代わりに「素材」として食わせる前提なので、参考補助ではなくメイン素材として
 * 全文抽出する。
 */
export async function parseImageToScrapedPageData(
  imageDataUrl: string,
  filename?: string
): Promise<ScrapedPageData> {
  const rawText = await generateTextWithBase64Image(EXTRACT_PROMPT, imageDataUrl);
  const parsed = extractJson(rawText);

  const heroTexts = sanitizeStrings(parsed.heroTexts, 10, 80);
  const headings = sanitizeStrings(parsed.headings, 10, 100);
  const ctaTexts = sanitizeStrings(parsed.ctaTexts, 5, 30).map(unquoteJa);
  const primaryColors = (parsed.primaryColors ?? [])
    .filter(c => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c.trim()))
    .map(c => c.trim().toLowerCase())
    .slice(0, 5);

  return {
    url: '',
    title: (parsed.title?.trim() || filename?.replace(/\.[^.]+$/, '') || 'Untitled').slice(0, 120),
    description: (parsed.description?.trim() ?? '').slice(0, 200),
    ogImage: undefined,
    heroImageUrls: [],
    heroTexts,
    headings,
    ctaTexts,
    bodyTextSummary: [parsed.description, ...heroTexts, ...headings]
      .filter(Boolean)
      .join(' / ')
      .slice(0, 500),
    primaryColors,
  };
}

function extractJson(raw: string): ExtractedJson {
  if (!raw) return {};
  // ```json ... ``` で囲まれていれば中身を取り出す
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const candidate = (fenced ? fenced[1] : raw).trim();
  // 最後の手段: { ... } の最大マッチを取る
  const braced = /\{[\s\S]*\}/.exec(candidate);
  const jsonStr = braced ? braced[0] : candidate;
  try {
    return JSON.parse(jsonStr);
  } catch {
    return {};
  }
}

function sanitizeStrings(arr: unknown, max: number, maxLen: number): string[] {
  if (!Array.isArray(arr)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of arr) {
    if (typeof item !== 'string') continue;
    const s = item.replace(/\s+/g, ' ').trim();
    if (!s || s.length > maxLen) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/** 「無料で試す」のようにカギ括弧で括られた文言の引用記号だけ外す */
function unquoteJa(s: string): string {
  return s.replace(/^[「『](.+)[」』]$/, '$1');
}
