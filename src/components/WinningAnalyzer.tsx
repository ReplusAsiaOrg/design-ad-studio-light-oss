'use client';

import { useRef, useState } from 'react';
import { ENGINE_OPTIONS } from '@/lib/engine-options';
import { BACKGROUND_OPTIONS, TASTE_CATALOG, THEME_OPTIONS } from '@/lib/winning-tastes';
import MetaWinnerPicker from '@/components/MetaWinnerPicker';
import { PolicyWarningBadge } from '@/components/AdPolicyWarnings';
import { useWinningAnalyzer } from '@/hooks/useWinningAnalyzer';
import type { AspectRatio, BannerFormData, WinningConcept } from '@/lib/types';

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

/** 見た目替え枠で実際に生成へ渡る「元CRのコピー」（読み取り専用表示用） */
type LockedCopy = Pick<WinningConcept, 'mainText' | 'subText' | 'extraTexts'>;

/** 見た目替え枠の画風/背景/テーマプルダウン＋人物差し替えチェックの表示情報 */
interface VariationSelect {
  value: string;
  options: { key: string; label: string }[];
  onChange: (key: string) => void;
  /** 編集系（テイスト/背景）のみ。テーマ替えは作り直しのため常に別人＝チェック不要 */
  swapPersons?: boolean;
  onToggleSwapPersons?: () => void;
}

export default function WinningAnalyzer({ onEditInCreator }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const destFileInputRef = useRef<HTMLInputElement>(null);
  const {
    imageBase64, setImageBase64,
    aspectRatio, setAspectRatio,
    engine, setEngine,
    studioMode, setStudioMode,
    destinationAccountId, selectDestinationAccount, destinationOptions,
    destinationProductImage, setDestinationProductImage,
    destinationBrief, setDestinationBrief,
    phase,
    analysis,
    concepts,
    error,
    analyze,
    generateConcept,
    generateAll,
    updateConceptText,
    updateVisualVariation,
    toggleVisualSwapPersons,
    reset,
    conceptToFormData,
  } = useWinningAnalyzer();

  const isCross = studioMode === 'cross-project';

  const isProcessing = phase === 'analyzing';
  const isAnyGenerating = concepts.some(c => c.isGenerating);
  const hasUngenerated = concepts.some(c => !c.imageBase64 && !c.isGenerating);

  /** data URL を受け取り、縦横比を自動判定して入力画像にセットする（ファイル/Meta取込 共通）。 */
  const applyDataUrl = (dataUrl: string) => {
    const img = new Image();
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
    reader.onload = () => applyDataUrl(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    loadFile(file);
    e.target.value = '';
  };

  /** 流用先の商材画像（cross-project・任意）の読み込み。アスペクト比は変更しない。 */
  const loadDestFile = (file: File) => {
    if (!file.type.match(/^image\/(png|jpeg|webp)$/)) {
      alert('PNG、JPEG、WebP形式の画像を選択してください');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert('10MB以下の画像を選択してください');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setDestinationProductImage(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleDestSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    loadDestFile(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
  };

  const stepLabel = (n: number, current: 1 | 2 | 3 | 4) =>
    n < current ? 'done' : n === current ? 'active' : 'todo';

  const currentStep: 1 | 2 | 3 | 4 =
    phase === 'input' ? 1
    : phase === 'analyzing' ? 2
    : phase === 'concepts' ? 3
    : 4;

  // (A) カードラベル。見た目替え枠は「テイスト替え/背景替え」の angle＋具体ラベルを持つのでそのまま。
  const conceptDisplayLabel = (c: WinningConcept): string => {
    if (isCross) return c.visualVariation ? c.layoutLabel : '勝ち構造を流用'; // cross-project は構造移植
    return c.layoutLabel;
  };

  // (A') 見た目替え枠はコピー据え置き設計（useWinningAnalyzer.variationForConcept）。
  // コピー欄が編集できたまま残ると「この文言で生成される」と誤解するため、
  // 実際に使われる元コピーの読み取り専用表示に切り替える。
  const lockedCopyFor = (c: WinningConcept): LockedCopy | null => {
    if (!c.visualVariation) return null;
    return { mainText: c.mainText, subText: c.subText, extraTexts: c.extraTexts };
  };

  // (A'') 見た目替え枠の画風/背景プルダウン。選び直して「再生成」で反映。
  const variationSelectFor = (c: WinningConcept): VariationSelect | null => {
    if (!c.visualVariation) return null;
    const { axis } = c.visualVariation;
    const options = axis === 'taste' ? TASTE_CATALOG : axis === 'background' ? BACKGROUND_OPTIONS : THEME_OPTIONS;
    return {
      value: c.visualVariation.key,
      options,
      onChange: (key: string) => updateVisualVariation(c.id, key),
      // テーマ替えは作り直し（人物も必然的に新規）なのでチェック不要
      ...(axis !== 'theme'
        ? {
            swapPersons: !!c.visualVariation.swapPersons,
            onToggleSwapPersons: () => toggleVisualSwapPersons(c.id),
          }
        : {}),
    };
  };

  // (C) cross-project 用：流用先の入力（アカウント・商材画像・ブリーフ）
  const destinationPanel = (
    <div className="space-y-3 p-3 bg-violet-50/60 rounded-lg border border-violet-200">
      <p className="text-[11px] font-bold text-violet-700">流用先（作りたい新CR側）</p>

      {/* アカウント選択 */}
      <div>
        <label className="block text-[10px] font-medium text-gray-500 mb-1">流用先プロジェクト</label>
        <select
          value={destinationAccountId ?? ''}
          onChange={e => selectDestinationAccount(e.target.value || undefined)}
          disabled={phase !== 'input'}
          className="w-full py-2 px-2 rounded-lg text-xs border border-gray-200 bg-white text-gray-700 disabled:opacity-50"
        >
          <option value="">（選択なし）</option>
          {destinationOptions.map(a => (
            <option key={a.accountId} value={a.accountId}>{a.name}</option>
          ))}
        </select>
      </div>

      {/* 流用先の商材画像（任意） */}
      <div>
        <label className="block text-[10px] font-medium text-gray-500 mb-1">
          流用先の商材画像 <span className="text-gray-300 font-normal">(任意)</span>
        </label>
        <input
          ref={destFileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={handleDestSelect}
          className="hidden"
        />
        {destinationProductImage ? (
          <div className="relative">
            <img
              src={destinationProductImage}
              alt="流用先商材"
              className="w-full rounded-lg border border-gray-200 object-contain max-h-40"
            />
            <button
              onClick={() => setDestinationProductImage(null)}
              disabled={phase !== 'input'}
              className="absolute top-1 right-1 w-5 h-5 bg-black/60 text-white rounded-full flex items-center justify-center text-xs hover:bg-black/80 disabled:opacity-30"
            >
              &times;
            </button>
          </div>
        ) : (
          <button
            onClick={() => destFileInputRef.current?.click()}
            disabled={phase !== 'input'}
            className="w-full py-4 border-2 border-dashed border-gray-200 rounded-lg text-[11px] text-gray-400 hover:border-violet-300 hover:text-violet-500 transition-colors disabled:opacity-50"
          >
            ＋ 商材写真をアップ（なければ構造だけで生成）
          </button>
        )}
      </div>

      {/* ブリーフ */}
      <div>
        <label className="block text-[10px] font-medium text-gray-500 mb-1">流用先のブランド説明（コピー生成の手がかり）</label>
        <textarea
          value={destinationBrief}
          onChange={e => setDestinationBrief(e.target.value)}
          disabled={phase !== 'input'}
          rows={3}
          placeholder="例: 女性向け食・健康ブランド。温かみと季節感。ターゲットは30〜50代女性…"
          className="w-full py-2 px-2 rounded-lg text-[11px] border border-gray-200 bg-white text-gray-700 leading-snug resize-none disabled:opacity-50"
        />
      </div>

      <p className="text-[10px] text-violet-500 leading-snug">
        ※ 流用元の勝ちCR画像は<strong>分析だけ</strong>に使い、生成の土台にはしません（他案件の実物盗用を防止）。流用先商材はAIが再構築するため細部が変わる場合があります。実物厳守なら「同プロジェクト改善」を選んでください。
      </p>
    </div>
  );

  return (
    <div className="flex gap-6 flex-col lg:flex-row">
      {/* Left Panel */}
      <div className="lg:w-[400px] shrink-0">
        <div className="space-y-5 p-5 bg-white rounded-xl border border-gray-200">
          <div>
            <h2 className="text-lg font-bold text-gray-900">勝ち分析再現</h2>
            <p className="text-xs text-gray-400 mt-1 leading-relaxed">
              効果の高い広告クリエイティブをアップすると、AIが「効いている要素」を3観点で分析。
              勝ちフォーマットのまま、コピー差替3案＋テーマ替え3案（世界観ごと描き直し）の計6案を生成し、画像化まで一気通貫で実行します。
            </p>
          </div>

          {/* モード切替: 同プロジェクト改善 / 別プロジェクト流用 */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">モード</label>
            <div className="grid grid-cols-2 gap-1.5">
              {([
                { value: 'same-project', label: '同プロジェクト改善', sub: '実物そのまま・1軸だけ振る' },
                { value: 'cross-project', label: '別プロジェクト流用', sub: '勝ち構造だけ他案件へ' },
              ] as const).map(m => (
                <button
                  key={m.value}
                  onClick={() => setStudioMode(m.value)}
                  disabled={phase !== 'input'}
                  className={`py-2 px-1.5 rounded-lg text-center transition-all border ${
                    studioMode === m.value
                      ? (m.value === 'cross-project' ? 'bg-violet-50 border-violet-400 text-violet-700' : 'bg-amber-50 border-amber-400 text-amber-700')
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  } disabled:opacity-50`}
                >
                  <div className="text-[11px] font-bold">{m.label}</div>
                  <div className="text-[9px] text-gray-400 leading-tight mt-0.5">{m.sub}</div>
                </button>
              ))}
            </div>
          </div>

          {/* cross-project の流用先入力 */}
          {isCross && destinationPanel}

          {/* Steps */}
          <div className="grid grid-cols-4 gap-1.5 text-[10px]">
            {([
              { n: 1, label: '画像アップ' },
              { n: 2, label: '勝ち分析' },
              { n: 3, label: '6案提示' },
              { n: 4, label: '画像生成' },
            ] as const).map(s => {
              const state = stepLabel(s.n, currentStep);
              return (
                <div
                  key={s.n}
                  className={`text-center py-1.5 rounded-md font-medium transition-colors ${
                    state === 'active' ? 'bg-amber-500 text-white'
                    : state === 'done' ? 'bg-amber-100 text-amber-700'
                    : 'bg-gray-100 text-gray-400'
                  }`}
                >
                  Step{s.n}
                  <div className="text-[9px] font-normal">{s.label}</div>
                </div>
              );
            })}
          </div>

          {/* Meta実データの勝ちCRから取り込む */}
          {phase === 'input' && (
            <MetaWinnerPicker onPick={applyDataUrl} disabled={isProcessing || isAnyGenerating} />
          )}

          {/* Image Upload */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              {isCross ? '流用元の勝ちCR画像（分析のみに使用）' : '勝ちCR画像'} <span className="text-red-400">*</span>
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
                  alt="勝ちCR画像"
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
                    ? 'border-amber-400 bg-amber-50 text-amber-600'
                    : 'border-gray-200 text-gray-400 hover:border-amber-300 hover:text-amber-500'
                }`}
              >
                <div className="text-2xl mb-1">+</div>
                <div>{dragOver ? 'ドロップしてアップロード' : '勝ちCR画像をドラッグ or クリックして選択'}</div>
                <div className="text-[10px] text-gray-300 mt-1">PNG / JPEG / WebP（10MBまで）</div>
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
                  disabled={phase !== 'input' && phase !== 'concepts'}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
                    aspectRatio === ar.value
                      ? 'bg-amber-500 text-white'
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
                  disabled={isProcessing || isAnyGenerating}
                  className={`py-2 rounded-lg text-center transition-all border ${
                    engine === eng.value
                      ? 'bg-amber-50 border-amber-400 text-amber-700'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  } disabled:opacity-50`}
                >
                  <div className="text-xs font-bold">{eng.label}</div>
                  <div className="text-[10px] text-gray-400">{eng.sub}</div>
                </button>
              ))}
            </div>
          </div>

          {/* 直系バリエーション軸セレクタは Tier A セクション直下へ移動（影響範囲を明示） */}

          {/* Action */}
          {phase === 'input' && (
            <button
              onClick={analyze}
              disabled={!imageBase64}
              className="w-full py-3 rounded-xl font-bold text-white text-base transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-amber-500 hover:bg-amber-400 active:scale-[0.98]"
            >
              勝ちパターンを分析
            </button>
          )}

          {phase === 'concepts' && hasUngenerated && (
            <button
              onClick={generateAll}
              disabled={isAnyGenerating}
              className="w-full py-3 rounded-xl font-bold text-white text-base transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-amber-500 hover:bg-amber-400 active:scale-[0.98]"
            >
              6パターンすべて生成
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
              <p className="text-4xl mb-3">🏆</p>
              <p className="text-sm">勝ちCR画像をアップして「勝ちパターンを分析」を押すと</p>
              <p className="text-sm">3観点で「効いている要素」を言語化し、コピー差替3案＋テーマ替え3案の計6案を作成します</p>
            </div>
          </div>
        )}

        {phase === 'analyzing' && (
          <div className="bg-white rounded-xl border border-gray-200 p-12 flex items-center justify-center min-h-[400px]">
            <div className="text-center">
              <div className="flex justify-center mb-3"><Spinner size="lg" /></div>
              <p className="text-sm text-gray-500">勝ちパターンを分析中...</p>
              <p className="text-xs text-gray-400 mt-1">ビジュアル / メッセージ / 心理トリガーを読み解いて6案を作成しています</p>
            </div>
          </div>
        )}

        {(phase === 'concepts' || phase === 'generating') && analysis && (
          <>
            {/* Analysis card */}
            <div className="bg-white rounded-xl border border-amber-200 p-5 space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">勝ちパターン分析</span>
                {analysis.contextSummary && (
                  <span className="text-[11px] text-gray-500">{analysis.contextSummary}</span>
                )}
                {analysis.visual.paletteHex.length > 0 && (
                  <div className="flex items-center gap-0.5 ml-auto">
                    {analysis.visual.paletteHex.slice(0, 4).map((c, i) => (
                      <div key={i} className="w-4 h-4 rounded-sm border border-gray-200" style={{ backgroundColor: c }} title={c} />
                    ))}
                  </div>
                )}
              </div>

              {analysis.winningPattern && (
                <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
                  <p className="text-xs font-semibold text-amber-700 mb-1">勝ちパターン総括</p>
                  <p className="text-sm text-gray-700 leading-relaxed">{analysis.winningPattern}</p>
                </div>
              )}

              <div className="grid md:grid-cols-3 gap-3">
                <AnalysisBlock title="ビジュアル要素" color="blue">
                  <KV k="配色・コントラスト" v={analysis.visual.colorContrast} />
                  <KV k="レイアウト構成" v={analysis.visual.layout} />
                  <KV k="フォント印象" v={analysis.visual.typography} />
                  <KV k="視線誘導" v={analysis.visual.eyeFlow} />
                </AnalysisBlock>

                <AnalysisBlock title="メッセージ要素" color="rose">
                  <KV k="訴求軸" v={analysis.message.appealAxis} />
                  <KV k="刺さりどころ" v={analysis.message.hookPoint} />
                  <KV k="CTA" v={analysis.message.cta} />
                </AnalysisBlock>

                <AnalysisBlock title="心理的トリガー" color="violet">
                  {analysis.psychology.triggers.length === 0 ? (
                    <p className="text-[11px] text-gray-400">明確なトリガーは検出されませんでした</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {analysis.psychology.triggers.map((t, i) => (
                        <li key={i}>
                          <span className="inline-block text-[10px] font-bold text-violet-700 bg-violet-100 px-1.5 py-0.5 rounded mr-1">{t.label}</span>
                          <span className="text-[11px] text-gray-600 leading-snug">{t.evidence}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {analysis.psychology.summary && (
                    <p className="text-[11px] text-gray-500 leading-relaxed pt-2 mt-2 border-t border-gray-200">
                      {analysis.psychology.summary}
                    </p>
                  )}
                </AnalysisBlock>
              </div>
            </div>

            {/* Concepts grid — 上段: コピー差替 / 下段: 見た目替え（cross-project は従来の2 Tier） */}
            <ConceptTierSection
              tier="A"
              title={isCross ? '勝ち構造を流用' : 'コピー差替'}
              caption={isCross
                ? '勝ちCRのレイアウト骨格・視線誘導だけを流用先の商材で再構築する'
                : '同じ勝ちフォーマットのままコピーだけ差し替えて、メッセージをABテストする'}
              accentClass="bg-amber-100 text-amber-700"
              concepts={concepts.filter(c => c.tier === 'A')}
              onGenerate={generateConcept}
              onUpdateText={updateConceptText}
              onEditInCreator={onEditInCreator}
              conceptToFormData={conceptToFormData}
              labelFor={conceptDisplayLabel}
              lockedCopyFor={lockedCopyFor}
              variationSelectFor={variationSelectFor}
            />
            <ConceptTierSection
              tier="B"
              title={isCross ? '別レイアウト展開' : '見た目替え'}
              caption={isCross
                ? '勝ちの構造感を保ちつつ別レイアウトで流用先の配信多様性を稼ぐ'
                : '同じコピー・同じ2分割構造のまま世界観テーマを丸ごと替えて、ぱっと見の印象を一新する（CR疲れ対策）'}
              accentClass="bg-blue-100 text-blue-700"
              concepts={concepts.filter(c => c.tier === 'B')}
              onGenerate={generateConcept}
              onUpdateText={updateConceptText}
              onEditInCreator={onEditInCreator}
              conceptToFormData={conceptToFormData}
              labelFor={conceptDisplayLabel}
              lockedCopyFor={lockedCopyFor}
              variationSelectFor={variationSelectFor}
            />
          </>
        )}
      </div>
    </div>
  );
}

function AnalysisBlock({
  title,
  color,
  children,
}: {
  title: string;
  color: 'blue' | 'rose' | 'violet';
  children: React.ReactNode;
}) {
  const palette = {
    blue:   { bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-100' },
    rose:   { bg: 'bg-rose-50',   text: 'text-rose-700',   border: 'border-rose-100' },
    violet: { bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-100' },
  }[color];
  return (
    <div className={`rounded-lg border ${palette.border} p-3`}>
      <div className={`text-[11px] font-bold ${palette.text} ${palette.bg} px-2 py-0.5 rounded inline-block mb-2`}>
        {title}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  if (!v) return null;
  return (
    <div>
      <div className="text-[10px] font-semibold text-gray-400">{k}</div>
      <div className="text-[11px] text-gray-700 leading-snug">{v}</div>
    </div>
  );
}

function ConceptTierSection({
  tier,
  title,
  caption,
  accentClass,
  concepts,
  onGenerate,
  onUpdateText,
  onEditInCreator,
  conceptToFormData,
  labelFor,
  lockedCopyFor,
  variationSelectFor,
}: {
  tier: 'A' | 'B';
  title: string;
  caption: string;
  accentClass: string;
  concepts: WinningConcept[];
  onGenerate: (id: string) => void;
  onUpdateText: (id: string, patch: Partial<Pick<WinningConcept, 'mainText' | 'subText' | 'extraTexts'>>) => void;
  onEditInCreator?: (formData: Partial<BannerFormData>, imageBase64: string) => void;
  conceptToFormData: (c: WinningConcept) => Partial<BannerFormData>;
  /** カードに表示するラベルの上書き（軸に応じた動的ラベル） */
  labelFor?: (c: WinningConcept) => string;
  /** 非nullを返すと、そのカードのコピー欄を「元CRコピーの読み取り専用表示」に切り替える */
  lockedCopyFor?: (c: WinningConcept) => LockedCopy | null;
  /** 非nullを返すと、そのカードのラベルを画風/背景プルダウンに切り替える */
  variationSelectFor?: (c: WinningConcept) => VariationSelect | null;
}) {
  if (concepts.length === 0) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${accentClass}`}>
            Tier {tier}
          </span>
          <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
          <span className="text-[11px] text-gray-400">({concepts.length}案)</span>
        </div>
        <p className="text-[11px] text-gray-400">{caption}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {concepts.map(c => (
          <ConceptCard
            key={c.id}
            concept={c}
            displayLabel={labelFor?.(c)}
            lockedCopy={lockedCopyFor?.(c) ?? null}
            variationSelect={variationSelectFor?.(c) ?? null}
            onGenerate={() => onGenerate(c.id)}
            onUpdateText={onUpdateText}
            onEditInCreator={onEditInCreator ? () => {
              const fd = conceptToFormData(c);
              if (c.imageBase64) onEditInCreator(fd, c.imageBase64);
            } : undefined}
          />
        ))}
      </div>
    </section>
  );
}

function ConceptCard({
  concept,
  onGenerate,
  onUpdateText,
  onEditInCreator,
  displayLabel,
  lockedCopy,
  variationSelect,
}: {
  concept: WinningConcept;
  onGenerate: () => void;
  onUpdateText: (id: string, patch: Partial<Pick<WinningConcept, 'mainText' | 'subText' | 'extraTexts'>>) => void;
  onEditInCreator?: () => void;
  displayLabel?: string;
  /** 非null時: この文言（元CRのコピー）で生成される。コピー欄は読み取り専用表示にする */
  lockedCopy?: LockedCopy | null;
  /** 非null時: ラベルチップの代わりに画風/背景プルダウンを表示（選び直して再生成） */
  variationSelect?: VariationSelect | null;
}) {
  const handleDownload = () => {
    if (!concept.imageBase64) return;
    const link = document.createElement('a');
    link.download = `winning-${concept.tier}-${concept.angle}.png`;
    link.href = concept.imageBase64;
    link.click();
  };

  const tierAccentClass = concept.tier === 'A'
    ? 'bg-amber-100 text-amber-700'
    : 'bg-blue-100 text-blue-700';

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col">
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
            <button
              onClick={onGenerate}
              className="px-4 py-2 rounded-lg text-xs font-medium bg-amber-500 text-white hover:bg-amber-400 transition-colors"
            >
              リトライ
            </button>
          </div>
        ) : concept.imageBase64 ? (
          <img
            src={concept.imageBase64}
            alt={concept.angle}
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-4 gap-3 text-center">
            <p className="text-3xl opacity-30">🎯</p>
            <button
              onClick={onGenerate}
              className="px-4 py-2 rounded-lg text-xs font-bold bg-amber-500 text-white hover:bg-amber-400 transition-colors"
            >
              この案で生成
            </button>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3 border-t border-gray-100 space-y-2 flex-1 flex flex-col">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${tierAccentClass}`}>
            {concept.tier}
          </span>
          <span className="text-[11px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
            {concept.angle}
          </span>
          {variationSelect ? (
            <select
              value={variationSelect.value}
              onChange={e => variationSelect.onChange(e.target.value)}
              disabled={concept.isGenerating}
              title="画風/背景を選び直して「再生成」で反映"
              className="text-[10px] font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 px-1.5 py-0.5 rounded-full border border-transparent hover:border-gray-300 outline-none cursor-pointer transition-colors disabled:opacity-50"
            >
              {variationSelect.options.map(o => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          ) : (displayLabel ?? concept.layoutLabel) && (
            <span className="text-[10px] font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
              {displayLabel ?? concept.layoutLabel}
            </span>
          )}
          <div
            className="w-3.5 h-3.5 rounded-sm border border-gray-200 ml-auto"
            style={{ backgroundColor: concept.mainColor }}
            title={concept.mainColor}
          />
        </div>

        <PolicyWarningBadge warnings={concept.policyWarnings} />

        {lockedCopy ? (
          /* 非copy軸: 生成に実際に使われる「元CRのコピー」を読み取り専用で表示
             （カードの新コピー案は使われず、編集も反映されないため見せない） */
          <>
            <div className="space-y-1">
              <p className="text-sm font-bold text-gray-400 leading-snug">{lockedCopy.mainText}</p>
              {lockedCopy.subText && (
                <p className="text-xs text-gray-400 leading-snug">{lockedCopy.subText}</p>
              )}
            </div>
            {lockedCopy.extraTexts.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {lockedCopy.extraTexts.map((et, i) => (
                  <span key={i} className="text-[10px] text-gray-400 bg-gray-50 rounded-full px-2 py-0.5">
                    {et.text}
                  </span>
                ))}
              </div>
            )}
            <p className="text-[10px] text-amber-600 leading-snug">
              🔒 コピーは元CRのまま変わりません（文言のABは上段「コピー差替」で）
            </p>
            {variationSelect?.onToggleSwapPersons && (
              <label className="flex items-center gap-1.5 text-[10px] text-gray-500 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={!!variationSelect.swapPersons}
                  onChange={variationSelect.onToggleSwapPersons}
                  disabled={concept.isGenerating}
                  className="w-3 h-3 accent-amber-500"
                />
                人物も別人に描き換える（配置・役割・感情は維持）
              </label>
            )}
          </>
        ) : (
          <>
            {/* テキストは生成前に直接編集できる（次の「この案で生成」/再生成に反映） */}
            <div className="space-y-1">
              <input
                value={concept.mainText}
                onChange={e => onUpdateText(concept.id, { mainText: e.target.value })}
                disabled={concept.isGenerating}
                placeholder="メインコピー"
                className="w-full text-sm font-bold text-gray-800 leading-snug bg-transparent rounded px-1 -mx-1 py-0.5 border border-transparent hover:border-gray-200 focus:border-amber-400 focus:bg-white outline-none transition-colors disabled:opacity-60"
              />
              <input
                value={concept.subText}
                onChange={e => onUpdateText(concept.id, { subText: e.target.value })}
                disabled={concept.isGenerating}
                placeholder="サブコピー（任意）"
                className="w-full text-xs text-gray-500 leading-snug bg-transparent rounded px-1 -mx-1 py-0.5 border border-transparent hover:border-gray-200 focus:border-amber-400 focus:bg-white outline-none transition-colors disabled:opacity-60"
              />
            </div>

            {concept.extraTexts.length > 0 && (
              <div className="space-y-1">
                {concept.extraTexts.map((et, i) => (
                  <div key={i} className="flex items-center gap-1">
                    <input
                      value={et.text}
                      onChange={e => onUpdateText(concept.id, {
                        extraTexts: concept.extraTexts.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)),
                      })}
                      disabled={concept.isGenerating}
                      placeholder="補助テキスト / CTA"
                      className="flex-1 min-w-0 text-[10px] text-gray-600 bg-gray-50 rounded-full px-2 py-0.5 border border-transparent hover:border-gray-200 focus:border-amber-400 focus:bg-white outline-none transition-colors disabled:opacity-60"
                    />
                    {et.decoration && et.decoration !== 'none' && (
                      <span className="text-[9px] text-gray-400 shrink-0">[{et.decoration}]</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {concept.inheritedFrom && (
          <p className="text-[10px] text-gray-400 leading-relaxed pt-1.5 mt-auto border-t border-gray-100">
            <span className="font-semibold text-gray-500">踏襲: </span>{concept.inheritedFrom}
          </p>
        )}

        {concept.imageBase64 && !concept.isGenerating && (
          <div className="space-y-1.5 pt-1.5">
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
            <button
              onClick={onGenerate}
              className="w-full py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors flex items-center justify-center gap-1"
              title="同じ構成案で再生成"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              再生成
            </button>
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
