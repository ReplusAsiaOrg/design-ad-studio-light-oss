import { NextRequest, NextResponse } from 'next/server';
import { buildOpenAIPrompt, buildGptImage2Prompt } from '@/lib/openai-prompt-builder';
import { translateCustomPromptToEnglish } from '@/lib/gemini';
import { GenerateRequest } from '@/lib/types';

export async function POST(request: NextRequest) {
  const body: GenerateRequest = await request.json();
  const { formData } = body;
  const engine = formData.engine ?? 'gpt-image-2';

  const isStructured = /^(配色|レイアウト)\n/m.test(formData.customPrompt.trim());
  const translatedCustom = !isStructured && formData.customPrompt.trim()
    ? await translateCustomPromptToEnglish(formData.customPrompt)
    : undefined;

  const useMinimalPrompt = engine === 'gpt-image-2' || engine === 'gemini' || engine === 'nano-pro';
  const prompt = useMinimalPrompt
    ? buildGptImage2Prompt(formData, translatedCustom)
    : buildOpenAIPrompt(formData, translatedCustom);
  return NextResponse.json({ prompt });
}
