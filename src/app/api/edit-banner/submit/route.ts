import { NextRequest, NextResponse } from 'next/server';
import { BannerFormData, hasValidCustomSize } from '@/lib/types';
import { buildEditPrompt, submitEditTask, runEditCombined, isAsyncEngine } from '@/lib/edit-core';
import { isRateLimitError } from '@/lib/generate-core';
import { resizeCoverExact } from '@/lib/image-utils';

// submit は「タスク投入」または同期エンジンの編集のみ。数秒〜十数秒で返るので 60 秒で十分。
export const runtime = 'nodejs';
export const maxDuration = 60;

interface EditBannerRequest {
  imageBase64: string;
  instruction: string;
  formData: BannerFormData;
}

/**
 * 画像編集リクエストの投入。
 * - PoYoエンジン(gpt-image-2 / nano-pro): タスクを submit し { status:'pending', taskId } を返す。
 *   実際の画像取得はクライアントが /api/edit-banner/status をポーリングする。
 * - gemini / openai: 単発同期呼び出しなのでここで編集しきって { status:'finished', imageBase64 } を返す。
 */
export async function POST(request: NextRequest) {
  try {
    const body: EditBannerRequest = await request.json();
    const { imageBase64, instruction, formData } = body;

    if (!imageBase64) {
      return NextResponse.json({ error: '修正する画像がありません' }, { status: 400 });
    }
    if (!instruction.trim()) {
      return NextResponse.json({ error: '修正指示を入力してください' }, { status: 400 });
    }

    const engine = formData.engine ?? 'gpt-image-2';
    const prompt = buildEditPrompt(instruction);

    console.log(`=== EDIT PROMPT [${engine}] ===`);
    console.log(prompt);
    console.log('========================');

    if (!isAsyncEngine(engine)) {
      // 同期エンジンはここで編集しきる
      let editedImageBase64 = await runEditCombined(engine, prompt, formData, imageBase64);
      if (hasValidCustomSize(formData)) {
        editedImageBase64 = await resizeCoverExact(editedImageBase64, formData.customWidth, formData.customHeight);
      }
      return NextResponse.json({ status: 'finished', imageBase64: editedImageBase64 });
    }

    // PoYo: タスク投入だけして即返す
    const taskId = await submitEditTask(engine, prompt, formData, imageBase64);
    return NextResponse.json({ status: 'pending', taskId });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    return NextResponse.json({ error: message }, { status: isRateLimitError(message) ? 429 : 500 });
  }
}
