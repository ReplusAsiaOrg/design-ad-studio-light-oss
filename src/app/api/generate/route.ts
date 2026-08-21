import { NextRequest, NextResponse } from 'next/server';
import { GenerateRequest } from '@/lib/types';
import { prepareGeneration, runEngineCombined, postProcess, isRateLimitError } from '@/lib/generate-core';
import { createGenerationRecord, attachGenerationImage } from '@/lib/generation-history';

// 旧来の同期生成エンドポイント（後方互換）。新しいクライアントは submit/status を使う。
// 同期で PoYo を poll しきるため時間がかかる。Hobbyプランの上限60秒を明示。
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body: GenerateRequest = await request.json();
    const { engine, prompt, formData } = await prepareGeneration(body);
    const raw = await runEngineCombined(engine, prompt, formData);
    const result = await postProcess(raw, formData);
    // 生成履歴（学習ループの入口）。履歴の失敗で生成本体は落とさない
    try {
      const rec = await createGenerationRecord({
        engine, mode: body.mode, prompt,
        mainText: formData.mainText, subText: formData.subText, aspectRatio: formData.aspectRatio,
      });
      await attachGenerationImage({ id: rec.id }, result.imageBase64);
    } catch (e) {
      console.warn('[history] 保存失敗:', e);
    }
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    // レート制限はクライアント側でバックオフ・リトライさせたいので 429 を返す
    return NextResponse.json({ error: message }, { status: isRateLimitError(message) ? 429 : 500 });
  }
}
