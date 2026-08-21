import { NextRequest, NextResponse } from 'next/server';
import { fixBannerText } from '@/lib/openai';
import { mapFormToEngineSize } from '@/lib/openai-prompt-builder';
import { BannerFormData } from '@/lib/types';

interface FixTextRequest {
  imageBase64: string;
  formData: BannerFormData;
}

function buildFixTextPrompt(formData: BannerFormData): string {
  const { mainText, subText, extraTexts } = formData;
  const extras = extraTexts.filter(t => t.text.trim());

  const lines: string[] = [];

  lines.push(`このバナー画像の日本語テキストを修正してください。`);
  lines.push(`デザイン・レイアウト・配色・人物・背景は一切変更せず、テキストのみを正確な日本語に置き換えること。`);
  lines.push(``);
  lines.push(`# 正しいテキスト`);
  if (mainText) lines.push(`- メイン: 「${mainText}」`);
  if (subText) lines.push(`- サブ: 「${subText}」`);
  extras.forEach((et, i) => {
    lines.push(`- その他${i + 1}: 「${et.text}」`);
  });

  lines.push(``);
  lines.push(`# ルール`);
  lines.push(`- 上記のテキスト以外は画像に含めないこと。余計なテキストがあれば削除する`);
  lines.push(`- 各テキストは一文字も間違えずに正確に表示すること`);
  lines.push(`- フォント・サイズ・色・位置・装飾は元の画像をできるだけ維持すること`);
  lines.push(`- 人物の顔・外見・背景・レイアウトは絶対に変更しないこと`);

  return lines.join('\n');
}

export async function POST(request: NextRequest) {
  try {
    const body: FixTextRequest = await request.json();
    const { imageBase64, formData } = body;

    if (!imageBase64) {
      return NextResponse.json({ error: '修正する画像がありません' }, { status: 400 });
    }

    const prompt = buildFixTextPrompt(formData);
    const size = mapFormToEngineSize(formData);

    const fixedImageBase64 = await fixBannerText(prompt, size, imageBase64);

    return NextResponse.json({ imageBase64: fixedImageBase64 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
