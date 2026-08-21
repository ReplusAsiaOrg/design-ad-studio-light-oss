'use client';

import { useRef, useState, useEffect } from 'react';
import { ENGINE_OPTIONS } from '@/lib/engine-options';
import { BannerFormData, AspectRatio, FontStyle, TextDecoration } from '@/lib/types';
import { downscaleImageDataUrl } from '@/lib/image-resize';

interface Props {
  formData: BannerFormData;
  onUpdate: (updates: Partial<BannerFormData>) => void;
  onAddExtra: () => void;
  onRemoveExtra: (id: string) => void;
}

const ASPECT_RATIOS: { value: AspectRatio; label: string; sub: string }[] = [
  { value: '1:1', label: '1:1', sub: '正方形' },
  { value: '16:9', label: '16:9', sub: '横長' },
  { value: '9:16', label: '9:16', sub: '縦長' },
  { value: '4:3', label: '4:3', sub: '横' },
  { value: '3:4', label: '3:4', sub: '縦' },
  { value: 'custom', label: 'カスタム', sub: 'px指定' },
];

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b', '#ffffff', '#000000', '#6b7280',
];

const DECORATION_OPTIONS: { value: TextDecoration; label: string; icon: string }[] = [
  { value: 'none', label: 'なし', icon: '—' },
  { value: 'auto', label: 'AIおまかせ', icon: 'AI' },
  { value: 'button', label: 'ボタン', icon: 'BTN' },
  { value: 'badge', label: 'バッジ', icon: '◆' },
  { value: 'ribbon', label: 'リボン', icon: '⚑' },
  { value: 'circle', label: '円形', icon: '●' },
  { value: 'annotation', label: '注釈', icon: '小' },
];

const LOGO_POSITIONS = [
  { value: 'top-left', label: '左上' },
  { value: 'top-right', label: '右上' },
  { value: 'bottom-left', label: '左下' },
  { value: 'bottom-right', label: '右下' },
] as const;

export default function BannerForm({
  formData, onUpdate, onAddExtra, onRemoveExtra,
}: Props) {
  const refImageInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [refDragOver, setRefDragOver] = useState(false);
  const [logoDragOver, setLogoDragOver] = useState(false);
  const [openDecoId, setOpenDecoId] = useState<string | null>(null);

  useEffect(() => {
    if (!openDecoId) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-deco-popover]')) {
        setOpenDecoId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openDecoId]);

  const loadFile = (file: File, field: 'referenceImageBase64' | 'logoImageBase64') => {
    if (!file.type.match(/^image\/(png|jpeg|webp)$/)) {
      alert('PNG、JPEG、WebP形式の画像を選択してください');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert('10MB以下の画像を選択してください');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      // 参照画像はスクショ等で重くなりがちなので自動縮小。ロゴは透過維持のためそのまま
      const finalUrl = field === 'referenceImageBase64'
        ? await downscaleImageDataUrl(dataUrl)
        : dataUrl;
      onUpdate({ [field]: finalUrl });
    };
    reader.readAsDataURL(file);
  };

  const handleFileSelect = (
    e: React.ChangeEvent<HTMLInputElement>,
    field: 'referenceImageBase64' | 'logoImageBase64'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    loadFile(file, field);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent, field: 'referenceImageBase64' | 'logoImageBase64') => {
    e.preventDefault();
    if (field === 'referenceImageBase64') setRefDragOver(false);
    else setLogoDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file, field);
  };

  return (
    <div className="space-y-5 p-5 bg-white rounded-xl border border-gray-200 max-h-[calc(100vh-120px)] overflow-y-auto">
      <div>
        <h2 className="text-lg font-bold text-gray-900">バナーを作る</h2>
        <p className="text-xs text-gray-400 mt-1">テキストを入力するだけ。AIがデザインします。</p>
      </div>

      {/* エンジン */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-600">生成エンジン</h3>
        <div className="grid grid-cols-2 gap-2">
          {ENGINE_OPTIONS.map(eng => (
            <button
              key={eng.value}
              onClick={() => onUpdate({ engine: eng.value })}
              className={`py-2.5 rounded-lg text-center transition-all border ${
                formData.engine === eng.value
                  ? 'bg-blue-50 border-blue-400 text-blue-700'
                  : 'border-gray-200 text-gray-500 hover:border-gray-300'
              }`}
            >
              <div className="text-sm font-bold">{eng.label}</div>
              <div className="text-[10px] text-gray-400">{eng.sub}</div>
            </button>
          ))}
        </div>
      </div>

      {/* テキスト */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-600">テキスト</h3>

        <div>
          <label className="block text-xs text-gray-400 mb-1">
            メインテキスト
            <span className="ml-1.5 text-[10px] text-gray-300">改行で行を分けられます</span>
          </label>
          <textarea
            value={formData.mainText}
            onChange={e => onUpdate({ mainText: e.target.value })}
            rows={2}
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder:text-gray-300 resize-y"
            placeholder="夏期講習募集"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">
            サブテキスト
            <span className="ml-1.5 text-[10px] text-gray-300">改行で行を分けられます</span>
          </label>
          <div className="flex gap-2 items-start">
            <textarea
              value={formData.subText}
              onChange={e => onUpdate({ subText: e.target.value })}
              rows={2}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2.5 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder:text-gray-300 resize-y"
              placeholder="先着15名様入学金無料"
            />
            <div className="relative" data-deco-popover>
              <button
                onClick={() => setOpenDecoId(openDecoId === '_sub' ? null : '_sub')}
                title="装飾スタイル"
                className={`px-2 py-1 rounded text-[10px] font-medium border transition-all whitespace-nowrap ${
                  formData.subTextDecoration && formData.subTextDecoration !== 'none'
                    ? 'bg-blue-50 border-blue-400 text-blue-700'
                    : 'border-gray-200 text-gray-300 hover:border-gray-300'
                }`}
              >
                {DECORATION_OPTIONS.find(d => d.value === (formData.subTextDecoration ?? 'none'))?.icon ?? '—'}
              </button>
              {openDecoId === '_sub' && (
                <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[130px]">
                  {DECORATION_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => {
                        onUpdate({ subTextDecoration: opt.value });
                        setOpenDecoId(null);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                        (formData.subTextDecoration ?? 'none') === opt.value
                          ? 'bg-blue-50 text-blue-700 font-medium'
                          : 'text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      <span className="w-5 text-center">{opt.icon}</span>
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {formData.extraTexts.map((et, i) => (
          <div key={et.id}>
            <label className="block text-xs text-gray-400 mb-1">その他 {i + 1}</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={et.text}
                onChange={e => {
                  const newExtras = formData.extraTexts.map(t =>
                    t.id === et.id ? { ...t, text: e.target.value } : t
                  );
                  onUpdate({ extraTexts: newExtras });
                }}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder:text-gray-300"
                placeholder="テキスト"
              />
              <div className="relative" data-deco-popover>
                <button
                  onClick={() => setOpenDecoId(openDecoId === et.id ? null : et.id)}
                  title="装飾スタイル"
                  className={`px-2 py-1 rounded text-[10px] font-medium border transition-all whitespace-nowrap ${
                    et.decoration && et.decoration !== 'none'
                      ? 'bg-blue-50 border-blue-400 text-blue-700'
                      : 'border-gray-200 text-gray-300 hover:border-gray-300'
                  }`}
                >
                  {DECORATION_OPTIONS.find(d => d.value === (et.decoration ?? 'none'))?.icon ?? '—'}
                </button>
                {openDecoId === et.id && (
                  <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[130px]">
                    {DECORATION_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => {
                          const newExtras = formData.extraTexts.map(t =>
                            t.id === et.id ? { ...t, decoration: opt.value } : t
                          );
                          onUpdate({ extraTexts: newExtras });
                          setOpenDecoId(null);
                        }}
                        className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                          (et.decoration ?? 'none') === opt.value
                            ? 'bg-blue-50 text-blue-700 font-medium'
                            : 'text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <span className="w-5 text-center">{opt.icon}</span>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={() => onRemoveExtra(et.id)}
                className="text-gray-300 hover:text-red-500 px-1 text-lg transition-colors"
              >
                &times;
              </button>
            </div>
          </div>
        ))}

        <button
          onClick={onAddExtra}
          className="w-full py-2 border-2 border-dashed border-gray-200 rounded-lg text-gray-400 text-sm hover:border-gray-300 hover:text-gray-500 transition-colors"
        >
          + テキストを追加
        </button>
      </div>

      {/* カラー */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-600">メインカラー</h3>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onUpdate({ mainColor: '' })}
            className={`w-8 h-8 rounded-full border-2 transition-all flex items-center justify-center text-[9px] font-bold ${
              formData.mainColor === ''
                ? 'border-blue-500 scale-110 ring-2 ring-blue-100 bg-gradient-to-br from-pink-200 via-yellow-200 to-cyan-200 text-gray-600'
                : 'border-gray-200 hover:scale-105 bg-gradient-to-br from-pink-100 via-yellow-100 to-cyan-100 text-gray-400'
            }`}
            title="AIおまかせ"
          >
            AI
          </button>
          {PRESET_COLORS.map(color => (
            <button
              key={color}
              onClick={() => onUpdate({ mainColor: color })}
              className={`w-8 h-8 rounded-full border-2 transition-all ${
                formData.mainColor === color
                  ? 'border-blue-500 scale-110 ring-2 ring-blue-100'
                  : 'border-gray-200 hover:scale-105'
              } ${color === '#ffffff' ? 'border-gray-300' : ''}`}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
        {formData.mainColor === '' ? (
          <p className="text-xs text-gray-400">AIがテーマに最適な配色を選びます</p>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={formData.mainColor}
              onChange={e => onUpdate({ mainColor: e.target.value })}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="color"
              value={formData.mainColor}
              onChange={e => onUpdate({ mainColor: e.target.value })}
              className="w-10 h-10 rounded-lg cursor-pointer border-0 bg-transparent"
            />
          </div>
        )}
      </div>

      {/* アスペクト比 */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-600">サイズ</h3>
        <div className="grid grid-cols-3 gap-2">
          {ASPECT_RATIOS.map(ar => (
            <button
              key={ar.value}
              onClick={() =>
                onUpdate(
                  ar.value === 'custom'
                    ? { aspectRatio: 'custom', customWidth: formData.customWidth ?? 1200, customHeight: formData.customHeight ?? 630 }
                    : { aspectRatio: ar.value },
                )
              }
              className={`py-2.5 rounded-lg text-center transition-all border ${
                formData.aspectRatio === ar.value
                  ? 'bg-blue-50 border-blue-400 text-blue-700'
                  : 'border-gray-200 text-gray-500 hover:border-gray-300'
              }`}
            >
              <div className="text-sm font-bold">{ar.label}</div>
              <div className="text-[10px] text-gray-400">{ar.sub}</div>
            </button>
          ))}
        </div>
        {formData.aspectRatio === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={100}
              max={4000}
              value={formData.customWidth ?? ''}
              onChange={e => onUpdate({ customWidth: e.target.value === '' ? undefined : Number(e.target.value) })}
              placeholder="幅"
              className="w-24 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400"
            />
            <span className="text-gray-400 text-sm">×</span>
            <input
              type="number"
              min={100}
              max={4000}
              value={formData.customHeight ?? ''}
              onChange={e => onUpdate({ customHeight: e.target.value === '' ? undefined : Number(e.target.value) })}
              placeholder="高さ"
              className="w-24 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400"
            />
            <span className="text-gray-400 text-xs">px（100〜4000）</span>
          </div>
        )}
      </div>

      {/* フォント */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-600">フォント</h3>
        <div className="grid grid-cols-3 gap-2">
          {([
            { value: 'auto' as FontStyle, label: '自動', sub: 'AI判断' },
            { value: 'gothic' as FontStyle, label: 'ゴシック', sub: 'サンセリフ' },
            { value: 'mincho' as FontStyle, label: '明朝', sub: 'セリフ' },
            { value: 'rounded-gothic' as FontStyle, label: '丸ゴシック', sub: '親しみやすい' },
            { value: 'light-mincho' as FontStyle, label: '細明朝', sub: '上品・繊細' },
            { value: 'handwritten' as FontStyle, label: '手書き風', sub: 'ナチュラル' },
          ]).map(f => (
            <button
              key={f.value}
              onClick={() => onUpdate({ fontStyle: f.value })}
              className={`py-2.5 rounded-lg text-center transition-all border ${
                formData.fontStyle === f.value
                  ? 'bg-blue-50 border-blue-400 text-blue-700'
                  : 'border-gray-200 text-gray-500 hover:border-gray-300'
              }`}
            >
              <div className="text-sm font-bold">{f.label}</div>
              <div className="text-[10px] text-gray-400">{f.sub}</div>
            </button>
          ))}
        </div>
      </div>

      {/* 人物 */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-600">人物</h3>
        <div className="grid grid-cols-3 gap-2">
          {([
            { value: 'none' as const, label: 'なし', sub: '出さない' },
            { value: 'yes' as const, label: 'あり', sub: '含める' },
            { value: 'auto' as const, label: 'AIおまかせ', sub: 'AI判断' },
          ]).map(opt => {
            const current = formData.personMode ?? (formData.hasPersons ? 'yes' : 'auto');
            return (
              <button
                key={opt.value}
                onClick={() => onUpdate({ personMode: opt.value, hasPersons: opt.value === 'yes' })}
                className={`py-2.5 rounded-lg text-center transition-all border ${
                  current === opt.value
                    ? 'bg-blue-50 border-blue-400 text-blue-700'
                    : 'border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
              >
                <div className="text-xs font-medium">{opt.label}</div>
                <div className="text-[10px] text-gray-400">{opt.sub}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 参照URL */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-600">
          参照URL <span className="text-gray-300 font-normal">(任意)</span>
        </h3>
        <input
          type="url"
          value={formData.referenceUrl ?? ''}
          onChange={e => onUpdate({ referenceUrl: e.target.value })}
          placeholder="https://example.com/lp"
          className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder:text-gray-300"
        />
        <p className="text-[10px] text-gray-300">LPやCRバナーのURLを入れると、デザインテイストを参考にします（常に「参考にする」モードで処理されます）</p>
      </div>

      {/* 参照画像 */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-600">
          参照画像 <span className="text-gray-300 font-normal">(任意)</span>
        </h3>
        <input
          ref={refImageInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={e => handleFileSelect(e, 'referenceImageBase64')}
          className="hidden"
        />
        {formData.referenceImageBase64 ? (
          <div className="relative">
            <img
              src={formData.referenceImageBase64}
              alt="参照画像"
              className="w-full rounded-lg border border-gray-200 object-cover max-h-32"
            />
            <button
              onClick={() => onUpdate({ referenceImageBase64: undefined })}
              className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/60 text-white rounded-full flex items-center justify-center text-sm hover:bg-black/80 transition-colors"
            >
              &times;
            </button>
          </div>
        ) : (
          <button
            onClick={() => refImageInputRef.current?.click()}
            onDrop={e => handleDrop(e, 'referenceImageBase64')}
            onDragOver={e => { e.preventDefault(); setRefDragOver(true); }}
            onDragLeave={e => { e.preventDefault(); setRefDragOver(false); }}
            className={`w-full py-3 border-2 border-dashed rounded-lg text-sm transition-colors ${
              refDragOver
                ? 'border-blue-400 bg-blue-50 text-blue-500'
                : 'border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-500'
            }`}
          >
            {refDragOver ? 'ドロップしてアップロード' : '+ 画像を選択（人物・商品など）'}
          </button>
        )}

        {/* 参照画像の使い方モード（常時表示） */}
        {(() => {
          const hasUrl = !!formData.referenceUrl?.trim();
          const hasImage = !!formData.referenceImageBase64;
          const isInactive = !hasUrl && !hasImage;
          // URLが入っている場合はstyle固定（バックエンドでも強制）
          const effectiveMode: 'style' | 'asset' = hasUrl || formData.referenceImageMode === 'style' ? 'style' : 'asset';
          // URL指定中、または未入力時はクリック不可
          const disabled = hasUrl || isInactive;
          return (
            <div className="space-y-1.5">
              <label className="block text-[10px] font-medium text-gray-500">この画像の使い方</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onUpdate({ referenceImageMode: 'style' })}
                  className={`py-2 px-2 rounded-lg text-center transition-all border text-[11px] ${
                    !isInactive && effectiveMode === 'style'
                      ? 'bg-blue-50 border-blue-400 text-blue-700'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  } ${disabled ? 'opacity-50 cursor-not-allowed hover:border-gray-200' : ''}`}
                >
                  <div className="font-bold">デザインの参考</div>
                  <div className="text-[9px] text-gray-400 mt-0.5">テイストを寄せる</div>
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onUpdate({ referenceImageMode: 'asset' })}
                  className={`py-2 px-2 rounded-lg text-center transition-all border text-[11px] ${
                    !isInactive && effectiveMode === 'asset'
                      ? 'bg-blue-50 border-blue-400 text-blue-700'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  } ${disabled ? 'opacity-50 cursor-not-allowed hover:border-gray-200' : ''}`}
                >
                  <div className="font-bold">そのまま使う</div>
                  <div className="text-[9px] text-gray-400 mt-0.5">人物・商品を含める</div>
                </button>
              </div>
              {isInactive && (
                <p className="text-[10px] text-gray-300">URLか画像を入力すると選択できます</p>
              )}
              {hasUrl && (
                <p className="text-[10px] text-gray-300">URL指定時は「デザインの参考」モード固定です</p>
              )}
            </div>
          );
        })()}
      </div>

      {/* ロゴ */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-600">
          ロゴ <span className="text-gray-300 font-normal">(任意)</span>
        </h3>
        <input
          ref={logoInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={e => handleFileSelect(e, 'logoImageBase64')}
          className="hidden"
        />
        {formData.logoImageBase64 ? (
          <div className="relative">
            <div className="bg-gray-50 rounded-lg border border-gray-200 p-3 flex items-center justify-center">
              <img
                src={formData.logoImageBase64}
                alt="ロゴ"
                className="max-h-20 object-contain"
              />
            </div>
            <button
              onClick={() => onUpdate({ logoImageBase64: undefined })}
              className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/60 text-white rounded-full flex items-center justify-center text-sm hover:bg-black/80 transition-colors"
            >
              &times;
            </button>
          </div>
        ) : (
          <button
            onClick={() => logoInputRef.current?.click()}
            onDrop={e => handleDrop(e, 'logoImageBase64')}
            onDragOver={e => { e.preventDefault(); setLogoDragOver(true); }}
            onDragLeave={e => { e.preventDefault(); setLogoDragOver(false); }}
            className={`w-full py-3 border-2 border-dashed rounded-lg text-sm transition-colors ${
              logoDragOver
                ? 'border-blue-400 bg-blue-50 text-blue-500'
                : 'border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-500'
            }`}
          >
            {logoDragOver ? 'ドロップしてアップロード' : '+ ロゴ画像を選択'}
          </button>
        )}
        {formData.logoImageBase64 && (
          <div>
            <label className="block text-[10px] text-gray-400 mb-1">配置位置</label>
            <div className="grid grid-cols-4 gap-1.5">
              {LOGO_POSITIONS.map(pos => (
                <button
                  key={pos.value}
                  onClick={() => onUpdate({ logoPosition: pos.value })}
                  className={`py-1.5 rounded text-center transition-all border text-[11px] ${
                    (formData.logoPosition ?? 'bottom-right') === pos.value
                      ? 'bg-blue-50 border-blue-400 text-blue-700'
                      : 'border-gray-200 text-gray-400 hover:border-gray-300'
                  }`}
                >
                  {pos.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="text-[10px] text-gray-300">そのまま合成されます（AI加工なし）</p>
      </div>

    </div>
  );
}
