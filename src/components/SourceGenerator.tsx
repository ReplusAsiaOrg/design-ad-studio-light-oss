'use client';

import { useRef, useState } from 'react';
import { ENGINE_OPTIONS } from '@/lib/engine-options';
import { useSourceGenerator, type SourceFile, type SourceFileKind } from '@/hooks/useSourceGenerator';
import { PolicyWarningBadge } from '@/components/AdPolicyWarnings';
import type { AspectRatio, BannerConcept, BannerFormData, TextDecoration } from '@/lib/types';

const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024; // Markdown/txt の上限 (2MB)
const MAX_IMAGE_FILE_BYTES = 15 * 1024 * 1024; // 画像の上限 (15MB)

const KIND_LABEL: Record<SourceFileKind, string> = {
  markdown: 'Markdown',
  text: 'テキスト',
  image: '画像',
  pdf: 'PDF',
  video: '動画',
};

function detectSourceFileKind(file: File): SourceFileKind | null {
  const name = file.name.toLowerCase();
  if (/\.(md|markdown)$/.test(name)) return 'markdown';
  if (/\.txt$/.test(name)) return 'text';
  if (file.type.startsWith('image/')) return 'image';
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (file.type.startsWith('video/')) return 'video';
  return null;
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('読み込みに失敗しました'));
    reader.readAsText(file);
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('読み込みに失敗しました'));
    reader.readAsDataURL(file);
  });
}

const DECORATION_OPTIONS: { value: TextDecoration; label: string }[] = [
  { value: 'none', label: 'なし' },
  { value: 'button', label: 'ボタン' },
  { value: 'badge', label: 'バッジ' },
  { value: 'ribbon', label: 'リボン' },
  { value: 'circle', label: '丸囲み' },
  { value: 'annotation', label: '注釈' },
];

const ASPECT_RATIOS: { value: AspectRatio; label: string }[] = [
  { value: '1:1', label: '1:1' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
];

interface Props {
  onEditInCreator?: (formData: Partial<BannerFormData>, imageBase64: string) => void;
}

export default function SourceGenerator({ onEditInCreator }: Props) {
  const screenshotInputRef = useRef<HTMLInputElement>(null);
  const sourceFileInputRef = useRef<HTMLInputElement>(null);
  const [screenshotDragOver, setScreenshotDragOver] = useState(false);
  const [sourceDragOver, setSourceDragOver] = useState(false);
  const [sourceFileError, setSourceFileError] = useState<string | null>(null);
  const {
    url, setUrl,
    sourceFile, setSourceFile,
    screenshotBase64, setScreenshotBase64,
    aspectRatio, setAspectRatio,
    engine, setEngine,
    phase,
    scrapedData,
    concepts,
    isScraping,
    isGeneratingConcepts,
    error,
    analyze,
    toggleConcept,
    updateConcept,
    generateBanners,
    retryConcept,
    reset,
    conceptToFormData,
  } = useSourceGenerator();

  const selectedCount = concepts.filter(c => c.selected).length;
  const isAnalyzing = isScraping || isGeneratingConcepts;
  const isAnyGenerating = concepts.some(c => c.isGenerating);

  const loadSourceFile = async (file: File) => {
    setSourceFileError(null);
    const kind = detectSourceFileKind(file);
    if (!kind) {
      setSourceFileError('対応していないファイル形式です（.md / .txt / 画像 / PDF / 動画）');
      return;
    }
    if ((kind === 'markdown' || kind === 'text') && file.size > MAX_TEXT_FILE_BYTES) {
      setSourceFileError('2MB 以下のファイルを選択してください');
      return;
    }
    if (kind === 'image' && file.size > MAX_IMAGE_FILE_BYTES) {
      setSourceFileError('15MB 以下の画像を選択してください');
      return;
    }
    try {
      if (kind === 'markdown' || kind === 'text') {
        const text = await readFileAsText(file);
        const next: SourceFile = { kind, filename: file.name, payload: text, sizeBytes: file.size };
        setSourceFile(next);
      } else if (kind === 'image') {
        const dataUrl = await readFileAsDataUrl(file);
        const next: SourceFile = { kind, filename: file.name, payload: dataUrl, sizeBytes: file.size };
        setSourceFile(next);
      } else {
        setSourceFileError(`${KIND_LABEL[kind]} のアップロードは Phase 2 で対応予定です`);
      }
    } catch (e) {
      setSourceFileError(e instanceof Error ? e.message : 'ファイル読み込みに失敗しました');
    }
  };

  const handleSourceFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void loadSourceFile(file);
    e.target.value = '';
  };

  const handleSourceFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setSourceDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void loadSourceFile(file);
  };

  const loadScreenshotFile = (file: File) => {
    if (!file.type.match(/^image\/(png|jpeg|webp)$/)) {
      alert('PNG、JPEG、WebP形式の画像を選択してください');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert('10MB以下の画像を選択してください');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setScreenshotBase64(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleScreenshotSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    loadScreenshotFile(file);
    e.target.value = '';
  };

  const handleScreenshotDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setScreenshotDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) loadScreenshotFile(file);
  };

  return (
    <div className="flex gap-6 flex-col lg:flex-row">
      {/* Left Panel */}
      <div className="lg:w-[400px] shrink-0">
        <div className="space-y-5 p-5 bg-white rounded-xl border border-gray-200">
          <div>
            <h2 className="text-lg font-bold text-gray-900">素材から生成</h2>
            <p className="text-xs text-gray-400 mt-1">
              LPのURL、または素材ファイル（Markdown／画像）から AI が訴求軸を分析しバナーを自動生成します。画像LP（UTAGE等）はAIが画像内テキストを読み取って訴求として使います。
            </p>
          </div>

          {/* URL Input */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">URL</label>
            <input
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://example.com/lp"
              disabled={phase !== 'input' || !!sourceFile}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 disabled:bg-gray-50 disabled:text-gray-400 placeholder:text-gray-300"
            />
            {sourceFile && (
              <p className="text-[10px] text-gray-400 mt-1">ファイルが選択されているため URL は使われません</p>
            )}
          </div>

          {/* Source File (D&D) */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              または素材ファイル <span className="text-gray-300 font-normal">(Markdown / 画像LPスクショ)</span>
            </label>
            <input
              ref={sourceFileInputRef}
              type="file"
              accept=".md,.markdown,.txt,text/markdown,text/plain,image/*,application/pdf,video/*"
              onChange={handleSourceFileSelect}
              className="hidden"
            />
            {sourceFile ? (
              <div className="border border-gray-200 rounded-lg p-3 flex items-center gap-2 bg-gray-50">
                {sourceFile.kind === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={sourceFile.payload}
                    alt={sourceFile.filename}
                    className="w-10 h-10 object-cover rounded border border-gray-200"
                  />
                ) : (
                  <div className="text-sm">📄</div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-800 truncate">{sourceFile.filename}</p>
                  <p className="text-[10px] text-gray-400">
                    {KIND_LABEL[sourceFile.kind]} ・ {(sourceFile.sizeBytes / 1024).toFixed(1)} KB
                  </p>
                </div>
                <button
                  onClick={() => { setSourceFile(null); setSourceFileError(null); }}
                  disabled={phase !== 'input'}
                  className="w-5 h-5 bg-black/60 text-white rounded-full flex items-center justify-center text-xs hover:bg-black/80 transition-colors"
                  title="ファイルを外す"
                >
                  &times;
                </button>
              </div>
            ) : (
              <button
                onClick={() => sourceFileInputRef.current?.click()}
                onDrop={handleSourceFileDrop}
                onDragOver={e => { e.preventDefault(); setSourceDragOver(true); }}
                onDragLeave={e => { e.preventDefault(); setSourceDragOver(false); }}
                disabled={phase !== 'input'}
                className={`w-full py-4 border-2 border-dashed rounded-lg text-xs transition-colors disabled:opacity-50 disabled:hover:border-gray-200 disabled:hover:text-gray-400 ${
                  sourceDragOver
                    ? 'border-green-400 bg-green-50 text-green-500'
                    : 'border-gray-200 text-gray-400 hover:border-green-300 hover:text-green-500'
                }`}
              >
                <div className="text-lg mb-0.5">+</div>
                <div>{sourceDragOver ? 'ドロップしてアップロード' : 'ファイルをドラッグ＆ドロップ or クリック'}</div>
              </button>
            )}
            {sourceFileError && (
              <p className="text-[10px] text-red-500 mt-1">{sourceFileError}</p>
            )}
            <p className="text-[10px] text-gray-300 mt-1">.md / .txt / 画像 (PNG/JPEG/WebP) 対応。AIが画像内テキストもOCRして読み取ります。PDF / 動画は Phase 2 で対応予定</p>
          </div>

          {/* Screenshot Upload */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              ファーストビューのスクショ <span className="text-gray-300 font-normal">(推奨)</span>
            </label>
            <input
              ref={screenshotInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleScreenshotSelect}
              className="hidden"
            />
            {screenshotBase64 ? (
              <div className="relative">
                <img
                  src={screenshotBase64}
                  alt="スクリーンショット"
                  className="w-full rounded-lg border border-gray-200 object-contain max-h-40"
                />
                <button
                  onClick={() => setScreenshotBase64(null)}
                  disabled={phase !== 'input'}
                  className="absolute top-1 right-1 w-5 h-5 bg-black/60 text-white rounded-full flex items-center justify-center text-xs hover:bg-black/80 transition-colors"
                >
                  &times;
                </button>
              </div>
            ) : (
              <button
                onClick={() => screenshotInputRef.current?.click()}
                onDrop={handleScreenshotDrop}
                onDragOver={e => { e.preventDefault(); setScreenshotDragOver(true); }}
                onDragLeave={e => { e.preventDefault(); setScreenshotDragOver(false); }}
                disabled={phase !== 'input'}
                className={`w-full py-4 border-2 border-dashed rounded-lg text-xs transition-colors disabled:opacity-50 disabled:hover:border-gray-200 disabled:hover:text-gray-400 ${
                  screenshotDragOver
                    ? 'border-green-400 bg-green-50 text-green-500'
                    : 'border-gray-200 text-gray-400 hover:border-green-300 hover:text-green-500'
                }`}
              >
                <div className="text-lg mb-0.5">+</div>
                <div>{screenshotDragOver ? 'ドロップしてアップロード' : 'ページのスクショを貼ると精度UP'}</div>
              </button>
            )}
            <p className="text-[10px] text-gray-300 mt-1">JS描画のLPはスクショからAIがテキストを読み取ります</p>
          </div>

          {/* Aspect Ratio */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">アスペクト比</label>
            <div className="flex gap-1.5">
              {ASPECT_RATIOS.map(ar => (
                <button
                  key={ar.value}
                  onClick={() => setAspectRatio(ar.value)}
                  disabled={phase === 'gallery'}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
                    aspectRatio === ar.value
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  } disabled:opacity-50`}
                >
                  {ar.label}
                </button>
              ))}
            </div>
          </div>

          {/* Engine */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">生成エンジン</label>
            <div className="grid grid-cols-2 gap-1.5">
              {ENGINE_OPTIONS.map(eng => (
                <button
                  key={eng.value}
                  onClick={() => setEngine(eng.value)}
                  disabled={phase === 'gallery'}
                  className={`py-2 rounded-lg text-center transition-all border ${
                    engine === eng.value
                      ? 'bg-green-50 border-green-400 text-green-700'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  } disabled:opacity-50`}
                >
                  <div className="text-xs font-bold">{eng.label}</div>
                  <div className="text-[10px] text-gray-400">{eng.sub}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          {phase === 'input' && (
            <button
              onClick={analyze}
              disabled={(!url.trim() && !sourceFile) || isAnalyzing}
              className="w-full py-3 rounded-xl font-bold text-white text-base transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-green-600 hover:bg-green-500 active:scale-[0.98]"
            >
              {isScraping ? (
                <span className="flex items-center justify-center gap-2">
                  <Spinner />
                  ページを解析中...
                </span>
              ) : isGeneratingConcepts ? (
                <span className="flex items-center justify-center gap-2">
                  <Spinner />
                  コンセプトを生成中...
                </span>
              ) : (
                '分析開始'
              )}
            </button>
          )}

          {phase !== 'input' && (
            <button
              onClick={reset}
              disabled={isAnyGenerating}
              className="w-full py-2.5 rounded-lg text-sm font-medium transition-all border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40"
            >
              最初からやり直す
            </button>
          )}

          {/* Page Summary */}
          {scrapedData && (
            <div className="bg-gray-50 rounded-lg p-3 space-y-2">
              <h3 className="text-xs font-semibold text-gray-500">ページ情報</h3>
              <p className="text-sm font-medium text-gray-800 leading-snug">{scrapedData.title}</p>
              {scrapedData.description && (
                <p className="text-xs text-gray-500 leading-relaxed">{scrapedData.description.slice(0, 100)}{scrapedData.description.length > 100 ? '...' : ''}</p>
              )}
              {scrapedData.heroTexts && scrapedData.heroTexts.length > 0 && (
                <div className="mt-1.5">
                  <span className="text-[10px] text-gray-400">冒頭テキスト:</span>
                  <div className="mt-0.5 space-y-0.5">
                    {scrapedData.heroTexts.slice(0, 5).map((t, i) => (
                      <p key={i} className="text-[11px] text-gray-600 leading-snug">・{t}</p>
                    ))}
                  </div>
                </div>
              )}
              {scrapedData.primaryColors.length > 0 && (
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-[10px] text-gray-400">検出色:</span>
                  {scrapedData.primaryColors.map((c, i) => (
                    <div key={i} className="w-4 h-4 rounded-sm border border-gray-200" style={{ backgroundColor: c }} title={c} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right Panel */}
      <div className="flex-1 min-w-0 space-y-4">
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
            {error}
          </div>
        )}

        {phase === 'input' && !error && (
          <div className="bg-white rounded-xl border border-gray-200 p-12 flex items-center justify-center min-h-[300px]">
            <div className="text-center text-gray-300">
              <p className="text-4xl mb-3">📥</p>
              <p className="text-sm">URLを入力するか、素材ファイル（Markdown など）をドロップして</p>
              <p className="text-sm">「分析開始」を押すとAIが訴求軸を抽出します</p>
            </div>
          </div>
        )}

        {/* Concepts Phase */}
        {phase === 'concepts' && (
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700">
                コンセプト一覧 <span className="text-gray-400 font-normal">({selectedCount}件選択中)</span>
              </h3>
              <button
                onClick={generateBanners}
                disabled={selectedCount === 0}
                className="px-5 py-2.5 rounded-xl font-bold text-white text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-green-600 hover:bg-green-500 active:scale-[0.98]"
              >
                選択分のバナーを生成 ({selectedCount}枚)
              </button>
            </div>
            <div className="grid gap-3">
              {concepts.map(concept => (
                <ConceptCard
                  key={concept.id}
                  concept={concept}
                  onToggle={() => toggleConcept(concept.id)}
                  onUpdate={updates => updateConcept(concept.id, updates)}
                />
              ))}
            </div>
          </>
        )}

        {/* Gallery Phase */}
        {phase === 'gallery' && (
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700">
                生成結果
              </h3>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {concepts.filter(c => c.selected).map(concept => (
                <GalleryCard
                  key={concept.id}
                  concept={concept}
                  onEditInCreator={onEditInCreator ? () => {
                    if (concept.imageBase64) {
                      onEditInCreator(conceptToFormData(concept), concept.imageBase64);
                    }
                  } : undefined}
                  onRetry={() => retryConcept(concept.id)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ConceptCard({
  concept,
  onToggle,
  onUpdate,
}: {
  concept: BannerConcept;
  onToggle: () => void;
  onUpdate: (updates: Partial<BannerConcept>) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);

  const stopPropagation = (e: React.MouseEvent | React.SyntheticEvent) => e.stopPropagation();

  const updateExtraText = (index: number, patch: Partial<{ text: string; decoration?: TextDecoration }>) => {
    const next = concept.extraTexts.map((et, i) => (i === index ? { ...et, ...patch } : et));
    onUpdate({ extraTexts: next });
  };

  const removeExtraText = (index: number) => {
    onUpdate({ extraTexts: concept.extraTexts.filter((_, i) => i !== index) });
  };

  const addExtraText = () => {
    onUpdate({ extraTexts: [...concept.extraTexts, { text: '', decoration: 'none' }] });
  };

  return (
    <div
      onClick={isEditing ? undefined : onToggle}
      className={`p-4 rounded-xl border-2 transition-all ${
        isEditing ? 'cursor-default' : 'cursor-pointer'
      } ${
        concept.selected
          ? 'border-green-500 bg-green-50/50'
          : 'border-gray-200 bg-white hover:border-gray-300'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox */}
        <div className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
          concept.selected ? 'bg-green-600 border-green-600' : 'border-gray-300'
        }`}>
          {concept.selected && (
            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">{concept.angle}</span>
            <div className="w-4 h-4 rounded-full border border-gray-200" style={{ backgroundColor: concept.mainColor }} title={concept.mainColor} />
            <button
              onClick={e => { stopPropagation(e); setIsEditing(v => !v); }}
              className={`ml-auto text-[11px] px-2 py-0.5 rounded-md font-medium transition-colors ${
                isEditing
                  ? 'bg-green-600 text-white hover:bg-green-500'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {isEditing ? '完了' : '編集'}
            </button>
          </div>

          <PolicyWarningBadge warnings={concept.policyWarnings} />

          {isEditing ? (
            <div className="space-y-2 mt-1">
              <div>
                <label className="block text-[10px] font-medium text-gray-400 mb-0.5">メインテキスト</label>
                <input
                  type="text"
                  value={concept.mainText}
                  onChange={e => onUpdate({ mainText: e.target.value })}
                  onClick={stopPropagation}
                  className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-gray-400 mb-0.5">サブテキスト</label>
                <input
                  type="text"
                  value={concept.subText}
                  onChange={e => onUpdate({ subText: e.target.value })}
                  onClick={stopPropagation}
                  className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-gray-400 mb-0.5">追加テキスト</label>
                <div className="space-y-1.5">
                  {concept.extraTexts.map((et, i) => (
                    <div key={i} className="flex gap-1.5 items-center">
                      <input
                        type="text"
                        value={et.text}
                        onChange={e => updateExtraText(i, { text: e.target.value })}
                        onClick={stopPropagation}
                        className="flex-1 min-w-0 border border-gray-200 rounded-md px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-green-500"
                      />
                      <select
                        value={et.decoration ?? 'none'}
                        onChange={e => updateExtraText(i, { decoration: e.target.value as TextDecoration })}
                        onClick={stopPropagation}
                        className="border border-gray-200 rounded-md px-1.5 py-1 text-[11px] text-gray-600 focus:outline-none focus:ring-2 focus:ring-green-500"
                      >
                        {DECORATION_OPTIONS.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                      <button
                        onClick={e => { stopPropagation(e); removeExtraText(i); }}
                        className="w-6 h-6 rounded-md bg-gray-100 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors text-xs"
                        title="削除"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={e => { stopPropagation(e); addExtraText(); }}
                    className="w-full py-1 rounded-md text-[11px] text-gray-400 border border-dashed border-gray-200 hover:border-green-300 hover:text-green-500 transition-colors"
                  >
                    + 追加テキストを足す
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm font-bold text-gray-900">{concept.mainText}</p>
              <p className="text-xs text-gray-500 mt-0.5">{concept.subText}</p>
              {concept.extraTexts.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {concept.extraTexts.map((et, i) => (
                    <span key={i} className={`text-[10px] px-2 py-0.5 rounded-full ${
                      et.decoration && et.decoration !== 'none'
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {et.text}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function GalleryCard({ concept, onEditInCreator, onRetry }: { concept: BannerConcept; onEditInCreator?: () => void; onRetry?: () => void }) {
  const handleDownload = () => {
    if (!concept.imageBase64) return;
    const link = document.createElement('a');
    link.download = `banner-${concept.angle}.png`;
    link.href = concept.imageBase64;
    link.click();
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Image */}
      <div className="relative aspect-square bg-gray-50">
        {concept.isGenerating ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <Spinner size="lg" />
            <p className="text-sm text-gray-400">生成中...</p>
          </div>
        ) : concept.error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-4 gap-3">
            <p className="text-sm text-red-500 text-center">{concept.error}</p>
            {onRetry && (
              <button
                onClick={onRetry}
                className="px-4 py-2 rounded-lg text-xs font-medium bg-green-600 text-white hover:bg-green-500 transition-colors"
              >
                リトライ
              </button>
            )}
          </div>
        ) : concept.imageBase64 ? (
          <img
            src={concept.imageBase64}
            alt={concept.mainText}
            className="w-full h-full object-contain"
          />
        ) : null}
      </div>

      {/* Info */}
      <div className="p-3 border-t border-gray-100">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-bold text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full">{concept.angle}</span>
        </div>
        <p className="text-xs font-medium text-gray-800 truncate">{concept.mainText}</p>

        {/* Actions */}
        {concept.imageBase64 && !concept.isGenerating && (
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleDownload}
              className="flex-1 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
            >
              ダウンロード
            </button>
            {onEditInCreator && (
              <button
                onClick={onEditInCreator}
                className="flex-1 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-500 transition-colors"
              >
                編集する
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Spinner({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  const cls = size === 'lg' ? 'w-8 h-8' : 'w-4 h-4';
  return (
    <svg className={`animate-spin ${cls}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}
