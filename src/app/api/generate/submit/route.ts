import { NextRequest, NextResponse } from 'next/server';
import { GenerateRequest } from '@/lib/types';
import { prepareGeneration, isAsyncEngine, runEngineCombined, submitPoyoTask, postProcess, isRateLimitError } from '@/lib/generate-core';
import { createGenerationRecord, attachGenerationImage } from '@/lib/generation-history';

// submit は「タスク投入」または同期エンジンの生成のみ。数秒〜十数秒で返るので 60 秒で十分。
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * 生成リクエストの投入。
 * - PoYoエンジン(gpt-image-2 / nano-pro): タスクを submit し { status:'pending', taskId } を返す。
 *   実際の画像取得はクライアントが /api/generate/status をポーリングする。
 * - gemini / openai: 単発同期呼び出しなのでここで生成しきって { status:'finished', ... } を返す。
 */
export async function POST(request: NextRequest) {
  try {
    const body: GenerateRequest = await request.json();
    const { engine, prompt, formData } = await prepareGeneration(body);

    const historyInput = {
      engine, mode: body.mode, prompt,
      mainText: formData.mainText, subText: formData.subText, aspectRatio: formData.aspectRatio,
    };

    if (!isAsyncEngine(engine)) {
      // 同期エンジンはここで生成しきる
      const raw = await runEngineCombined(engine, prompt, formData);
      const result = await postProcess(raw, formData);
      // 生成履歴（学習ループの入口）。履歴の失敗で生成本体は落とさない
      try {
        const rec = await createGenerationRecord(historyInput);
        await attachGenerationImage({ id: rec.id }, result.imageBase64);
      } catch (e) {
        console.warn('[history] 保存失敗:', e);
      }
      return NextResponse.json({ status: 'finished', ...result });
    }

    // PoYo: タスク投入だけして即返す
    const taskId = await submitPoyoTask(engine, prompt, formData);
    await createGenerationRecord({ ...historyInput, taskId }).catch((e) => console.warn('[history] 保存失敗:', e));
    return NextResponse.json({ status: 'pending', taskId });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    return NextResponse.json({ error: message }, { status: isRateLimitError(message) ? 429 : 500 });
  }
}
