'use client';

import { useRef, useState } from 'react';
import { ENGINE_OPTIONS } from '@/lib/engine-options';
import { useVariationGenerator } from '@/hooks/useVariationGenerator';
import type { AspectRatio, BannerFormData, Variation, VariationCategory } from '@/lib/types';

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

export default function VariationGenerator({ onEditInCreator }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const assetInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [assetDragOver, setAssetDragOver] = useState(false);
  const {
    imageBase64, setImageBase64,
    assetImageBase64, setAssetImageBase64,
    aspectRatio, setAspectRatio,
    engine, setEngine,
    category, setCategory,
    phase,
    analysis,
    variations,
    error,
    analyze,
    startGeneration,
    removeExtraText,
    retryVariation,
    reset,
    variationToFormData,
  } = useVariationGenerator();

  const isProcessing = phase === 'analyzing' || phase === 'styling';
  /** 読み取ったテキストを削除できるフェーズ（review=初回生成前 / gallery=以降の再生成に反映） */
  const canEditTexts = phase === 'review' || phase === 'gallery';
  const isAnyGenerating = variations.some(v => v.isGenerating);

  const loadFile = (file: File) => {
    if (!file.type.match(/^image\/(png|jpeg|webp)$/)) {
      alert('PNG、JPEG、WebP形式の画像を選択してください');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert('10MB以下の画像を選択してください');
      return;
    }

    // 画像サイズからアスペクト比を自動判定
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      img.onload = () => {
        const ratio = img.width / img.height;
        let detected: AspectRatio = '1:1';
        if (ratio > 1.5) detected = '16:9';
        else if (ratio > 1.2) detected = '4:3';
        else if (ratio < 0.67) detected = '9:16';
        else if (ratio < 0.85) detected = '3:4';
        setAspectRatio(detected);
        setImageBase64(dataUrl);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    loadFile(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
  };

  // 素材画像（変更禁止）: アスペクト比判定は行わず、そのまま保持する
  const loadAssetFile = (file: File) => {
    if (!file.type.match(/^image\/(png|jpeg|webp)$/)) {
      alert('PNG、JPEG、WebP形式の画像を選択してください');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert('10MB以下の画像を選択してください');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setAssetImageBase64(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleAssetSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    loadAssetFile(file);
    e.target.value = '';
  };

  const handleAssetDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setAssetDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) loadAssetFile(file);
  };

  return (
    <div className="flex gap-6 flex-col lg:flex-row">
      {/* Left Panel */}
      <div className="lg:w-[400px] shrink-0">
        <div className="space-y-5 p-5 bg-white rounded-xl border border-gray-200">
          <div>
            <h2 className="text-lg font-bold text-gray-900">バリエーション作成</h2>
            <p className="text-xs text-gray-400 mt-1">
              既存のバナー画像をアップロードすると、同じ内容で6種類の違うデザインテイストを自動生成します。
            </p>
          </div>

          {/* Image Upload */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              ベース画像 <span className="text-red-400">*</span>
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleSelect}
              className="hidden"
            />
            {imageBase64 ? (
              <div className="relative">
                <img
                  src={imageBase64}
                  alt="ベース画像"
                  className="w-full rounded-lg border border-gray-200 object-contain max-h-60"
                />
                <button
                  onClick={() => setImageBase64(null)}
                  disabled={isProcessing || isAnyGenerating}
                  className="absolute top-1 right-1 w-5 h-5 bg-black/60 text-white rounded-full flex items-center justify-center text-xs hover:bg-black/80 transition-colors disabled:opacity-30"
                >
                  &times;
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={e => { e.preventDefault(); setDragOver(false); }}
                className={`w-full py-8 border-2 border-dashed rounded-lg text-xs transition-colors ${
                  dragOver
                    ? 'border-purple-400 bg-purple-50 text-purple-500'
                    : 'border-gray-200 text-gray-400 hover:border-purple-300 hover:text-purple-500'
                }`}
              >
                <div className="text-2xl mb-1">+</div>
                <div>{dragOver ? 'ドロップしてアップロード' : '画像をドラッグ or クリックして選択'}</div>
                <div className="text-[10px] text-gray-300 mt-1">PNG / JPEG / WebP（10MBまで）</div>
              </button>
            )}
          </div>

          {/* Asset Image (変更禁止素材) */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              素材画像 <span className="text-gray-300 font-normal">(任意・変更せずそのまま使用)</span>
            </label>
            <input
              ref={assetInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleAssetSelect}
              className="hidden"
            />
            {assetImageBase64 ? (
              <div className="relative">
                <img
                  src={assetImageBase64}
                  alt="素材画像"
                  className="w-full rounded-lg border border-gray-200 object-contain max-h-40"
                />
                <span className="absolute bottom-1 left-1 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white">
                  変更禁止素材
                </span>
                <button
                  onClick={() => setAssetImageBase64(null)}
                  disabled={isProcessing || isAnyGenerating}
                  className="absolute top-1 right-1 w-5 h-5 bg-black/60 text-white rounded-full flex items-center justify-center text-xs hover:bg-black/80 transition-colors disabled:opacity-30"
                >
                  &times;
                </button>
              </div>
            ) : (
              <button
                onClick={() => assetInputRef.current?.click()}
                onDrop={handleAssetDrop}
                onDragOver={e => { e.preventDefault(); setAssetDragOver(true); }}
                onDragLeave={e => { e.preventDefault(); setAssetDragOver(false); }}
                className={`w-full py-4 border-2 border-dashed rounded-lg text-xs transition-colors ${
                  assetDragOver
                    ? 'border-purple-400 bg-purple-50 text-purple-500'
                    : 'border-gray-200 text-gray-400 hover:border-purple-300 hover:text-purple-500'
                }`}
              >
                <div>書籍・商品・パッケージ・人物の写真</div>
                <div className="text-[10px] text-gray-300 mt-1">アップすると描き替えずそのまま配置します</div>
              </button>
            )}
          </div>

          {/* Aspect Ratio */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              アスペクト比 <span className="text-gray-300 font-normal">(画像から自動判定)</span>
            </label>
            <div className="flex gap-1.5">
              {ASPECT_RATIOS.map(ar => (
                <button
                  key={ar.value}
                  onClick={() => setAspectRatio(ar.value)}
                  disabled={phase === 'gallery' || isProcessing}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
                    aspectRatio === ar.value
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  } disabled:opacity-50`}
                >
                  {ar.label}
                </button>
              ))}
            </div>
          </div>

          {/* Use Case / Category */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              用途 <span className="text-gray-300 font-normal">(画像から自動判定 / 手動変更可)</span>
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {([
                { value: 'auto' as VariationCategory, label: '自動判定', sub: 'AIおまかせ' },
                { value: 'serious' as VariationCategory, label: 'B2B / 経営者', sub: '高級感を必須' },
                { value: 'soft' as VariationCategory, label: '化粧品 / 物販', sub: '親しみやすさを必須' },
                { value: 'bold' as VariationCategory, label: 'イベント / ローンチ', sub: 'インパクトを必須' },
              ]).map(c => (
                <button
                  key={c.value}
                  onClick={() => setCategory(c.value)}
                  disabled={phase === 'gallery' || isProcessing}
                  className={`py-2 rounded-lg text-center transition-all border ${
                    category === c.value
                      ? 'bg-purple-50 border-purple-400 text-purple-700'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  } disabled:opacity-50`}
                >
                  <div className="text-xs font-bold">{c.label}</div>
                  <div className="text-[10px] text-gray-400">{c.sub}</div>
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
                  disabled={phase === 'gallery' || isProcessing}
                  className={`py-2 rounded-lg text-center transition-all border ${
                    engine === eng.value
                      ? 'bg-purple-50 border-purple-400 text-purple-700'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  } disabled:opacity-50`}
                >
                  <div className="text-xs font-bold">{eng.label}</div>
                  <div className="text-[10px] text-gray-400">{eng.sub}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Action */}
          {phase === 'input' && (
            <button
              onClick={analyze}
              disabled={!imageBase64 || isProcessing}
              className="w-full py-3 rounded-xl font-bold text-white text-base transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-purple-600 hover:bg-purple-500 active:scale-[0.98]"
            >
              画像を読み取る
            </button>
          )}

          {phase === 'review' && (
            <button
              onClick={startGeneration}
              className="w-full py-3 rounded-xl font-bold text-white text-base transition-all bg-purple-600 hover:bg-purple-500 active:scale-[0.98]"
            >
              この内容で6案を生成
            </button>
          )}

          {phase !== 'input' && (
            <button
              onClick={reset}
              disabled={isAnyGenerating || isProcessing}
              className="w-full py-2.5 rounded-lg text-sm font-medium transition-all border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40"
            >
              最初からやり直す
            </button>
          )}

          {/* Analysis Summary */}
          {analysis && (
            <div className="bg-gray-50 rounded-lg p-3 space-y-1.5">
              <h3 className="text-xs font-semibold text-gray-500">読み取った内容</h3>
              {analysis.mainText && (
                <p className="text-sm font-medium text-gray-800 leading-snug">{analysis.mainText}</p>
              )}
              {analysis.subText && (
                <p className="text-xs text-gray-500 leading-relaxed">{analysis.subText}</p>
              )}
              {analysis.extraTexts.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {analysis.extraTexts.map((et, i) => (
                    canEditTexts ? (
                      <button
                        key={`${et.text}-${i}`}
                        onClick={() => removeExtraText(i)}
                        title="クリックで削除（バナーに入れない）"
                        className="group text-[10px] px-2 py-0.5 rounded-full bg-gray-200 text-gray-600 hover:bg-red-100 hover:text-red-500 transition-colors"
                      >
                        {et.text}
                        <span className="ml-1 text-gray-400 group-hover:text-red-400">&times;</span>
                      </button>
                    ) : (
                      <span key={`${et.text}-${i}`} className="text-[10px] px-2 py-0.5 rounded-full bg-gray-200 text-gray-600">
                        {et.text}
                      </span>
                    )
                  ))}
                </div>
              )}
              {canEditTexts && analysis.extraTexts.length > 0 && (
                <p className="text-[10px] text-gray-400">
                  タグをクリックすると削除できます{phase === 'gallery' ? '（以降の「再生成」に反映）' : ''}
                </p>
              )}
              {analysis.contextSummary && (
                <p className="text-[11px] text-gray-400 leading-relaxed pt-1 border-t border-gray-200 mt-2">
                  {analysis.contextSummary}
                </p>
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
          <div className="bg-white rounded-xl border border-gray-200 p-12 flex items-center justify-center min-h-[400px]">
            <div className="text-center text-gray-300">
              <p className="text-4xl mb-3">🎨</p>
              <p className="text-sm">画像をアップロードして「画像を読み取る」を押すと</p>
              <p className="text-sm">内容を確認してから6種類の違うデザインテイストを生成できます</p>
            </div>
          </div>
        )}

        {phase === 'review' && (
          <div className="bg-white rounded-xl border border-gray-200 p-12 flex items-center justify-center min-h-[400px]">
            <div className="text-center text-gray-400">
              <p className="text-4xl mb-3">✅</p>
              <p className="text-sm">読み取った内容を確認してください</p>
              <p className="text-xs text-gray-300 mt-2">不要なテキストはタグをクリックして削除できます</p>
              <p className="text-xs text-gray-300">よければ「この内容で6案を生成」を押してください</p>
            </div>
          </div>
        )}

        {phase === 'analyzing' && (
          <div className="bg-white rounded-xl border border-gray-200 p-12 flex items-center justify-center min-h-[400px]">
            <div className="text-center">
              <div className="flex justify-center mb-3"><Spinner size="lg" /></div>
              <p className="text-sm text-gray-500">画像を解析中...</p>
              <p className="text-xs text-gray-400 mt-1">テキスト・配色・主旨を読み取っています</p>
            </div>
          </div>
        )}

        {phase === 'styling' && (
          <div className="bg-white rounded-xl border border-gray-200 p-12 flex items-center justify-center min-h-[400px]">
            <div className="text-center">
              <div className="flex justify-center mb-3"><Spinner size="lg" /></div>
              <p className="text-sm text-gray-500">6つのデザインテイストを考案中...</p>
            </div>
          </div>
        )}

        {phase === 'gallery' && (
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700">
                バリエーション <span className="text-gray-400 font-normal">({variations.length}パターン)</span>
              </h3>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {variations.map(v => (
                <VariationCard
                  key={v.id}
                  variation={v}
                  onRetry={() => retryVariation(v.id)}
                  onEditInCreator={onEditInCreator ? () => {
                    const fd = variationToFormData(v);
                    if (fd && v.imageBase64) onEditInCreator(fd, v.imageBase64);
                  } : undefined}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function VariationCard({
  variation,
  onRetry,
  onEditInCreator,
}: {
  variation: Variation;
  onRetry?: () => void;
  onEditInCreator?: () => void;
}) {
  const handleDownload = () => {
    if (!variation.imageBase64) return;
    const link = document.createElement('a');
    link.download = `variation-${variation.name}.png`;
    link.href = variation.imageBase64;
    link.click();
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Image */}
      <div className="relative aspect-square bg-gray-50">
        {variation.isGenerating ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <Spinner size="lg" />
            <p className="text-sm text-gray-400">生成中...</p>
          </div>
        ) : variation.error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-4 gap-3">
            <p className="text-sm text-red-500 text-center">{variation.error}</p>
            {onRetry && (
              <button
                onClick={onRetry}
                className="px-4 py-2 rounded-lg text-xs font-medium bg-purple-600 text-white hover:bg-purple-500 transition-colors"
              >
                リトライ
              </button>
            )}
          </div>
        ) : variation.imageBase64 ? (
          <img
            src={variation.imageBase64}
            alt={variation.name}
            className="w-full h-full object-contain"
          />
        ) : null}
      </div>

      {/* Info */}
      <div className="p-3 border-t border-gray-100 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-purple-700 bg-purple-100 px-2 py-0.5 rounded-full">
            {variation.name}
          </span>
          {variation.paletteHex.length > 0 && (
            <div className="flex items-center gap-0.5 ml-auto">
              {variation.paletteHex.slice(0, 4).map((c, i) => (
                <div key={i} className="w-3.5 h-3.5 rounded-sm border border-gray-200" style={{ backgroundColor: c }} title={c} />
              ))}
            </div>
          )}
        </div>
        {variation.descriptionJa && (
          <p className="text-[11px] text-gray-500 leading-snug line-clamp-2">{variation.descriptionJa}</p>
        )}

        {variation.imageBase64 && !variation.isGenerating && (
          <div className="space-y-1.5 pt-1">
            <div className="flex gap-2">
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
            {onRetry && (
              <button
                onClick={onRetry}
                className="w-full py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors flex items-center justify-center gap-1"
                title="同じテイストで再生成"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                再生成
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
