import { NextRequest, NextResponse } from 'next/server';
import { pollPoyoTask } from '@/lib/generate-core';
import { isTransientPoyoError } from '@/lib/poyo';
import { resizeCoverExact } from '@/lib/image-utils';
import { hasValidCustomSize, type BannerFormData } from '@/lib/types';

// status は「1回ポーリング（+完了時はダウンロード）」のみ。短時間で返る。
export const runtime = 'nodejs';
export const maxDuration = 60;

interface StatusRequest {
  taskId: string;
  /** カスタムサイズのクロップ用（Issue #29）。旧クライアントは送らないので任意 */
  formData?: BannerFormData;
}

/**
 * 編集PoYoタスクの状況を1回確認する。
 * - finished: 編集後画像を { status:'finished', imageBase64 } で返す（編集はロゴ合成/designPlan は不要）
 * - failed:   { status:'failed', error }
 * - それ以外: { status:'running', progress }
 */
export async function POST(request: NextRequest) {
  try {
    const { taskId, formData }: StatusRequest = await request.json();
    if (!taskId) {
      return NextResponse.json({ error: 'taskId が指定されていません' }, { status: 400 });
    }

    const st = await pollPoyoTask(taskId);

    if (st.status === 'finished' && st.imageBase64) {
      const image = formData && hasValidCustomSize(formData)
        ? await resizeCoverExact(st.imageBase64, formData.customWidth, formData.customHeight)
        : st.imageBase64;
      return NextResponse.json({ status: 'finished', imageBase64: image });
    }
    if (st.status === 'failed') {
      return NextResponse.json({ status: 'failed', error: st.error ?? '修正に失敗しました' });
    }
    return NextResponse.json({ status: 'running', progress: st.progress });
  } catch (error) {
    const message = error instanceof Error ? error.message : '状況取得に失敗しました';
    // 一時エラーのみ running 扱いでポーリング継続。恒久エラーは failed で確定させる（永久pending防止）
    if (isTransientPoyoError(message)) {
      return NextResponse.json({ status: 'running', transientError: message });
    }
    return NextResponse.json({ status: 'failed', error: message });
  }
}
