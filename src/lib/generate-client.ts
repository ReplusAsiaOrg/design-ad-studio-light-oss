import type { BannerFormData, DesignPlan, GenerateMode } from '@/lib/types';

/**
 * クライアント側の生成ヘルパー（基盤C）。
 *
 * 旧来は /api/generate を1回叩いてサーバー内で submit→poll（最大数分）していたが、
 * サーバーレス関数の実行時間上限（本番60秒）を超えるとタイムアウトして失敗していた。
 *
 * ここでは submit/status に分割し、ポーリングをブラウザ側で行う:
 *  - /api/generate/submit でタスク投入（数秒で返る）
 *  - /api/generate/status を数秒間隔でポーリング（各リクエストは短時間）
 * これで個々のサーバーリクエストが短くなり、60秒制限に当たらず「待てば出る」を実現する。
 */

export interface GenerateResult {
  imageBase64: string;
  designPlan: DesignPlan;
}

const POLL_INTERVAL_MS = 3000;
// PoYoは混雑時に軽い生成でも4分前後かかる実測があり（Issue #27）、複雑なプロンプト＋ロゴ付きは
// 10分を超えることがある。打ち切るとタスクごと失われるため長めに待つ。
const CLIENT_TIMEOUT_MS = 20 * 60 * 1000; // 20分
const TIMEOUT_MESSAGE =
  '生成がタイムアウトしました（20分）。生成サービス（PoYo）が混雑している可能性があります。時間をおいて再試行するか、エンジンを「正規版 (OpenAI直)」に切り替えてお試しください';
const SUBMIT_MAX_RETRIES = 3;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function postJson(url: string, payload: unknown, signal?: AbortSignal): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  let data: Record<string, unknown> = {};
  try { data = await res.json(); } catch { /* 非JSON応答 */ }
  return { status: res.status, data };
}

interface GenerateOptions {
  signal?: AbortSignal;
  /** ポーリングのたびに進捗(0-100)を通知（任意） */
  onProgress?: (progress: number) => void;
}

export async function generateBanner(
  formData: BannerFormData,
  mode: GenerateMode | undefined,
  opts: GenerateOptions = {},
): Promise<GenerateResult> {
  const { signal, onProgress } = opts;

  // 1) submit（429/5xx はバックオフして再投入）
  let taskId: string | null = null;
  for (let attempt = 0; attempt <= SUBMIT_MAX_RETRIES; attempt++) {
    if (signal?.aborted) throw new Error('aborted');
    const { status, data } = await postJson('/api/generate/submit', { formData, mode }, signal);

    if (status === 200 && data.status === 'finished') {
      // 同期エンジン（gemini/openai）はここで完了
      return { imageBase64: data.imageBase64 as string, designPlan: (data.designPlan ?? { elements: [] }) as DesignPlan };
    }
    if (status === 200 && data.status === 'pending' && data.taskId) {
      taskId = data.taskId as string;
      break;
    }
    // エラー
    const message = (data.error as string) || `投入に失敗しました (HTTP ${status})`;
    if (attempt < SUBMIT_MAX_RETRIES && isRetryableStatus(status)) {
      await sleep(2000 * 2 ** attempt + Math.floor(Math.random() * 500));
      continue;
    }
    throw new Error(message);
  }
  if (!taskId) throw new Error('生成タスクの投入に失敗しました');

  // 2) status ポーリング（個々のリクエストは短時間。running の間は待ち続ける）
  const deadline = Date.now() + CLIENT_TIMEOUT_MS;
  while (true) {
    if (signal?.aborted) throw new Error('aborted');
    await sleep(POLL_INTERVAL_MS);
    if (signal?.aborted) throw new Error('aborted');

    let result: { status: number; data: Record<string, unknown> };
    try {
      result = await postJson('/api/generate/status', { taskId, formData }, signal);
    } catch {
      if (signal?.aborted) throw new Error('aborted');
      // 一時的な通信エラーはポーリング継続
      if (Date.now() > deadline) throw new Error(TIMEOUT_MESSAGE);
      continue;
    }

    const { data } = result;
    if (data.status === 'finished') {
      return { imageBase64: data.imageBase64 as string, designPlan: (data.designPlan ?? { elements: [] }) as DesignPlan };
    }
    if (data.status === 'failed') {
      throw new Error((data.error as string) || '生成に失敗しました');
    }
    if (typeof data.progress === 'number') onProgress?.(data.progress as number);
    if (Date.now() > deadline) throw new Error(TIMEOUT_MESSAGE);
  }
}

/**
 * 画像編集（テキスト修正）の submit/poll 版。
 *
 * 旧来は /api/edit-banner を1回叩いてサーバー内で編集しきっていたが、編集も
 * 画像生成と同程度に時間がかかり本番60秒制限を超えて 504 になっていた。
 * generateBanner と同じく submit → status ポーリングに分割する。
 */
export async function editBannerImage(
  imageBase64: string,
  instruction: string,
  formData: BannerFormData,
  opts: GenerateOptions = {},
): Promise<{ imageBase64: string }> {
  const { signal, onProgress } = opts;

  // 1) submit（429/5xx はバックオフして再投入）
  let taskId: string | null = null;
  for (let attempt = 0; attempt <= SUBMIT_MAX_RETRIES; attempt++) {
    if (signal?.aborted) throw new Error('aborted');
    const { status, data } = await postJson('/api/edit-banner/submit', { imageBase64, instruction, formData }, signal);

    if (status === 200 && data.status === 'finished') {
      // 同期エンジン（gemini/openai）はここで完了
      return { imageBase64: data.imageBase64 as string };
    }
    if (status === 200 && data.status === 'pending' && data.taskId) {
      taskId = data.taskId as string;
      break;
    }
    const message = (data.error as string) || `修正の投入に失敗しました (HTTP ${status})`;
    if (attempt < SUBMIT_MAX_RETRIES && isRetryableStatus(status)) {
      await sleep(2000 * 2 ** attempt + Math.floor(Math.random() * 500));
      continue;
    }
    throw new Error(message);
  }
  if (!taskId) throw new Error('修正タスクの投入に失敗しました');

  // 2) status ポーリング（個々のリクエストは短時間。running の間は待ち続ける）
  const deadline = Date.now() + CLIENT_TIMEOUT_MS;
  while (true) {
    if (signal?.aborted) throw new Error('aborted');
    await sleep(POLL_INTERVAL_MS);
    if (signal?.aborted) throw new Error('aborted');

    let result: { status: number; data: Record<string, unknown> };
    try {
      result = await postJson('/api/edit-banner/status', { taskId, formData }, signal);
    } catch {
      if (signal?.aborted) throw new Error('aborted');
      if (Date.now() > deadline) throw new Error(TIMEOUT_MESSAGE.replace('生成がタイムアウト','修正がタイムアウト'));
      continue;
    }

    const { data } = result;
    if (data.status === 'finished') {
      return { imageBase64: data.imageBase64 as string };
    }
    if (data.status === 'failed') {
      throw new Error((data.error as string) || '修正に失敗しました');
    }
    if (typeof data.progress === 'number') onProgress?.(data.progress as number);
    if (Date.now() > deadline) throw new Error(TIMEOUT_MESSAGE.replace('生成がタイムアウト','修正がタイムアウト'));
  }
}

/** data URL 形式（data:image/png;base64,...）で返すユーティリティ */
export async function generateBannerDataUrl(
  formData: BannerFormData,
  mode: GenerateMode | undefined,
  opts: GenerateOptions = {},
): Promise<GenerateResult & { dataUrl: string }> {
  const result = await generateBanner(formData, mode, opts);
  return { ...result, dataUrl: `data:image/png;base64,${result.imageBase64}` };
}
