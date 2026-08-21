'use client';

import { useRef, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useBannerState } from '@/hooks/useBannerState';
import { useMe } from '@/hooks/useMe';
import BannerForm from '@/components/BannerForm';
import AdPolicyWarnings from '@/components/AdPolicyWarnings';
import DownloadButton from '@/components/DownloadButton';
import PromptGenerator from '@/components/PromptGenerator';
import SourceGenerator from '@/components/SourceGenerator';
import VariationGenerator from '@/components/VariationGenerator';
import WinningAnalyzer from '@/components/WinningAnalyzer';
import AdReport from '@/components/AdReport';
import AccountManager from '@/components/AccountManager';
import HomeCover from '@/components/HomeCover';
import BuildBadge from '@/components/BuildBadge';
import PriorityRanking from '@/components/PriorityRanking';
import WinningSegments from '@/components/WinningSegments';
import BatchGenerator from '@/components/BatchGenerator';
import TemplateGallery from '@/components/TemplateGallery';
import GenerationHistory from '@/components/GenerationHistory';
import type { BannerCanvasHandle } from '@/components/BannerCanvas';
import type { BannerFormData } from '@/lib/types';
import { createFallbackPlan } from '@/lib/layout-planner';
import { generateBanner } from '@/lib/generate-client';

const BannerCanvas = dynamic(() => import('@/components/BannerCanvas'), {
  ssr: false,
  loading: () => (
    <div className="w-full aspect-square bg-gray-50 rounded-xl animate-pulse flex items-center justify-center">
      <p className="text-gray-300">読み込み中...</p>
    </div>
  ),
});

type Tab = 'report' | 'priority' | 'segments' | 'create' | 'prompt' | 'url' | 'variation' | 'winning' | 'template' | 'history' | 'accounts';

const TABS: { value: Tab; label: string; disabled?: boolean }[] = [
  { value: 'report', label: '広告レポート' },
  { value: 'priority', label: '優先順位' },
  { value: 'segments', label: '勝ちセグメント' },
  { value: 'winning', label: '勝ち分析再現' },
  { value: 'create', label: 'バナー作成' },
  { value: 'url', label: '素材から生成' },
  { value: 'variation', label: 'バリエーション作成' },
  { value: 'prompt', label: 'プロンプトジェネレーター' },
  // light版では未提供（グレーアウト表示のみ）。本体版の勝ちテンプレート機能に対応
  { value: 'template', label: '勝ちテンプレート', disabled: true },
  { value: 'history', label: '生成履歴' },
  // アカウント管理はタブではなくヘッダー右上の常設ボタン（タブ列の幅節約）
];

export default function Home() {
  // 表紙（ホーム）と作業画面（スタジオ）の2階層。アクセス直後はホームだけを表示し、
  // Meta取得が走る広告レポートはアカウントカードを選んで初めてマウントする
  const [view, setView] = useState<'home' | 'studio'>('home');
  const [reportOpened, setReportOpened] = useState(false);
  // ホームで選んだアカウント。レポート・優先順位・勝ちセグメントに引き継ぐ
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('report');
  const [createMode, setCreateMode] = useState<'single' | 'batch'>('single');
  // ロール分離（Issue #9）: member はアカウント管理（同期・登録・評価設定）を表示しない
  const me = useMe();
  const isAdmin = me?.isAdmin ?? false;

  const openTab = useCallback((tab: Tab) => {
    if (tab === 'accounts' && !isAdmin) return; // API側も403で二重に防ぐ
    if (tab === 'report') setReportOpened(true);
    setActiveTab(tab);
    setView('studio');
  }, [isAdmin]);

  const openAccount = useCallback((accountId: string) => {
    setSelectedAccount(accountId);
    setReportOpened(true);
    setActiveTab('report');
    setView('studio');
  }, []);
  // 一括生成を一度でも開いたらマウントを維持する（アンマウントすると生成結果・入力が消えるため。
  // 初回オープン時点の単発設定を初期値として引き継ぐため、最初から常時マウントにはしない）
  const [batchOpened, setBatchOpened] = useState(false);
  const [previewPrompt, setPreviewPrompt] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [editInstruction, setEditInstruction] = useState('');
  const canvasRef = useRef<BannerCanvasHandle>(null);
  const {
    formData,
    setFormData,
    updateForm,
    addExtraText,
    removeExtraText,
    backgroundImage,
    setBackgroundImage,
    designPlan,
    setDesignPlan,
    isGenerating,
    isEditing,
    isEyecatchMode,
    setIsEyecatchMode,
    error,
    generate,
    editBanner,
  } = useBannerState();

  // テンプレートからバナー作成タブに遷移
  const handleUseTemplate = useCallback((templateFormData: Partial<BannerFormData>) => {
    setFormData(prev => ({ ...prev, ...templateFormData }));
    setIsEyecatchMode(false);
    setActiveTab('create');
  }, [setFormData, setIsEyecatchMode]);

  // 静的背景テンプレート用: AI生成をスキップして背景とテキストを直接セット
  const handleUseStaticTemplate = useCallback((templateFormData: Partial<BannerFormData>, backgroundImageUrl: string) => {
    const merged: BannerFormData = {
      engine: 'gpt-image-2',
      mainText: '',
      subText: '',
      extraTexts: [],
      mainColor: '',
      aspectRatio: '16:9',
      fontStyle: 'auto',
      hasPersons: false,
      customPrompt: '',
      ...templateFormData,
    };
    setFormData(merged);
    setBackgroundImage(backgroundImageUrl);
    setDesignPlan(createFallbackPlan(merged));
    setIsEyecatchMode(true);
    setActiveTab('create');
  }, [setFormData, setBackgroundImage, setDesignPlan, setIsEyecatchMode]);

  // テンプレートからモーダル内で直接生成
  const handleGenerateFromTemplate = useCallback(async (templateFormData: Partial<BannerFormData>): Promise<string | null> => {
    try {
      const mergedFormData: BannerFormData = {
        engine: 'gpt-image-2',
        mainText: '',
        subText: '',
        extraTexts: [],
        mainColor: '',
        aspectRatio: '1:1',
        fontStyle: 'auto',
        hasPersons: false,
        customPrompt: '',
        ...templateFormData,
      };
      const { imageBase64 } = await generateBanner(mergedFormData, undefined, {});
      return `data:image/png;base64,${imageBase64}`;
    } catch {
      return null;
    }
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-3">
        <div className="max-w-[1400px] mx-auto flex items-center justify-between">
          <button onClick={() => setView('home')} className="text-left group" title="ホームに戻る">
            <h1 className="text-lg font-bold text-gray-900 group-hover:text-blue-600 transition-colors flex items-center gap-2">
              Ad Studio Light
              {me?.demo && (
                <span
                  className="text-[10px] font-semibold tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200"
                  title="DEMO_MODE=1 で起動中。表示中のデータは架空のサンプルで、Meta APIには接続していません"
                >DEMO</span>
              )}
            </h1>
            <p className="text-[11px] text-gray-400">Meta広告レポート＆勝ちCR分析・生成スタジオ</p>
          </button>
          <div className="flex items-center gap-4">
            {view === 'studio' && activeTab === 'create' && createMode === 'single' && (
              <DownloadButton
                canvasRef={canvasRef}
                aspectRatio={formData.aspectRatio}
                customWidth={formData.customWidth}
                customHeight={formData.customHeight}
                disabled={!backgroundImage}
              />
            )}
            {isAdmin && (
              <button
                onClick={() => openTab('accounts')}
                className={`text-xs font-medium transition-colors ${
                  view === 'studio' && activeTab === 'accounts'
                    ? 'text-blue-600'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >⚙ アカウント管理</button>
            )}
            {me?.mode === 'supabase' && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-gray-400 max-w-[180px] truncate" title={me.email ?? undefined}>{me.email}</span>
                <button
                  onClick={async () => {
                    await fetch('/auth/signout', { method: 'POST' }).catch(() => {});
                    window.location.href = '/login';
                  }}
                  className="text-xs font-medium text-gray-500 hover:text-gray-800 transition-colors"
                >ログアウト</button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Tabs（第2階層。ホームでは非表示） */}
      {view === 'studio' && (
        <div className="bg-white border-b border-gray-200">
          <div className="max-w-[1400px] mx-auto px-6">
            <nav className="flex gap-1 items-center overflow-x-auto">
              <button
                onClick={() => setView('home')}
                className="px-3 py-3 text-sm text-gray-400 hover:text-gray-700 transition-colors whitespace-nowrap"
                title="ホームに戻る"
              >⌂ ホーム</button>
              <span className="w-px h-4 bg-gray-200 shrink-0" />
              {TABS.map(tab => (
                <button
                  key={tab.value}
                  onClick={() => { if (!tab.disabled) openTab(tab.value); }}
                  disabled={tab.disabled}
                  title={tab.disabled ? 'light版では利用できません' : undefined}
                  className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    tab.disabled
                      ? 'border-transparent text-gray-300 cursor-not-allowed'
                      : activeTab === tab.value
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-400 hover:text-gray-600'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>
        </div>
      )}

      {/* 表紙（ホーム）。スタジオ側の状態を保つため display:none で切り替える */}
      <div style={{ display: view === 'home' ? undefined : 'none' }}>
        <HomeCover onOpenAccount={openAccount} onOpenTool={(t) => openTab(t as Tab)} isAdmin={isAdmin} />
      </div>

      {/* Main */}
      <main className="max-w-[1400px] mx-auto p-6" style={{ display: view === 'studio' ? undefined : 'none' }}>
        {/* 広告レポートタブ。初めて開いた時にマウントし（＝ホーム表示だけではMeta取得が走らない）、
            以後はタブを離れてもAI分析結果・取得済みレポートが消えないよう display:none で隠す。
            再読み込みしたい時はタブ内の期間ボタン再クリックで明示的に再取得できる */}
        <div style={{ display: activeTab === 'report' ? undefined : 'none' }}>
          {reportOpened && <AdReport initialAccount={selectedAccount} />}
        </div>

        {/* 優先順位タブ（シートのOUT_優先順位相当・名寄せ集計ランキング） */}
        {activeTab === 'priority' && <PriorityRanking initialAccount={selectedAccount} />}

        {/* 勝ちセグメントタブ（性年齢・配置の内訳系★判定＋入稿用名称生成） */}
        {activeTab === 'segments' && <WinningSegments initialAccount={selectedAccount} />}

        {/* アカウント管理タブ（開いた時だけマウント＝登録状況を都度新鮮に。管理者のみ） */}
        {activeTab === 'accounts' && isAdmin && <AccountManager />}

        {/* バナー作成タブ */}
        <div style={{ display: activeTab === 'create' ? undefined : 'none' }}>
          {/* 単発 / 一括 モード切替 */}
          <div className="mb-4 inline-flex rounded-lg border border-gray-200 bg-white p-1">
            {([
              { value: 'single' as const, label: '単発生成' },
              { value: 'batch' as const, label: '一括生成' },
            ]).map(m => (
              <button
                key={m.value}
                onClick={() => {
                  setCreateMode(m.value);
                  if (m.value === 'batch') setBatchOpened(true);
                }}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                  createMode === m.value ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* 一括生成モード: 左フォームを隠して全幅。
              モード切替（微調整ボタン含む）で結果が消えないよう、非表示は display:none で行う */}
          {batchOpened && (
            <div style={{ display: createMode === 'batch' ? undefined : 'none' }}>
              <BatchGenerator
                baseFormData={formData}
                onEditInCreator={(batchFormData, imageDataUrl) => {
                  setFormData(prev => ({ ...prev, ...batchFormData }));
                  setBackgroundImage(imageDataUrl);
                  setCreateMode('single');
                }}
              />
            </div>
          )}

          <div className="flex gap-6 flex-col lg:flex-row" style={{ display: createMode === 'single' ? undefined : 'none' }}>
            {/* Left: Form */}
            <div className="lg:w-[340px] shrink-0">
              <BannerForm
                formData={formData}
                onUpdate={updateForm}
                onAddExtra={addExtraText}
                onRemoveExtra={removeExtraText}
              />
            </div>

            {/* Center: Canvas + Custom Instructions + Generate */}
            <div className="flex-1 min-w-0">
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
                  {error}
                </div>
              )}

              {/* 広告審査NG表現の簡易警告（Issue #31） */}
              <AdPolicyWarnings formData={formData} />

              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <BannerCanvas
                  ref={canvasRef}
                  backgroundImage={backgroundImage}
                  designPlan={designPlan}
                  aspectRatio={formData.aspectRatio}
                  customWidth={formData.customWidth}
                  customHeight={formData.customHeight}
                />
              </div>

              {/* 修正指示（AI生成バナーのみ。静的テンプレ時は AI 編集と Konva オーバーレイが
                  二重描画されるため非表示にし、テキスト編集に誘導する） */}
              {backgroundImage && !isEyecatchMode && (
                <div className="mt-3 bg-white rounded-xl border border-gray-200 p-4">
                  <h3 className="text-sm font-semibold text-gray-600 mb-2">
                    修正指示
                  </h3>
                  <textarea
                    value={editInstruction}
                    onChange={e => setEditInstruction(e.target.value)}
                    rows={2}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y placeholder:text-gray-300"
                    placeholder="例: 0が二つあるので一つ削除して / 背景をもう少し明るく"
                  />
                  <button
                    onClick={async () => {
                      await editBanner(editInstruction);
                      setEditInstruction('');
                    }}
                    disabled={isEditing || isGenerating || !editInstruction.trim()}
                    className="mt-2 w-full py-2.5 rounded-lg text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-gray-800 text-white hover:bg-gray-700 active:scale-[0.98]"
                  >
                    {isEditing ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                        </svg>
                        修正中...
                      </span>
                    ) : (
                      '修正を適用'
                    )}
                  </button>
                </div>
              )}

              {/* 静的テンプレ用ガイダンス: AI 編集ではなく左フォームのテキスト編集に誘導 */}
              {backgroundImage && isEyecatchMode && (
                <div className="mt-3 bg-amber-50 rounded-xl border border-amber-200 p-4">
                  <h3 className="text-sm font-semibold text-amber-800 mb-1">
                    このテンプレートは AI 編集に対応していません
                  </h3>
                  <p className="text-xs text-amber-700 leading-relaxed">
                    テキスト内容や改行を直すには、左フォームの「メインテキスト」「サブテキスト」を編集してください。テンプレートを差し替えたい場合は「テンプレート」タブから再選択してください。
                  </p>
                </div>
              )}

              {/* カスタム指示 */}
              <div className="mt-4 bg-white rounded-xl border border-gray-200 p-4">
                <h3 className="text-sm font-semibold text-gray-600 mb-2">
                  カスタム指示 <span className="text-gray-300 font-normal">(任意)</span>
                </h3>
                <textarea
                  value={formData.customPrompt}
                  onChange={e => updateForm({ customPrompt: e.target.value })}
                  rows={8}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y placeholder:text-gray-300"
                  placeholder="プロンプトジェネレーターで生成したプロンプトや、デザインの指示を自由に記述..."
                />
              </div>

              {/* 生成ボタン + プロンプト確認 */}
              <div className="mt-4 flex gap-2">
                <button
                  onClick={generate}
                  disabled={isGenerating || !formData.mainText.trim()}
                  className="flex-1 py-3.5 rounded-xl font-bold text-white text-base transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-blue-600 hover:bg-blue-500 active:scale-[0.98]"
                >
                  {isGenerating ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                      </svg>
                      AIがデザイン中...
                    </span>
                  ) : (
                    'バナーを生成'
                  )}
                </button>
                <button
                  onClick={async () => {
                    if (previewPrompt) { setPreviewPrompt(null); return; }
                    setIsLoadingPreview(true);
                    try {
                      const res = await fetch('/api/preview-prompt', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ formData }),
                      });
                      const data = await res.json();
                      // 失敗を無反応で握りつぶさない（プロンプト欄にエラーを表示）
                      setPreviewPrompt(data.prompt ?? `⚠️ プロンプト生成に失敗しました: ${data.error ?? `HTTP ${res.status}`}`);
                    } catch (e) {
                      setPreviewPrompt(`⚠️ プロンプト生成に失敗しました: ${e instanceof Error ? e.message : '通信エラー'}`);
                    } finally {
                      setIsLoadingPreview(false);
                    }
                  }}
                  disabled={!formData.mainText.trim() || isLoadingPreview}
                  className="px-4 py-3.5 rounded-xl font-medium text-sm transition-all disabled:opacity-40 border border-gray-200 text-gray-500 hover:bg-gray-50 hover:border-gray-300 active:scale-[0.98]"
                  title="AIに送る最終プロンプトを確認"
                >
                  {previewPrompt ? '閉じる' : 'Prompt'}
                </button>
              </div>

              {previewPrompt && (
                <div className="mt-3 bg-gray-900 rounded-xl p-4 max-h-[400px] overflow-y-auto">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-gray-400">{formData.engine === 'gemini' ? 'Gemini 3 Pro Image' : formData.engine === 'nano-pro' ? 'Nano Banana Pro (PoYo)' : formData.engine === 'gpt-image-2' ? 'GPT Image 2 (PoYo)' : 'GPT Image 2 (OpenAI直)'} に送信される最終プロンプト</span>
                    <button
                      onClick={() => { navigator.clipboard.writeText(previewPrompt); }}
                      className="text-xs text-gray-400 hover:text-white transition-colors"
                    >
                      コピー
                    </button>
                  </div>
                  <pre className="whitespace-pre-wrap text-sm text-gray-200 font-mono leading-relaxed">{previewPrompt}</pre>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* プロンプトジェネレータータブ */}
        <div style={{ display: activeTab === 'prompt' ? undefined : 'none' }}>
          <PromptGenerator
            onUsePrompt={(prompt, mainColor, formSuggestion) => {
              const updates: Record<string, unknown> = { customPrompt: prompt };
              if (mainColor) updates.mainColor = mainColor;
              if (formSuggestion) {
                if (formSuggestion.mainText) updates.mainText = formSuggestion.mainText;
                if (formSuggestion.subText) updates.subText = formSuggestion.subText;
                if (formSuggestion.extraTexts?.length) {
                  updates.extraTexts = formSuggestion.extraTexts.map(et => ({
                    id: Math.random().toString(36).substring(2, 9),
                    text: et.text,
                    decoration: et.decoration,
                  }));
                }
                updates.hasPersons = formSuggestion.hasPersons;
                if (formSuggestion.fontStyle !== 'auto') updates.fontStyle = formSuggestion.fontStyle;
              }
              updateForm(updates);
              setActiveTab('create');
            }}
          />
        </div>

        {/* 素材から生成タブ */}
        <div style={{ display: activeTab === 'url' ? undefined : 'none' }}>
          <SourceGenerator
            onEditInCreator={(srcFormData, imageBase64) => {
              setFormData(prev => ({ ...prev, ...srcFormData }));
              setBackgroundImage(imageBase64);
              setActiveTab('create');
            }}
          />
        </div>

        {/* バリエーション作成タブ */}
        <div style={{ display: activeTab === 'variation' ? undefined : 'none' }}>
          <VariationGenerator
            onEditInCreator={(varFormData, imageBase64) => {
              setFormData(prev => ({ ...prev, ...varFormData }));
              setBackgroundImage(imageBase64);
              setActiveTab('create');
            }}
          />
        </div>

        {/* 勝ち分析再現タブ */}
        <div style={{ display: activeTab === 'winning' ? undefined : 'none' }}>
          <WinningAnalyzer
            onEditInCreator={(winFormData, imageBase64) => {
              setFormData(prev => ({ ...prev, ...winFormData }));
              setBackgroundImage(imageBase64);
              setActiveTab('create');
            }}
          />
        </div>

        {/* テンプレートタブ */}
        <div style={{ display: activeTab === 'template' ? undefined : 'none' }}>
          <TemplateGallery
            onUseTemplate={handleUseTemplate}
            onGenerateFromTemplate={handleGenerateFromTemplate}
            onUseStaticTemplate={handleUseStaticTemplate}
          />
        </div>

        {/* 生成履歴タブ（学習ループ: 採用→入稿名→勝敗追跡） */}
        {activeTab === 'history' && <GenerationHistory />}
      </main>

      {/* ビルド情報バッジ（バージョン・画面名・デプロイ識別子）。スクショからの状態特定用 */}
      <BuildBadge screen={
        view === 'home' ? 'ホーム'
        : activeTab === 'accounts' ? 'アカウント管理'
        : TABS.find((t) => t.value === activeTab)?.label ?? activeTab
      } />
    </div>
  );
}
