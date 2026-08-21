'use client';

import { useEffect, useRef, useState } from 'react';
import type { AspectRatio, BannerFormData, FontStyle } from '@/lib/types';
import { runGenerationQueue } from '@/lib/generation-queue';
import { downscaleImageDataUrl } from '@/lib/image-resize';
import { playChime, isChimeEnabled, setChimeEnabled } from '@/lib/chime';
import { checkAdPolicy } from '@/lib/ad-policy';
import { PolicyWarningBadge } from '@/components/AdPolicyWarnings';

interface Props {
  /** 作成タブの現在の設定。共通設定の初期値、参照画像/URL/ロゴの継承元 */
  baseFormData: BannerFormData;
  /** 結果を作成タブ（単発）に持っていって微調整する */
  onEditInCreator: (formData: Partial<BannerFormData>, imageDataUrl: string) => void;
}

type RowStatus = 'idle' | 'queued' | 'running' | 'done' | 'error';

interface ExtraText {
  id: string;
  text: string;
}

interface Row {
  id: string;
  mainText: string;
  subText: string;
  cta: string;
  extraTexts: ExtraText[];
  /** このバナーだけのデザイン指示（空なら共通指示のみ） */
  designNote: string;
  /** このバナーだけの参照画像（空なら単発モードの参照を引き継ぐ） */
  referenceImageBase64?: string;
  referenceImageMode?: 'style' | 'asset';
  status: RowStatus;
  imageDataUrl?: string;
  error?: string;
}

const ASPECT_RATIOS: { value: AspectRatio; label: string }[] = [
  { value: '1:1', label: '1:1' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
];

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b', '#ffffff', '#000000', '#6b7280',
];

const FONTS: { value: FontStyle; label: string }[] = [
  { value: 'auto', label: '自動' },
  { value: 'gothic', label: 'ゴシック' },
  { value: 'mincho', label: '明朝' },
  { value: 'rounded-gothic', label: '丸ゴシック' },
  { value: 'light-mincho', label: '細明朝' },
  { value: 'handwritten', label: '手書き風' },
];

const newId = () => Math.random().toString(36).substring(2, 9);
const emptyRow = (): Row => ({
  id: newId(),
  mainText: '',
  subText: '',
  cta: '',
  extraTexts: [],
  designNote: '',
  status: 'idle',
});

export default function BatchGenerator({ baseFormData, onEditInCreator }: Props) {
  const [rows, setRows] = useState<Row[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(baseFormData.aspectRatio);
  const [mainColor, setMainColor] = useState<string>(baseFormData.mainColor);
  const [fontStyle, setFontStyle] = useState<FontStyle>(baseFormData.fontStyle);
  // なし(明示除外) / あり(含める) / AIおまかせ(指示なし=AI判断)
  const [personMode, setPersonMode] = useState<'none' | 'yes' | 'auto'>(baseFormData.hasPersons ? 'yes' : 'auto');
  const [commonPrompt, setCommonPrompt] = useState<string>(baseFormData.customPrompt);
  // 全バナー共通の参照画像（単発モードの設定を初期値に）。既定モードは「デザインの参考(style)」
  const [commonRefImage, setCommonRefImage] = useState<string | undefined>(baseFormData.referenceImageBase64);
  const [commonRefMode, setCommonRefMode] = useState<'style' | 'asset'>(baseFormData.referenceImageMode === 'asset' ? 'asset' : 'style');
  const [isRunning, setIsRunning] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  // 初回マウント時に localStorage の設定を反映（SSRとのハイドレーション不一致を避けるため mount 後に読む）
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setSoundOn(isChimeEnabled()); }, []);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const updateRow = (id: string, patch: Partial<Row>) =>
    setRows(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)));

  /** ファイルを data URL 化 → 自動縮小して返す（スクショなど重い画像対策） */
  const readAndDownscale = (file: File | undefined): Promise<string | null> => {
    if (!file) return Promise.resolve(null);
    if (!file.type.match(/^image\/(png|jpeg|webp)$/)) {
      alert('PNG、JPEG、WebP形式の画像を選択してください');
      return Promise.resolve(null);
    }
    if (file.size > 20 * 1024 * 1024) {
      alert('20MB以下の画像を選択してください');
      return Promise.resolve(null);
    }
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = async () => {
        const downscaled = await downscaleImageDataUrl(reader.result as string);
        resolve(downscaled);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  };

  const loadRefImage = async (id: string, file: File | undefined) => {
    const dataUrl = await readAndDownscale(file);
    // 新規アップした参照画像は既定で「デザインの参考(style)」。そのまま使いたい時は切替可能
    if (dataUrl) updateRow(id, { referenceImageBase64: dataUrl, referenceImageMode: 'style' });
  };

  const loadCommonRefImage = async (file: File | undefined) => {
    const dataUrl = await readAndDownscale(file);
    if (dataUrl) { setCommonRefImage(dataUrl); setCommonRefMode('style'); }
  };

  const filledCount = rows.filter(r => r.mainText.trim()).length;

  const buildFormData = (row: Row): BannerFormData => {
    // 共通指示 + この行のデザイン指示を結合（行指示があれば「同トーン」から外れて別デザインになる）
    const customPrompt = [commonPrompt.trim(), row.designNote.trim()].filter(Boolean).join('\n\n');
    const extraTexts: BannerFormData['extraTexts'] = [];
    if (row.cta.trim()) extraTexts.push({ id: `cta-${row.id}`, text: row.cta.trim(), decoration: 'button' });
    row.extraTexts.forEach(et => {
      if (et.text.trim()) extraTexts.push({ id: et.id, text: et.text.trim(), decoration: 'auto' });
    });

    // 参照画像の優先順位: 行ごとの画像 > 共通の参照画像
    const referenceImageBase64 = row.referenceImageBase64 ?? commonRefImage;
    const referenceImageMode = row.referenceImageBase64
      ? (row.referenceImageMode ?? 'style')
      : commonRefImage
        ? commonRefMode
        : undefined;
    // 画像を使う場合は参照URLは使わない（画像が優先）
    const referenceUrl = referenceImageBase64 ? undefined : baseFormData.referenceUrl;

    return {
      engine: 'gpt-image-2',
      mainText: row.mainText,
      subText: row.subText,
      extraTexts,
      mainColor,
      aspectRatio,
      fontStyle,
      hasPersons: personMode === 'yes',
      personMode,
      customPrompt,
      referenceImageBase64,
      referenceImageMode,
      referenceUrl,
      logoImageBase64: baseFormData.logoImageBase64,
      logoPosition: baseFormData.logoPosition,
    };
  };

  const generate = async () => {
    const targets = rows.filter(r => r.mainText.trim());
    if (targets.length === 0) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setIsRunning(true);
    setProgress({ done: 0, total: targets.length });

    const targetIds = new Set(targets.map(t => t.id));
    setRows(prev => prev.map(r =>
      targetIds.has(r.id) ? { ...r, status: 'queued', imageDataUrl: undefined, error: undefined } : r
    ));

    await runGenerationQueue(
      targets.map(t => ({ id: t.id, formData: buildFormData(t) })),
      {
        onStart: id => updateRow(id, { status: 'running' }),
        onSuccess: (id, dataUrl) => updateRow(id, { status: 'done', imageDataUrl: dataUrl }),
        onError: (id, message) => updateRow(id, { status: 'error', error: message }),
        onProgress: (done, total) => setProgress({ done, total }),
      },
      { concurrency: 1, signal: controller.signal },
    );

    // 全部終わったら「ピコン！」（中止時は鳴らさない）
    if (!controller.signal.aborted && soundOn) playChime();

    setIsRunning(false);
    abortRef.current = null;
  };

  const stop = () => {
    abortRef.current?.abort();
    setIsRunning(false);
    setRows(prev => prev.map(r =>
      r.status === 'queued' || r.status === 'running' ? { ...r, status: 'idle' } : r
    ));
  };

  const download = (row: Row, index: number) => {
    if (!row.imageDataUrl) return;
    const a = document.createElement('a');
    a.href = row.imageDataUrl;
    a.download = `banner-${index + 1}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const aspectClass: Record<AspectRatio, string> = {
    '1:1': 'aspect-square',
    '16:9': 'aspect-video',
    '9:16': 'aspect-[9/16]',
    '4:3': 'aspect-[4/3]',
    '3:4': 'aspect-[3/4]',
    'custom': 'aspect-square',
  };

  return (
    <div className="space-y-5">
      {/* 共通設定 */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">共通設定（全バナーに適用）</h3>
          <span className="text-[11px] text-gray-400">エンジン: GPT Image 2 固定</span>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {/* 比率 */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">サイズ</label>
            <div className="flex flex-wrap gap-2">
              {ASPECT_RATIOS.map(ar => (
                <button
                  key={ar.value}
                  onClick={() => setAspectRatio(ar.value)}
                  className={`px-3 py-1.5 rounded-lg text-sm border transition-all ${
                    aspectRatio === ar.value
                      ? 'bg-blue-50 border-blue-400 text-blue-700'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  {ar.label}
                </button>
              ))}
            </div>
          </div>

          {/* フォント */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">フォント</label>
            <div className="flex flex-wrap gap-2">
              {FONTS.map(f => (
                <button
                  key={f.value}
                  onClick={() => setFontStyle(f.value)}
                  className={`px-3 py-1.5 rounded-lg text-sm border transition-all ${
                    fontStyle === f.value
                      ? 'bg-blue-50 border-blue-400 text-blue-700'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 配色 */}
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">メインカラー</label>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setMainColor('')}
              className={`w-8 h-8 rounded-full border-2 transition-all flex items-center justify-center text-[9px] font-bold ${
                mainColor === ''
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
                onClick={() => setMainColor(color)}
                className={`w-8 h-8 rounded-full border-2 transition-all ${
                  mainColor === color ? 'border-blue-500 scale-110 ring-2 ring-blue-100' : 'border-gray-200 hover:scale-105'
                } ${color === '#ffffff' ? 'border-gray-300' : ''}`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>

        {/* 人物 */}
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">人物</label>
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
            {([
              { value: 'none' as const, label: 'なし' },
              { value: 'yes' as const, label: 'あり' },
              { value: 'auto' as const, label: 'AIおまかせ' },
            ]).map((opt, i) => (
              <button
                key={opt.value}
                onClick={() => setPersonMode(opt.value)}
                className={`px-4 py-1.5 text-sm transition-all ${i > 0 ? 'border-l border-gray-200' : ''} ${
                  personMode === opt.value ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:bg-gray-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* 共通デザイン指示 */}
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">
            共通デザイン指示 <span className="text-gray-300">(任意・全バナー共通)</span>
          </label>
          <textarea
            value={commonPrompt}
            onChange={e => setCommonPrompt(e.target.value)}
            rows={3}
            placeholder="全バナーに共通で効かせたいテイストや指示..."
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y placeholder:text-gray-300"
          />
        </div>

        {/* 共通の参照画像 */}
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">
            共通の参照画像 <span className="text-gray-300">(任意・全バナー共通で参考にする)</span>
          </label>
          {commonRefImage ? (
            <div className="space-y-2">
              <div className="relative inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={commonRefImage} alt="共通参照画像" className="rounded-lg border border-gray-200 object-cover max-h-32" />
                <button
                  onClick={() => { setCommonRefImage(undefined); }}
                  className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/60 text-white rounded-full flex items-center justify-center text-sm hover:bg-black/80 transition-colors"
                >
                  &times;
                </button>
              </div>
              <div className="flex gap-2 max-w-xs">
                <button
                  type="button"
                  onClick={() => setCommonRefMode('style')}
                  className={`flex-1 py-1.5 px-2 rounded-lg text-center transition-all border text-[11px] ${
                    commonRefMode === 'style' ? 'bg-blue-50 border-blue-400 text-blue-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  <div className="font-bold">デザインの参考</div>
                  <div className="text-[9px] text-gray-400">テイストを寄せる</div>
                </button>
                <button
                  type="button"
                  onClick={() => setCommonRefMode('asset')}
                  className={`flex-1 py-1.5 px-2 rounded-lg text-center transition-all border text-[11px] ${
                    commonRefMode === 'asset' ? 'bg-blue-50 border-blue-400 text-blue-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  <div className="font-bold">そのまま使う</div>
                  <div className="text-[9px] text-gray-400">人物・商品を含める</div>
                </button>
              </div>
            </div>
          ) : (
            <label className="block w-full max-w-xs py-2.5 border-2 border-dashed border-gray-200 rounded-lg text-gray-400 text-xs text-center cursor-pointer hover:border-gray-300 hover:text-gray-500 transition-colors">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={e => { loadCommonRefImage(e.target.files?.[0]); e.target.value = ''; }}
              />
              + 参照画像を選択（全バナー共通）
            </label>
          )}
          <p className="mt-1 text-[10px] text-gray-300">各バナー個別の参照画像があれば、そちらが優先されます。アップロード時は自動で軽く縮小します。</p>
        </div>

        {baseFormData.logoImageBase64 && (
          <p className="text-[10px] text-gray-400">単発モードで設定したロゴも全バナーに引き継がれます。</p>
        )}
      </div>

      {/* バナーカード一覧 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-700">バナーごとのテキスト（1枚＝1カード）</h3>
          <span className="text-[11px] text-gray-400">{filledCount} 枚を生成予定</span>
        </div>

        <div className="grid lg:grid-cols-2 gap-3">
          {rows.map((row, i) => (
            <div key={row.id} className="bg-white rounded-xl border border-gray-200 p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-500">バナー {i + 1}</span>
                <button
                  onClick={() => setRows(prev => (prev.length > 1 ? prev.filter(r => r.id !== row.id) : prev))}
                  disabled={rows.length <= 1 || isRunning}
                  className="text-gray-300 hover:text-red-500 text-lg transition-colors disabled:opacity-30 disabled:hover:text-gray-300"
                  title="このバナーを削除"
                >
                  &times;
                </button>
              </div>

              <div>
                <label className="block text-[10px] text-gray-400 mb-1">メインテキスト<span className="ml-1 text-gray-300">改行で行分け可</span></label>
                <textarea
                  value={row.mainText}
                  onChange={e => updateRow(row.id, { mainText: e.target.value })}
                  rows={2}
                  placeholder="夏期講習募集"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y placeholder:text-gray-300"
                />
                {/* 広告審査NG表現の簡易警告（Issue #31。行のテキスト全体をチェック） */}
                <PolicyWarningBadge
                  warnings={checkAdPolicy(
                    [row.mainText, row.subText, row.cta, ...row.extraTexts.map(et => et.text)].filter(Boolean).join('\n'),
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-gray-400 mb-1">サブテキスト</label>
                  <input
                    type="text"
                    value={row.subText}
                    onChange={e => updateRow(row.id, { subText: e.target.value })}
                    placeholder="先着15名様"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-300"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-400 mb-1">CTA（ボタン）</label>
                  <input
                    type="text"
                    value={row.cta}
                    onChange={e => updateRow(row.id, { cta: e.target.value })}
                    placeholder="今すぐ申込"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-300"
                  />
                </div>
              </div>

              {/* その他テキスト */}
              {row.extraTexts.map((et, j) => (
                <div key={et.id}>
                  <label className="block text-[10px] text-gray-400 mb-1">その他テキスト {j + 1}</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={et.text}
                      onChange={e => updateRow(row.id, {
                        extraTexts: row.extraTexts.map(x => (x.id === et.id ? { ...x, text: e.target.value } : x)),
                      })}
                      placeholder="価格・特典・日付など"
                      className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-300"
                    />
                    <button
                      onClick={() => updateRow(row.id, { extraTexts: row.extraTexts.filter(x => x.id !== et.id) })}
                      className="text-gray-300 hover:text-red-500 px-1 text-lg transition-colors"
                    >
                      &times;
                    </button>
                  </div>
                </div>
              ))}
              <button
                onClick={() => updateRow(row.id, { extraTexts: [...row.extraTexts, { id: newId(), text: '' }] })}
                className="w-full py-1.5 border border-dashed border-gray-200 rounded-lg text-gray-400 text-xs hover:border-gray-300 hover:text-gray-500 transition-colors"
              >
                + テキストを追加
              </button>

              {/* このバナーのデザイン指示 */}
              <div>
                <label className="block text-[10px] text-gray-400 mb-1">
                  このバナーのデザイン指示 <span className="text-gray-300">(任意・別デザインにしたい時)</span>
                </label>
                <textarea
                  value={row.designNote}
                  onChange={e => updateRow(row.id, { designNote: e.target.value })}
                  rows={2}
                  placeholder="例: ポップで明るく / 高級感のある黒基調 / 写真を全面に"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y placeholder:text-gray-300"
                />
              </div>

              {/* このバナーの参照画像 */}
              <div>
                <label className="block text-[10px] text-gray-400 mb-1">
                  このバナーの参照画像 <span className="text-gray-300">(任意・人物/商品/テイスト)</span>
                </label>
                {row.referenceImageBase64 ? (
                  <div className="space-y-2">
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={row.referenceImageBase64}
                        alt="参照画像"
                        className="w-full rounded-lg border border-gray-200 object-cover max-h-28"
                      />
                      <button
                        onClick={() => updateRow(row.id, { referenceImageBase64: undefined, referenceImageMode: undefined })}
                        className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/60 text-white rounded-full flex items-center justify-center text-sm hover:bg-black/80 transition-colors"
                      >
                        &times;
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => updateRow(row.id, { referenceImageMode: 'style' })}
                        className={`py-1.5 px-2 rounded-lg text-center transition-all border text-[11px] ${
                          (row.referenceImageMode ?? 'style') === 'style'
                            ? 'bg-blue-50 border-blue-400 text-blue-700'
                            : 'border-gray-200 text-gray-500 hover:border-gray-300'
                        }`}
                      >
                        <div className="font-bold">デザインの参考</div>
                        <div className="text-[9px] text-gray-400">テイストを寄せる</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => updateRow(row.id, { referenceImageMode: 'asset' })}
                        className={`py-1.5 px-2 rounded-lg text-center transition-all border text-[11px] ${
                          (row.referenceImageMode ?? 'style') === 'asset'
                            ? 'bg-blue-50 border-blue-400 text-blue-700'
                            : 'border-gray-200 text-gray-500 hover:border-gray-300'
                        }`}
                      >
                        <div className="font-bold">そのまま使う</div>
                        <div className="text-[9px] text-gray-400">人物・商品を含める</div>
                      </button>
                    </div>
                  </div>
                ) : (
                  <label className="block w-full py-2.5 border-2 border-dashed border-gray-200 rounded-lg text-gray-400 text-xs text-center cursor-pointer hover:border-gray-300 hover:text-gray-500 transition-colors">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={e => { loadRefImage(row.id, e.target.files?.[0]); e.target.value = ''; }}
                    />
                    + 参照画像を選択
                  </label>
                )}
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={() => setRows(prev => [...prev, emptyRow()])}
          disabled={isRunning}
          className="mt-3 w-full py-2.5 border-2 border-dashed border-gray-200 rounded-lg text-gray-400 text-sm hover:border-gray-300 hover:text-gray-500 transition-colors disabled:opacity-40"
        >
          + バナーを追加
        </button>
      </div>

      {/* 生成ボタン */}
      <div className="flex items-center gap-3">
        {/* 完了音 ON/OFF */}
        <button
          onClick={() => setSoundOn(v => { const next = !v; setChimeEnabled(next); return next; })}
          title={soundOn ? '完了音: ON（全部終わったら鳴る・全ページ共通）' : '完了音: OFF'}
          className={`shrink-0 w-12 py-3.5 rounded-xl border text-lg transition-all ${
            soundOn ? 'border-blue-200 bg-blue-50 text-blue-600' : 'border-gray-200 text-gray-300 hover:text-gray-400'
          }`}
        >
          {soundOn ? '🔔' : '🔕'}
        </button>
        {!isRunning ? (
          <button
            onClick={generate}
            disabled={filledCount === 0}
            className="flex-1 py-3.5 rounded-xl font-bold text-white text-base transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-blue-600 hover:bg-blue-500 active:scale-[0.98]"
          >
            {filledCount > 0 ? `${filledCount}件をまとめて生成` : 'メインテキストを入力してください'}
          </button>
        ) : (
          <>
            <div className="flex-1 py-3.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-700 text-sm font-medium flex items-center justify-center gap-2">
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              {progress ? `生成中… ${progress.done}/${progress.total} 完了（1枚ずつ生成）` : '生成中…'}
            </div>
            <button
              onClick={stop}
              className="px-5 py-3.5 rounded-xl font-medium text-sm border border-gray-200 text-gray-600 hover:bg-gray-50 transition-all"
            >
              中止
            </button>
          </>
        )}
      </div>

      {/* ギャラリー */}
      {rows.some(r => r.status !== 'idle') && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {rows.filter(r => r.status !== 'idle').map((row, i) => (
            <div key={row.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className={`relative bg-gray-50 ${aspectClass[aspectRatio]} flex items-center justify-center`}>
                {row.status === 'done' && row.imageDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={row.imageDataUrl} alt={row.mainText} className="w-full h-full object-cover" />
                ) : row.status === 'error' ? (
                  <div className="p-3 text-center">
                    <p className="text-xs text-red-500 line-clamp-3">{row.error}</p>
                  </div>
                ) : row.status === 'running' ? (
                  <div className="flex flex-col items-center gap-2 text-blue-500">
                    <svg className="animate-spin w-6 h-6 text-blue-500" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                    <span className="text-[11px] font-medium">生成中…</span>
                  </div>
                ) : (
                  // 順番待ち: 回さず静的に。実際に動いているのは「生成中…」の1枚だけだと分かるように
                  <div className="flex flex-col items-center gap-2 text-gray-300">
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className="text-[11px]">順番待ち</span>
                  </div>
                )}
              </div>
              <div className="p-2.5">
                <p className="text-xs font-medium text-gray-700 truncate" title={row.mainText}>
                  {i + 1}. {row.mainText || '(無題)'}
                </p>
                {row.status === 'done' && row.imageDataUrl && (
                  <div className="mt-2 flex gap-1.5">
                    <button
                      onClick={() => download(row, i)}
                      className="flex-1 py-1.5 rounded-lg text-xs font-medium bg-gray-800 text-white hover:bg-gray-700 transition-colors"
                    >
                      DL
                    </button>
                    <button
                      onClick={() => onEditInCreator(buildFormData(row), row.imageDataUrl!)}
                      className="flex-1 py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                      微調整
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
