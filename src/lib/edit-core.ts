import { fixBannerText } from '@/lib/openai';
import { editBannerImageWithGemini } from '@/lib/gemini';
import { poyoSubmitGptImage2WithReference, poyoSubmitNanoProWithReference } from '@/lib/poyo';
import { mapFormToEngineSize } from '@/lib/openai-prompt-builder';
import { isAsyncEngine } from '@/lib/generate-core';
import { BannerFormData , nearestStandardAspect } from '@/lib/types';

// 生成系（generate-core）と同じく submit/poll に分割するための共有ロジック。
// 編集（テキスト修正）も画像生成と同程度に時間がかかり、本番60秒制限を超えて
// 504 になっていたため、submit でタスク投入 → ブラウザが status をポーリングする。
export { isAsyncEngine };

export function buildEditPrompt(instruction: string): string {
  return `Edit this banner image. Apply ONLY the following change — keep everything else exactly as-is.

## Edit instruction
${instruction.trim()}

## Rules
- Apply ONLY the specified change. Do NOT alter anything else.
- Keep all other text, fonts, colors, layout, decorations, characters, and background exactly the same.
- The output must look like the same banner with only the requested modification applied.
- Maintain the same overall quality and style.`;
}

/** PoYo（非同期）エンジンの編集タスクを submit して taskId を返す（数秒で返る） */
export async function submitEditTask(
  engine: string,
  prompt: string,
  formData: BannerFormData,
  imageBase64: string,
): Promise<string> {
  const size = mapFormToEngineSize(formData);
  if (engine === 'gpt-image-2') {
    return poyoSubmitGptImage2WithReference(prompt, size, imageBase64);
  }
  // nano-pro
  return poyoSubmitNanoProWithReference(prompt, size, imageBase64);
}

/** 同期エンジン（gemini / openai）の編集を実行して base64 画像を返す */
export async function runEditCombined(
  engine: string,
  prompt: string,
  formData: BannerFormData,
  imageBase64: string,
): Promise<string> {
  if (engine === 'gemini') {
    return editBannerImageWithGemini(prompt, nearestStandardAspect(formData), imageBase64);
  }
  const size = mapFormToEngineSize(formData);
  return fixBannerText(prompt, size, imageBase64);
}
