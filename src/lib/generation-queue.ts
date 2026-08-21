import type { BannerFormData, GenerateMode } from '@/lib/types';
import { generateBanner } from '@/lib/generate-client';

/**
 * クライアント側の逐次生成キュー。
 *
 * 背景: バリエーション/勝ち分析で複数枚を一気に並列生成すると、PoYo 側の
 * 同時実行上限・レート制限（429）に当たり「6個中4個で止まる」事故が起きていた。
 * 旧実装は concurrency=3 のワーカープール + 429 リトライなしだったため、
 * 制限に当たったジョブはそのまま error 表示で脱落していた。
 *
 * このキューは:
 *  - 既定 concurrency=1 で「1枚できたら次を投入」する（同時送信しない）
 *  - 429 / 5xx / ネットワーク断は指数バックオフで自動リトライ
 *  - 各ジョブの状態をコールバックで通知し、ギャラリーに逐次反映できる
 */

export interface GenerateJob {
  /** 結果を紐付けるための一意ID（呼び出し側の state のキーと一致させる） */
  id: string;
  formData: BannerFormData;
  mode?: GenerateMode;
}

export interface QueueCallbacks {
  /** ジョブの実行開始時（「生成中…」表示に使う） */
  onStart?: (id: string) => void;
  /** 成功時。imageBase64 は data URL 形式（data:image/png;base64,...） */
  onSuccess: (id: string, imageDataUrl: string) => void;
  /** 失敗時（リトライを使い切った後） */
  onError: (id: string, message: string) => void;
  /** 全体進捗（完了数 / 総数）。プログレスバー表示に使う */
  onProgress?: (done: number, total: number) => void;
}

export interface QueueOptions {
  /** 同時実行数。既定 1（= 完全逐次）。安定後に 2 へ上げられる余地を残す */
  concurrency?: number;
  /** レート制限・一時障害時の最大リトライ回数（既定 3） */
  maxRetries?: number;
  /** 中止用シグナル。abort されると残ジョブの送信を止める */
  signal?: AbortSignal;
}

/**
 * ジョブ配列を逐次（既定）実行する。各ジョブの結果はコールバック経由で通知。
 * Promise は全ジョブの処理完了で解決する（個々の失敗では reject しない）。
 *
 * 各ジョブは generateBanner（submit→ブラウザ側poll）で処理され、submitの
 * 429/5xx 再投入もその内部で行う。
 */
export async function runGenerationQueue(
  jobs: GenerateJob[],
  callbacks: QueueCallbacks,
  options: QueueOptions = {},
): Promise<void> {
  const { concurrency = 1, signal } = options;
  const total = jobs.length;
  if (total === 0) return;

  const queue = [...jobs];
  let done = 0;

  const worker = async () => {
    while (queue.length > 0) {
      if (signal?.aborted) return;
      const job = queue.shift()!;
      callbacks.onStart?.(job.id);
      try {
        const { imageBase64 } = await generateBanner(job.formData, job.mode, { signal });
        callbacks.onSuccess(job.id, `data:image/png;base64,${imageBase64}`);
      } catch (e) {
        const message = e instanceof Error ? e.message : 'エラー';
        if (message === 'aborted') return;
        callbacks.onError(job.id, message);
      } finally {
        done += 1;
        callbacks.onProgress?.(done, total);
      }
    }
  };

  const workerCount = Math.max(1, Math.min(concurrency, total));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}
