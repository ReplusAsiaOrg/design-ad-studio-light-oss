/**
 * テキスト/vision LLM のプロバイダ自動切替。
 *
 * GEMINI_API_KEY があれば Gemini（既定 gemini-flash-latest・GEMINI_TEXT_MODEL で上書き可）を、無ければ OpenAI（gpt-4o）を使う。
 * ライト版は GEMINI キーがあれば Gemini、無ければ OpenAI 経路で動く。
 * 既存の Gemini 直叩きルートは温存し、勝ち分析フローの2ルートだけこれ経由にする。
 *
 * Gemini が一時的なエラー（503 high demand / UNAVAILABLE / 429 / overloaded 等）を返した場合は
 * 短い待ちを挟んで再試行し、それでもダメなら OPENAI_API_KEY があれば OpenAI に自動フォールバックする。
 * （AI分析ボタンで Gemini の生エラーJSONがそのまま画面に出て、何度押しても直らない、という報告への対応）
 */

import { generateText as generateTextGemini, generateTextWithBase64Image as geminiVision } from './gemini';
import { generateTextOpenAI, generateTextWithBase64ImageOpenAI } from './openai';

function hasGemini(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

function hasOpenAI(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

/** 再試行・フォールバックの対象にする一時的エラーか（モデル混雑・レート制限・接続断） */
function isTransientError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /\b(503|502|504|429)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand|try again later|API利用制限|fetch failed|ECONNRESET|ETIMEDOUT|socket hang up/i.test(msg);
}

const RETRY_DELAYS_MS = [1000, 2000, 4000];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Gemini を再試行付きで呼び、一時的エラーが続いたら OpenAI にフォールバックする。
 * 恒久的なエラー（キー不正・プロンプト拒否など）は再試行せずそのまま投げる。
 */
async function withFallback(
  label: string,
  gemini: () => Promise<string>,
  openai: () => Promise<string>,
): Promise<string> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await gemini();
    } catch (e) {
      lastError = e;
      if (!isTransientError(e)) throw e;
      if (attempt < RETRY_DELAYS_MS.length) {
        console.warn(`[text-llm] Gemini ${label} が一時的エラー（${attempt + 1}回目）。${RETRY_DELAYS_MS[attempt]}ms 後に再試行:`, e instanceof Error ? e.message : e);
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
  }
  if (hasOpenAI()) {
    console.warn(`[text-llm] Gemini ${label} の再試行が尽きたため OpenAI にフォールバック:`, lastError instanceof Error ? lastError.message : lastError);
    return openai();
  }
  throw new Error(
    'AIモデル（Gemini）が混雑しています。少し時間をおいてもう一度お試しください（OPENAI_API_KEY を設定すると混雑時に自動で切り替わります）。',
  );
}

export async function generateText(prompt: string): Promise<string> {
  if (!hasGemini()) return generateTextOpenAI(prompt);
  return withFallback('text', () => generateTextGemini(prompt), () => generateTextOpenAI(prompt));
}

export async function generateTextWithBase64Image(
  prompt: string,
  imageBase64: string,
): Promise<string> {
  if (!hasGemini()) return generateTextWithBase64ImageOpenAI(prompt, imageBase64);
  return withFallback(
    'vision',
    () => geminiVision(prompt, imageBase64),
    () => generateTextWithBase64ImageOpenAI(prompt, imageBase64),
  );
}
