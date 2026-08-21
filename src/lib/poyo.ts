/**
 * PoYo.ai API Client — Nano Banana Pro (Gemini 3 Pro Image) / GPT Image 2
 * 非同期API: submit → poll → download
 */

const POYO_BASE = 'https://api.poyo.ai';
const POLL_INTERVAL_MS = 2500;
// 2.5s × 240 = 600s (10min)。PoYo混雑時はタスクが not_started のまま数分待たされ、
// 生成自体は5〜6分で終わるのに5分上限ちょうどで打ち切られ500になる事故が多発したため延長。
const MAX_POLL_ATTEMPTS = 240;

const MODEL_T2I = process.env.POYO_NANO_PRO_MODEL || 'nano-banana-pro';
const MODEL_EDIT = process.env.POYO_NANO_PRO_EDIT_MODEL || 'nano-banana-pro-edit';
const MODEL_GPT_T2I = process.env.POYO_GPT_IMAGE2_MODEL || 'gpt-image-2';
const MODEL_GPT_EDIT = process.env.POYO_GPT_IMAGE2_EDIT_MODEL || 'gpt-image-2-edit';
const GPT_QUALITY = (process.env.POYO_GPT_IMAGE2_QUALITY as 'low' | 'medium' | 'high') || 'high';
const GPT_RESOLUTION = (process.env.POYO_GPT_IMAGE2_RESOLUTION as '1K' | '2K' | '4K') || '1K';

function getApiKey(): string {
  const key = process.env.POYO_API_KEY;
  if (!key) throw new Error('POYO_API_KEY is not set');
  return key;
}

interface PoyoSubmitResponse {
  code: number;
  data: { task_id: string; status: string };
}

interface PoyoStatusResponse {
  code: number;
  data: {
    task_id: string;
    status: 'not_started' | 'running' | 'finished' | 'failed';
    progress: number;
    files?: Array<{ file_url: string; file_type: string }>;
    error_message?: string;
  };
}

interface PoyoUploadResponse {
  code: number;
  data: { file_url: string };
}

const SIZE_MAP: Record<string, string> = {
  '1024x1024': '1:1',
  '1536x1024': '3:2',
  '1024x1536': '2:3',
};

function mapSize(openaiSize: string): string {
  return SIZE_MAP[openaiSize] || '1:1';
}

/** 生base64の先頭数バイトから画像 MIME を推定する。判別不能なら image/png にフォールバック */
function detectImageMime(base64: string): string {
  // 先頭6文字（4-5バイト相当）で判定できる
  const head = base64.slice(0, 16);
  if (head.startsWith('iVBORw0K')) return 'image/png';     // PNG: 89 50 4E 47
  if (head.startsWith('/9j/')) return 'image/jpeg';         // JPEG: FF D8 FF
  if (head.startsWith('R0lGOD')) return 'image/gif';        // GIF
  if (head.startsWith('UklGR')) return 'image/webp';        // WebP: RIFF....WEBP
  return 'image/png';
}

async function uploadBase64Image(base64Data: string): Promise<string> {
  // 入力は data URL（data:image/...;base64,xxx）か生base64のどちらか。
  // どちらの場合でも、いったん「prefix を完全に剥がす → 中身バイトから MIME 推定 → data URL 再構築」
  // という流れに統一する。理由:
  //  - 既存実装は「data: で始まればそのまま流す」だったが、ブラウザ FileReader が稀に
  //    余分なメタデータ（charset 等）を data URL の中に挟むケースがあり、PoYo 側のパーサが
  //    「Invalid data URL format」で弾く事故を防ぐ。
  //  - JPEG/WebP の生 base64 を image/png ラベルで送る不整合（旧バグ）も同時に塞ぐ。
  const stripped = base64Data
    .replace(/^data:[^;]+;base64,/, '')   // 標準: data:image/jpeg;base64,
    .replace(/^data:[^,]+,/, '')           // 念のため: data:image/jpeg,（base64 なし形式）
    .replace(/\s+/g, '');                  // 改行や空白が混入していた場合は除去
  const mime = detectImageMime(stripped);
  const dataUrl = `data:${mime};base64,${stripped}`;

  console.log(`[PoYo] upload: mime=${mime} base64_len=${stripped.length} head="${stripped.slice(0, 12)}"`);

  const res = await fetch(`${POYO_BASE}/api/common/upload/base64`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({ base64_data: dataUrl }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error(`[PoYo] upload error status=${res.status} body=${errBody} dataUrlPrefix=${dataUrl.slice(0, 40)}`);
    throw new Error(`PoYo upload failed (${res.status}): ${errBody}`);
  }

  const json: PoyoUploadResponse = await res.json();
  if (!json.data?.file_url) {
    throw new Error(`PoYo upload error: ${JSON.stringify(json)}`);
  }
  return json.data.file_url;
}

async function submitTask(model: string, input: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${POYO_BASE}/api/generate/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({ model, input }),
  });

  if (!res.ok) {
    throw new Error(`PoYo submit failed (${res.status}): ${await res.text()}`);
  }

  const json: PoyoSubmitResponse = await res.json();
  if (json.code !== 200 || !json.data?.task_id) {
    throw new Error(`PoYo submit error: ${JSON.stringify(json)}`);
  }
  return json.data.task_id;
}

// ステータス取得の一時的失敗（5xx/ネットワーク断）はタスクを捨てずに何回まで連続許容するか
const MAX_CONSECUTIVE_STATUS_FAILURES = 5;

async function pollTaskResult(taskId: string): Promise<string> {
  let lastProgress = -1;
  let consecutiveStatusFailures = 0;
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    // status取得の一時的失敗でタスクを放棄しない（放棄→再submitは二重課金になる）
    let json: PoyoStatusResponse;
    try {
      const res = await fetch(`${POYO_BASE}/api/generate/status/${taskId}`, {
        headers: { Authorization: `Bearer ${getApiKey()}` },
      });
      if (!res.ok) {
        throw new Error(`PoYo status failed (${res.status}): ${await res.text()}`);
      }
      json = (await res.json()) as PoyoStatusResponse;
      if (json.code !== 200 || !json.data) {
        throw new Error(`PoYo status error: ${JSON.stringify(json)}`);
      }
    } catch (e) {
      consecutiveStatusFailures++;
      const msg = e instanceof Error ? e.message : String(e);
      if (consecutiveStatusFailures > MAX_CONSECUTIVE_STATUS_FAILURES) {
        throw new Error(`PoYoステータス取得に連続${MAX_CONSECUTIVE_STATUS_FAILURES}回失敗しました（タスク ${taskId} は継続中の可能性）: ${msg}`);
      }
      console.warn(`[PoYo] status fetch failure ${consecutiveStatusFailures}/${MAX_CONSECUTIVE_STATUS_FAILURES}: ${msg}`);
      continue;
    }
    consecutiveStatusFailures = 0;
    const { status, progress, files, error_message } = json.data;

    if (typeof progress === 'number' && progress !== lastProgress) {
      console.log(`[PoYo] task ${taskId} ${status} progress=${progress}%`);
      lastProgress = progress;
    }

    if (status === 'failed') {
      throw new Error(`PoYo task failed: ${error_message || 'unknown error'}`);
    }

    if (status === 'finished') {
      const imageFile = files?.find((f) => f.file_type === 'image');
      if (!imageFile?.file_url) {
        throw new Error('PoYo task finished but no image file returned');
      }
      return imageFile.file_url;
    }
  }
  throw new Error(`PoYo task timed out after ${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s`);
}

async function downloadAsBase64(imageUrl: string): Promise<string> {
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) {
    throw new Error(`Failed to download PoYo image: ${imgRes.status}`);
  }
  const buffer = await imgRes.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}

const MAX_TRANSIENT_RETRIES = 2;

/** PoYo の一時的失敗（混雑・レート制限・ネットワーク断）と思われるエラーメッセージか。 */
export function isTransientPoyoError(message: string): boolean {
  return /Server exception|please try again|429\b|rate.?limit|too many requests|quota|concurrent|503\b|502\b|504\b|ECONNRESET|ETIMEDOUT|fetch failed/i.test(message);
}

/** タスク自体が終了した（failed / 成果物なし）ことを示すエラーか。再submitしてよいのはこの場合のみ。 */
function isTaskTerminalError(message: string): boolean {
  return /PoYo task failed|finished but no image/i.test(message);
}

/** PoYo の `Server exception` 等の一時的失敗を最大2回まで自動リトライ */
async function submitAndPollWithRetry(
  model: string,
  input: Record<string, unknown>,
): Promise<string> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
    // submit失敗のリトライは submitWithRetry 側で行う
    const taskId = await submitWithRetry(model, input);
    try {
      return await pollTaskResult(taskId);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      // 再submitはタスク終了が確定したエラーのみ。ステータス取得不能（タスク継続中の可能性）で
      // 再submitすると二重課金になるため、そのまま投げる。
      const retryable = isTaskTerminalError(err.message) && isTransientPoyoError(err.message);
      if (!retryable || attempt === MAX_TRANSIENT_RETRIES) throw err;
      const backoffMs = 2000 * (attempt + 1);
      console.warn(`[PoYo] transient task failure (attempt ${attempt + 1}/${MAX_TRANSIENT_RETRIES + 1}): ${err.message} — retrying in ${backoffMs}ms`);
      lastErr = err;
      await new Promise(r => setTimeout(r, backoffMs));
    }
  }
  throw lastErr ?? new Error('PoYo task failed after retries');
}

// ─── Public API ───────────────────────────────────────

export async function generateBannerImageNanoPro(
  prompt: string,
  size: '1024x1024' | '1536x1024' | '1024x1536' = '1024x1024',
): Promise<string> {
  console.log(`[PoYo] Generating image (${MODEL_T2I})...`);
  const imageUrl = await submitAndPollWithRetry(MODEL_T2I, {
    prompt: prompt.slice(0, 2000),
    size: mapSize(size),
    n: 1,
  });
  return downloadAsBase64(imageUrl);
}

export async function generateBannerImageWithReferenceNanoPro(
  prompt: string,
  size: '1024x1024' | '1536x1024' | '1024x1536',
  imageBase64: string,
): Promise<string> {
  console.log('[PoYo] Uploading reference image...');
  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
  const imageUrl = await uploadBase64Image(base64Data);

  console.log(`[PoYo] Editing image (${MODEL_EDIT})...`);
  const resultUrl = await submitAndPollWithRetry(MODEL_EDIT, {
    prompt: prompt.slice(0, 2000),
    image_urls: [imageUrl],
    size: mapSize(size),
    n: 1,
  });
  return downloadAsBase64(resultUrl);
}

export async function editBannerImageNanoPro(
  prompt: string,
  size: '1024x1024' | '1536x1024' | '1024x1536',
  imageBase64: string,
): Promise<string> {
  return generateBannerImageWithReferenceNanoPro(prompt, size, imageBase64);
}

// ─── GPT Image 2 ──────────────────────────────────────

export async function generateBannerImageGptImage2(
  prompt: string,
  size: '1024x1024' | '1536x1024' | '1024x1536' = '1024x1024',
): Promise<string> {
  console.log(`[PoYo] Generating image (${MODEL_GPT_T2I}, q=${GPT_QUALITY}, res=${GPT_RESOLUTION})...`);
  const imageUrl = await submitAndPollWithRetry(MODEL_GPT_T2I, {
    prompt: prompt.slice(0, 4000),
    size: mapSize(size),
    quality: GPT_QUALITY,
    resolution: GPT_RESOLUTION,
  });
  return downloadAsBase64(imageUrl);
}

export async function generateBannerImageWithReferenceGptImage2(
  prompt: string,
  size: '1024x1024' | '1536x1024' | '1024x1536',
  imageBase64: string,
): Promise<string> {
  console.log('[PoYo] Uploading reference image...');
  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
  const imageUrl = await uploadBase64Image(base64Data);

  console.log(`[PoYo] Editing image (${MODEL_GPT_EDIT}, q=${GPT_QUALITY})...`);
  const resultUrl = await submitAndPollWithRetry(MODEL_GPT_EDIT, {
    prompt: prompt.slice(0, 4000),
    image_urls: [imageUrl],
    size: mapSize(size),
    quality: GPT_QUALITY,
  });
  return downloadAsBase64(resultUrl);
}

export async function editBannerImageGptImage2(
  prompt: string,
  size: '1024x1024' | '1536x1024' | '1024x1536',
  imageBase64: string,
): Promise<string> {
  return generateBannerImageWithReferenceGptImage2(prompt, size, imageBase64);
}

// ─── 非同期分割API（submit / status）──────────────────
// サーバーレス関数の実行時間上限（本番60秒）を回避するため、
// 「submit でタスク投入（数秒で返る）→ ブラウザが status をポーリング」する用。

/** submit のみ（transient のみ自動リトライ）。taskId を返す */
async function submitWithRetry(model: string, input: Record<string, unknown>): Promise<string> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
    try {
      return await submitTask(model, input);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      if (!isTransientPoyoError(err.message) || attempt === MAX_TRANSIENT_RETRIES) throw err;
      const backoffMs = 2000 * (attempt + 1);
      console.warn(`[PoYo] submit transient failure (attempt ${attempt + 1}): ${err.message} — retrying in ${backoffMs}ms`);
      lastErr = err;
      await new Promise(r => setTimeout(r, backoffMs));
    }
  }
  throw lastErr ?? new Error('PoYo submit failed after retries');
}

export async function poyoSubmitGptImage2(prompt: string, size: '1024x1024' | '1536x1024' | '1024x1536'): Promise<string> {
  return submitWithRetry(MODEL_GPT_T2I, {
    prompt: prompt.slice(0, 4000), size: mapSize(size), quality: GPT_QUALITY, resolution: GPT_RESOLUTION,
  });
}

export async function poyoSubmitGptImage2WithReference(prompt: string, size: '1024x1024' | '1536x1024' | '1024x1536', imageBase64: string): Promise<string> {
  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
  const imageUrl = await uploadBase64Image(base64Data);
  return submitWithRetry(MODEL_GPT_EDIT, {
    prompt: prompt.slice(0, 4000), image_urls: [imageUrl], size: mapSize(size), quality: GPT_QUALITY,
  });
}

export async function poyoSubmitNanoPro(prompt: string, size: '1024x1024' | '1536x1024' | '1024x1536'): Promise<string> {
  return submitWithRetry(MODEL_T2I, { prompt: prompt.slice(0, 2000), size: mapSize(size), n: 1 });
}

export async function poyoSubmitNanoProWithReference(prompt: string, size: '1024x1024' | '1536x1024' | '1024x1536', imageBase64: string): Promise<string> {
  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
  const imageUrl = await uploadBase64Image(base64Data);
  return submitWithRetry(MODEL_EDIT, { prompt: prompt.slice(0, 2000), image_urls: [imageUrl], size: mapSize(size), n: 1 });
}

export interface PoyoTaskStatus {
  status: 'not_started' | 'running' | 'finished' | 'failed';
  progress: number;
  imageBase64?: string;
  error?: string;
}

/** タスク状況を1回だけ取得。finished なら画像をダウンロードして imageBase64 を返す */
export async function poyoTaskStatus(taskId: string): Promise<PoyoTaskStatus> {
  const res = await fetch(`${POYO_BASE}/api/generate/status/${taskId}`, {
    headers: { Authorization: `Bearer ${getApiKey()}` },
  });
  if (!res.ok) {
    throw new Error(`PoYo status failed (${res.status}): ${await res.text()}`);
  }
  const json: PoyoStatusResponse = await res.json();
  if (json.code !== 200 || !json.data) {
    // HTTP 200 でも {code:400} 等が返ることがある。分割代入前に検証する
    throw new Error(`PoYo status error: ${JSON.stringify(json)}`);
  }
  const { status, progress, files, error_message } = json.data;

  if (status === 'finished') {
    const imageFile = files?.find(f => f.file_type === 'image');
    if (!imageFile?.file_url) throw new Error('PoYo task finished but no image file returned');
    const imageBase64 = await downloadAsBase64(imageFile.file_url);
    return { status, progress: progress ?? 100, imageBase64 };
  }
  if (status === 'failed') {
    return { status, progress: progress ?? 0, error: error_message || 'unknown error' };
  }
  return { status, progress: progress ?? 0 };
}
