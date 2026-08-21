import { NextRequest, NextResponse } from 'next/server';
import { GenerateRequest } from '@/lib/types';
import { pollPoyoTask, postProcess } from '@/lib/generate-core';
import { isTransientPoyoError } from '@/lib/poyo';
import { attachGenerationImage } from '@/lib/generation-history';

// status は「1回ポーリング（+完了時はダウンロード/後処理）」のみ。短時間で返る。
export const runtime = 'nodejs';
export const maxDuration = 60;

interface StatusRequest {
  taskId: string;
  formData: GenerateRequest['formData'];
}

/**
 * PoYoタスクの状況を1回確認する。
 * - finished: 画像をダウンロード＋ロゴ合成/designPlan を付けて { status:'finished', imageBase64, designPlan }
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
      const result = await postProcess(st.imageBase64, formData);
      // submit時に作った履歴レコードへ完成画像を添付（taskIdで突き合わせ・二重保存は内部で防止）
      await attachGenerationImage({ taskId }, result.imageBase64).catch((e) => console.warn('[history] 画像添付失敗:', e));
      return NextResponse.json({ status: 'finished', ...result });
    }
    if (st.status === 'failed') {
      return NextResponse.json({ status: 'failed', error: st.error ?? '生成に失敗しました' });
    }
    return NextResponse.json({ status: 'running', progress: st.progress });
  } catch (error) {
    const message = error instanceof Error ? error.message : '状況取得に失敗しました';
    // 一時エラー（混雑・ネットワーク断）のみ running 扱いでポーリング継続。
    // APIキー無効・タスク不在・成果物なし等の恒久エラーを running にすると永久pendingになる。
    if (isTransientPoyoError(message)) {
      return NextResponse.json({ status: 'running', transientError: message });
    }
    return NextResponse.json({ status: 'failed', error: message });
  }
}
