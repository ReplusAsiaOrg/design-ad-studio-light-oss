import { generateBannerImage, generateBannerImageWithReference } from '@/lib/openai';
import { generateBannerImageWithGemini, generateBannerImageWithReferenceGemini, translateCustomPromptToEnglish } from '@/lib/gemini';
import {
  generateBannerImageNanoPro, generateBannerImageWithReferenceNanoPro,
  generateBannerImageGptImage2, generateBannerImageWithReferenceGptImage2,
  poyoSubmitGptImage2, poyoSubmitGptImage2WithReference,
  poyoSubmitNanoPro, poyoSubmitNanoProWithReference,
  poyoTaskStatus,
} from '@/lib/poyo';
import { buildOpenAIPrompt, buildGptImage2Prompt, buildWinningClonePrompt, mapFormToEngineSize } from '@/lib/openai-prompt-builder';
import { classifyDesignMood } from '@/lib/mood-classifier';
import { overlayLogo, resizeCoverExact } from '@/lib/image-utils';
import { createFallbackPlan } from '@/lib/layout-planner';
import { fetchReferenceImageFromUrl } from '@/lib/url-reference';
import { GenerateRequest, DesignPlan, hasValidCustomSize, nearestStandardAspect } from '@/lib/types';

type FormData = GenerateRequest['formData'];

/** PoYo（非同期）を使うエンジンかどうか。gemini / openai は単発同期呼び出し */
export function isAsyncEngine(engine: string): boolean {
  return engine === 'gpt-image-2' || engine === 'nano-pro';
}

/**
 * 生成の前処理: 参照URLの解決・カスタム指示の翻訳・ムード判定・プロンプト構築までを行う。
 * submit / 旧 /api/generate の両方から呼ぶ。
 */
export async function prepareGeneration(
  body: GenerateRequest,
): Promise<{ engine: string; prompt: string; formData: FormData }> {
  // リクエストボディを直接ミューテートしないようにシャローコピー
  const formData: FormData = { ...body.formData };
  const engine = formData.engine ?? 'gpt-image-2';
  const mode = body.mode;
  const isWinningStrict = mode === 'winning-strict';

  // 参照URL指定時: 画像未アップなら og:image を取得し、style 参照として扱う
  const hasReferenceUrl = !!formData.referenceUrl?.trim();
  if (hasReferenceUrl) {
    if (!formData.referenceImageBase64) {
      const fetched = await fetchReferenceImageFromUrl(formData.referenceUrl!.trim());
      console.log(`[generate] referenceUrl fetch: ${fetched ? 'OK' : 'FAILED (fallback to no-reference)'} url=${formData.referenceUrl}`);
      if (fetched) formData.referenceImageBase64 = fetched;
    }
    // モード明示済み（clone/asset等）の場合は上書きしない（cloneの専用プロンプトが飛ばされるため）
    if (formData.referenceImageBase64 && !formData.referenceImageMode) formData.referenceImageMode = 'style';
  }

  // 参照画像があるがモード未指定なら asset をデフォルト
  if (formData.referenceImageBase64 && !formData.referenceImageMode) {
    formData.referenceImageMode = 'asset';
  }

  // 勝ちフォーマット直系「編集（clone）」: 元画像をそのまま土台にコピーだけ差し替える。
  // 両ビルダー（単発/一括で経路が分岐する）を経由せず専用プロンプトに固定し、挙動を一致させる。
  if (formData.referenceImageBase64 && formData.referenceImageMode === 'clone') {
    const clonePrompt = buildWinningClonePrompt(formData);
    console.log('=== GENERATED PROMPT [clone/winning-edit] ===');
    console.log(clonePrompt);
    console.log('========================');
    return { engine, prompt: clonePrompt, formData };
  }

  const customPrompt = formData.customPrompt?.trim() ?? '';
  const isStructured = /^(配色|レイアウト)\n/m.test(customPrompt);
  const useMinimalPrompt = !isWinningStrict && (engine === 'gpt-image-2' || engine === 'gemini' || engine === 'nano-pro');
  const skipMood = isStructured || useMinimalPrompt;
  const [translatedCustom, moodClassification] = await Promise.all([
    !isStructured && customPrompt
      ? translateCustomPromptToEnglish(formData.customPrompt)
      : Promise.resolve(undefined),
    skipMood
      ? Promise.resolve(null)
      : classifyDesignMood(formData.mainText, formData.subText, formData.extraTexts.map(t => t.text)),
  ]);

  let prompt = useMinimalPrompt
    ? buildGptImage2Prompt(formData, translatedCustom)
    : buildOpenAIPrompt(formData, translatedCustom, moodClassification);

  // 「物をコピーするな」系のForbiddenは style参照（Tier B）専用。
  // asset/clone（書籍写真を活かしたいTier A）には付けない。
  if (isWinningStrict && formData.referenceImageMode === 'style') {
    prompt += `\n\n${buildWinningStrictForbiddenBlock(formData)}`;
  }

  console.log(`=== GENERATED PROMPT [${engine}${isWinningStrict ? '/winning-strict' : ''}] ===`);
  console.log(prompt);
  console.log('========================');

  return { engine, prompt, formData };
}

/** 同期エンジン or 旧 /api/generate 用: エンジンを呼んで base64 画像を返す（PoYoは内部でpoll） */
export async function runEngineCombined(engine: string, prompt: string, formData: FormData): Promise<string> {
  if (engine === 'gemini') {
    const geminiAspect = nearestStandardAspect(formData); // Geminiは標準比率のみ。customは後段クロップで合わせる
    return formData.referenceImageBase64
      ? generateBannerImageWithReferenceGemini(prompt, geminiAspect, formData.referenceImageBase64)
      : generateBannerImageWithGemini(prompt, geminiAspect);
  }
  if (engine === 'nano-pro') {
    const size = mapFormToEngineSize(formData);
    return formData.referenceImageBase64
      ? generateBannerImageWithReferenceNanoPro(prompt, size, formData.referenceImageBase64)
      : generateBannerImageNanoPro(prompt, size);
  }
  if (engine === 'gpt-image-2') {
    const size = mapFormToEngineSize(formData);
    return formData.referenceImageBase64
      ? generateBannerImageWithReferenceGptImage2(prompt, size, formData.referenceImageBase64)
      : generateBannerImageGptImage2(prompt, size);
  }
  const size = mapFormToEngineSize(formData);
  return formData.referenceImageBase64
    ? generateBannerImageWithReference(prompt, size, formData.referenceImageBase64)
    : generateBannerImage(prompt, size);
}

/** PoYoエンジンにタスクを submit して taskId を返す（数秒で返る） */
export async function submitPoyoTask(engine: string, prompt: string, formData: FormData): Promise<string> {
  const size = mapFormToEngineSize(formData);
  const ref = formData.referenceImageBase64;
  if (engine === 'gpt-image-2') {
    return ref ? poyoSubmitGptImage2WithReference(prompt, size, ref) : poyoSubmitGptImage2(prompt, size);
  }
  // nano-pro
  return ref ? poyoSubmitNanoProWithReference(prompt, size, ref) : poyoSubmitNanoPro(prompt, size);
}

/** PoYoタスクの状況を1回ポーリング。finished なら imageBase64 を含む */
export async function pollPoyoTask(taskId: string) {
  return poyoTaskStatus(taskId);
}

/** 生成後処理: ロゴ合成 + （テキスト描画禁止指示時の）designPlan 生成 */
export async function postProcess(
  imageBase64: string,
  formData: FormData,
): Promise<{ imageBase64: string; designPlan: DesignPlan }> {
  let finalImage = imageBase64;
  // カスタムサイズは先に正確な寸法へ中央クロップ（Issue #29）。ロゴ合成より前＝ロゴが切れないように
  if (hasValidCustomSize(formData)) {
    finalImage = await resizeCoverExact(finalImage, formData.customWidth, formData.customHeight);
  }
  if (formData.logoImageBase64) {
    finalImage = await overlayLogo(finalImage, formData.logoImageBase64, formData.logoPosition ?? 'bottom-right');
  }
  const hasNoTextDirective = formData.customPrompt && /テキスト.*一切含めない|テキスト.*描画してはいけない|no text/i.test(formData.customPrompt);
  const designPlan: DesignPlan = hasNoTextDirective && (formData.mainText || formData.subText)
    ? createFallbackPlan(formData, { align: 'left' })
    : { elements: [] };
  return { imageBase64: finalImage, designPlan };
}

/** レート制限系エラーかどうか（クライアントに 429 を返してバックオフさせる用） */
export function isRateLimitError(message: string): boolean {
  return /429\b|rate.?limit|too many requests|quota|concurrent/i.test(message);
}

/**
 * winning-strict モード用の Forbidden ブロック。
 * 元の勝ちCRが split-comparison レイアウトの場合に、テキストの左右両焼き込みを打ち消す。
 */
function buildWinningStrictForbiddenBlock(formData: FormData): string {
  const allTexts: string[] = [];
  if (formData.mainText) allTexts.push(formData.mainText);
  if (formData.subText) allTexts.push(formData.subText);
  formData.extraTexts.forEach(t => { if (t.text.trim()) allTexts.push(t.text); });

  const lines: string[] = [];
  lines.push('# Winning-pattern reproduction — STRICT zone & duplication rules');
  lines.push('This banner reproduces the winning pattern of an existing high-performing creative. The customPrompt above describes the zone structure (e.g. split-comparison, centered hero). The following rules are NON-NEGOTIABLE:');
  lines.push('');
  lines.push('## Each text appears exactly once, in exactly one zone');
  allTexts.forEach((t, i) => {
    lines.push(`- Text ${i + 1} 「${t}」 — render this string EXACTLY ONCE in the entire image. Do NOT repeat it in another zone, another half, or as a watermark / accent.`);
  });
  lines.push('');
  lines.push('## Forbidden (explicit exclusions — these are most important)');
  lines.push('- Do NOT duplicate any Japanese phrase across left/right halves, top/bottom bands, or any zone boundary.');
  lines.push('- Do NOT render the headline simultaneously in both the left half and the right half. The headline lives in ONE zone only (typically a TOP BAND that spans full width, or one half — follow the customPrompt).');
  lines.push('- Do NOT render the CTA button in multiple places. Exactly one CTA button total.');
  lines.push('- Do NOT let any text glyph cross or visually touch a zone divider line. If a zone boundary exists (vertical center divider, horizontal divider), every text element must live entirely on one side of it.');
  lines.push('- Do NOT add English category labels, section titles, or any text not explicitly listed above.');
  lines.push('- Do NOT copy specific objects, faces, products, logos, or text from the attached style-reference image. Only borrow its color palette, typography mood, and composition rhythm.');
  lines.push('');
  lines.push('## Positive form (for engines that ignore exclusions)');
  lines.push(`- Total Japanese text glyph groups in the image: exactly ${allTexts.length}. Not more, not fewer.`);
  lines.push('- Each text element is anchored to a single semantic zone declared in the customPrompt. If the customPrompt says "LEFT HALF: 〜" then that text appears in the left half only, not in the right half.');
  lines.push('- If two zones are described (e.g. left = problem, right = solution), the contrast must be SEMANTIC (problem vs solution, before vs after, others vs ours) — not just a generic emotional contrast (sad vs happy).');
  return lines.join('\n');
}
