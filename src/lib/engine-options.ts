import type { ImageEngine } from './types';

/**
 * ライト版の生成エンジン選択肢。
 *
 * フル版は4エンジン（gpt-image-2 / gemini / nano-pro / openai）を並べていたが、
 * 「日本語テキストが現状ベストの GPT Image 2 一本」に絞り、
 * 違いは "どのルートで叩くか" だけにする：
 *   - PoYo経由      … 既定。PoYoがGPT Image 2を中継。
 *   - 正規版(OpenAI直) … PoYoが重い/残高切れの時の逃げ道。OpenAIの公式APIで同じ GPT Image 2。
 *
 * UI側は value=engine をそのまま formData.engine にセットすれば動く
 * （'gpt-image-2'=PoYo経由 / 'openai'=OpenAI直、どちらも runEngineCombined/submitPoyoTask で処理済）。
 */
export const ENGINE_OPTIONS: { value: ImageEngine; label: string; sub: string }[] = [
  { value: 'gpt-image-2', label: 'PoYo経由', sub: 'GPT Image 2' },
  { value: 'openai', label: '正規版 (OpenAI直)', sub: 'GPT Image 2' },
];
