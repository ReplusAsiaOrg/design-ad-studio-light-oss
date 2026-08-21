'use client';

import { useRef, useState } from 'react';
import type { FontStyle } from '@/lib/types';
import { downscaleImageDataUrl } from '@/lib/image-resize';

interface FormSuggestion {
  mainText: string;
  subText: string;
  extraTexts: { text: string; decoration?: string }[];
  hasPersons: boolean;
  fontStyle: FontStyle;
}

interface Props {
  onUsePrompt?: (prompt: string, mainColor?: string, formSuggestion?: FormSuggestion) => void;
}

export default function PromptGenerator({ onUsePrompt }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<string | null>(null);
  const [guide, setGuide] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [mainColor, setMainColor] = useState<string | null>(null);
  const [formSuggestion, setFormSuggestion] = useState<FormSuggestion | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const loadFile = (file: File) => {
    if (!file.type.match(/^image\/(png|jpeg|webp)$/)) {
      alert('PNG、JPEG、WebP形式の画像を選択してください');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert('10MB以下の画像を選択してください');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImage(reader.result as string);
      setGuide(null);
      setPrompt(null);
      setFormSuggestion(null);
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    loadFile(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const analyze = async () => {
    if (!image) return;
    setIsAnalyzing(true);
    setError(null);
    try {
      // 送信前に長辺を抑えてJPEG圧縮（base64のままだと本番のリクエスト上限を超えて413になる）
      const imageBase64 = await downscaleImageDataUrl(image);
      const res = await fetch('/api/analyze-design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64 }),
      });
      // 413など本文がJSONでないエラーレスポンスでもクラッシュさせない
      if (!res.ok) {
        const text = await res.text();
        let message = text;
        try {
          message = JSON.parse(text).error ?? text;
        } catch {
          message =
            res.status === 413
              ? '画像のサイズが大きすぎます。小さい画像でお試しください。'
              : `分析に失敗しました（${res.status}）`;
        }
        setError(message);
        return;
      }
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setGuide(data.guide ?? null);
        setPrompt(data.prompt);
        setMainColor(data.mainColor ?? null);
        setFormSuggestion(data.formSuggestion ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '通信エラーが発生しました');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const copyToClipboard = async () => {
    if (!prompt) return;
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex gap-6 flex-col lg:flex-row">
      {/* Left: Upload */}
      <div className="lg:w-[400px] shrink-0">
        <div className="space-y-5 p-5 bg-white rounded-xl border border-gray-200">
          <div>
            <h2 className="text-lg font-bold text-gray-900">プロンプトジェネレーター</h2>
            <p className="text-xs text-gray-400 mt-1">参考画像をアップロードすると、デザイン要素をプロンプトに変換します。</p>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleImageSelect}
            className="hidden"
          />

          {image ? (
            <div className="space-y-3">
              <div className="relative">
                <img
                  src={image}
                  alt="参考画像"
                  className="w-full rounded-lg border border-gray-200 object-contain max-h-64"
                />
                <button
                  onClick={() => { setImage(null); setGuide(null); setPrompt(null); setFormSuggestion(null); setError(null); }}
                  className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/60 text-white rounded-full flex items-center justify-center text-sm hover:bg-black/80 transition-colors"
                >
                  &times;
                </button>
              </div>
              <button
                onClick={analyze}
                disabled={isAnalyzing}
                className="w-full py-3 rounded-xl font-bold text-white text-base transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-purple-600 hover:bg-purple-500 active:scale-[0.98]"
              >
                {isAnalyzing ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                    分析中...
                  </span>
                ) : (
                  'デザインを分析'
                )}
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={`w-full py-12 border-2 border-dashed rounded-lg transition-colors ${
                isDragOver
                  ? 'border-purple-400 bg-purple-50 text-purple-500'
                  : 'border-gray-200 text-gray-400 hover:border-purple-300 hover:text-purple-400'
              }`}
            >
              <div className="text-3xl mb-2">+</div>
              <div className="text-sm">{isDragOver ? 'ドロップして画像をアップロード' : '参考にしたい画像をアップロード'}</div>
              <div className="text-[10px] mt-1 text-gray-300">ドラッグ&ドロップ or クリック・PNG / JPEG / WebP・10MB以下</div>
            </button>
          )}
        </div>
      </div>

      {/* Right: Output */}
      <div className="flex-1 min-w-0 space-y-4">
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
            {error}
          </div>
        )}

        {(guide || prompt) ? (
          <>
            {/* フォーム入力ガイド */}
            {guide && (
              <div className="bg-blue-50 rounded-xl border border-blue-200 p-5">
                <h3 className="text-sm font-semibold text-blue-700 mb-3">フォーム入力ガイド</h3>
                <pre className="whitespace-pre-wrap text-sm text-blue-900 font-sans leading-relaxed">{guide}</pre>
              </div>
            )}

            {/* カスタム指示 */}
            {prompt && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-gray-600">カスタム指示</h3>
                  <button
                    onClick={copyToClipboard}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-900 text-white hover:bg-gray-700 transition-colors"
                  >
                    {copied ? (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        コピー済み
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                        コピー
                      </>
                    )}
                  </button>
                </div>
                <pre className="whitespace-pre-wrap text-sm text-gray-700 bg-gray-50 rounded-lg p-4 font-sans leading-relaxed">{prompt}</pre>

                {onUsePrompt && (
                  <button
                    onClick={() => onUsePrompt(prompt, mainColor ?? undefined, formSuggestion ?? undefined)}
                    className="w-full mt-4 py-3 rounded-xl font-bold text-white text-base transition-all bg-blue-600 hover:bg-blue-500 active:scale-[0.98]"
                  >
                    このプロンプトでバナーを作る
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 p-12 flex items-center justify-center min-h-[300px]">
            <div className="text-center text-gray-300">
              <p className="text-4xl mb-3">🎨</p>
              <p className="text-sm">画像をアップロードして「デザインを分析」を押すと</p>
              <p className="text-sm">デザイン要素がプロンプトとして出力されます</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
