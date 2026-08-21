'use client';

import { useState, useMemo, useCallback } from 'react';
import { TEMPLATES } from '@/data/templates';
import { TEMPLATE_CATEGORIES, replaceVariables } from '@/lib/template-types';
import { generateId } from '@/lib/utils';
import type { BannerTemplate, TemplateCategory } from '@/lib/template-types';
import type { BannerFormData } from '@/lib/types';

interface Props {
  /** テンプレートの formDefaults + customPrompt を渡してバナー作成タブに遷移 */
  onUseTemplate: (formData: Partial<BannerFormData>) => void;
  /** テンプレートから直接生成（モーダル経由）。成功時はbase64画像、失敗時はnull */
  onGenerateFromTemplate: (formData: Partial<BannerFormData>) => Promise<string | null>;
  /** 静的背景テンプレート用: 背景画像とdesignPlanを直接セットしてバナー作成タブに遷移 */
  onUseStaticTemplate?: (formData: Partial<BannerFormData>, backgroundImageUrl: string) => void;
}

type View = 'list' | 'detail';

/** テンプレートの変数をデフォルト値で置換したプロンプトを返す */
function resolvePrompt(template: BannerTemplate) {
  return replaceVariables(template.prompt, Object.fromEntries(
    template.variables.map(v => [v.name, v.defaultValue])
  ));
}

/** テンプレートのロゴ画像をfetchしてBase64データURLに変換する */
async function fetchLogoAsBase64(logoPath: string): Promise<string | undefined> {
  try {
    const res = await fetch(logoPath);
    if (!res.ok) return undefined;
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(undefined);
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

/** テンプレートの formDefaults を変数置換して返す */
function resolveFormDefaults(template: BannerTemplate, values: Record<string, string>) {
  const { formDefaults } = template;
  return {
    mainText: replaceVariables(formDefaults.mainText, values),
    subText: replaceVariables(formDefaults.subText, values),
    extraTexts: formDefaults.extraTexts?.map(et => ({
      id: generateId(),
      text: replaceVariables(et.text, values),
      decoration: et.decoration,
    })) ?? [],
    mainColor: formDefaults.mainColor,
    aspectRatio: formDefaults.aspectRatio,
    fontStyle: formDefaults.fontStyle,
    hasPersons: formDefaults.hasPersons,
  };
}

export default function TemplateGallery({ onUseTemplate, onGenerateFromTemplate, onUseStaticTemplate }: Props) {
  const [category, setCategory] = useState<TemplateCategory>('all');
  const [view, setView] = useState<View>('list');
  const [selectedTemplate, setSelectedTemplate] = useState<BannerTemplate | null>(null);
  const [copied, setCopied] = useState(false);

  // 編集モーダル
  const [showEditModal, setShowEditModal] = useState(false);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [isGeneratingInModal, setIsGeneratingInModal] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (category === 'all') return TEMPLATES;
    return TEMPLATES.filter(t => t.category === category);
  }, [category]);

  const openDetail = useCallback((template: BannerTemplate) => {
    setSelectedTemplate(template);
    setView('detail');
    setCopied(false);
    setGeneratedImage(null);
    // 変数のデフォルト値をセット
    setVariableValues(Object.fromEntries(
      template.variables.map(v => [v.name, v.defaultValue])
    ));
  }, []);

  const backToList = useCallback(() => {
    setView('list');
    setSelectedTemplate(null);
    setGeneratedImage(null);
  }, []);

  const copyPrompt = useCallback(async () => {
    if (!selectedTemplate) return;
    try {
      await navigator.clipboard.writeText(selectedTemplate.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // HTTP環境等でclipboard APIが使えない場合
    }
  }, [selectedTemplate]);

  // 詳細画面用: 変数を置換した最終プロンプト
  const resolvedDetailPrompt = useMemo(() => {
    if (!selectedTemplate) return '';
    return replaceVariables(selectedTemplate.prompt, variableValues);
  }, [selectedTemplate, variableValues]);

  const handleUseTemplate = useCallback(async () => {
    if (!selectedTemplate) return;
    const resolved = resolveFormDefaults(selectedTemplate, variableValues);
    const logoBase64 = selectedTemplate.logoImage
      ? await fetchLogoAsBase64(selectedTemplate.logoImage)
      : undefined;
    const formDataWithLogo = {
      ...resolved,
      customPrompt: resolvedDetailPrompt,
      ...(logoBase64 ? { logoImageBase64: logoBase64, logoPosition: selectedTemplate.logoPosition ?? 'bottom-left' } : {}),
    };

    // 静的背景テンプレートの場合、AI生成をスキップして背景を直接セット
    if (selectedTemplate.staticBackground && onUseStaticTemplate) {
      onUseStaticTemplate(formDataWithLogo, selectedTemplate.staticBackground);
    } else {
      onUseTemplate(formDataWithLogo);
    }
  }, [selectedTemplate, variableValues, resolvedDetailPrompt, onUseTemplate, onUseStaticTemplate]);

  const openEditModal = useCallback(() => {
    if (!selectedTemplate) return;
    // 変数のデフォルト値をセット
    setVariableValues(Object.fromEntries(
      selectedTemplate.variables.map(v => [v.name, v.defaultValue])
    ));
    setGeneratedImage(null);
    setModalError(null);
    setShowEditModal(true);
  }, [selectedTemplate]);

  // モーダル用: 変数を置換した最終プロンプト
  const resolvedEditPrompt = useMemo(() => {
    if (!selectedTemplate) return '';
    return replaceVariables(selectedTemplate.prompt, variableValues);
  }, [selectedTemplate, variableValues]);

  const handleGenerateInModal = useCallback(async () => {
    if (!selectedTemplate) return;
    setIsGeneratingInModal(true);
    setModalError(null);
    try {
      const resolved = resolveFormDefaults(selectedTemplate, variableValues);
      const logoBase64 = selectedTemplate.logoImage
        ? await fetchLogoAsBase64(selectedTemplate.logoImage)
        : undefined;
      const imageBase64 = await onGenerateFromTemplate({
        ...resolved,
        customPrompt: resolvedEditPrompt,
        ...(logoBase64 ? { logoImageBase64: logoBase64, logoPosition: selectedTemplate.logoPosition ?? 'bottom-left' } : {}),
      });
      if (imageBase64) {
        setGeneratedImage(imageBase64);
      } else {
        setModalError('画像の生成に失敗しました。もう一度お試しください。');
      }
    } catch {
      setModalError('通信エラーが発生しました。');
    } finally {
      setIsGeneratingInModal(false);
    }
  }, [selectedTemplate, variableValues, resolvedEditPrompt, onGenerateFromTemplate]);

  const downloadImage = useCallback(() => {
    if (!generatedImage) return;
    const link = document.createElement('a');
    link.href = generatedImage;
    link.download = `banner_${Date.now()}.png`;
    link.click();
  }, [generatedImage]);

  const handleOpenInCreator = useCallback(async () => {
    if (!selectedTemplate) return;
    setShowEditModal(false);
    const resolved = resolveFormDefaults(selectedTemplate, variableValues);
    const logoBase64 = selectedTemplate.logoImage
      ? await fetchLogoAsBase64(selectedTemplate.logoImage)
      : undefined;
    const formDataWithLogo = {
      ...resolved,
      customPrompt: resolvedEditPrompt,
      ...(logoBase64 ? { logoImageBase64: logoBase64, logoPosition: selectedTemplate.logoPosition ?? 'bottom-left' } : {}),
    };

    if (selectedTemplate.staticBackground && onUseStaticTemplate) {
      onUseStaticTemplate(formDataWithLogo, selectedTemplate.staticBackground);
    } else {
      onUseTemplate(formDataWithLogo);
    }
  }, [selectedTemplate, variableValues, resolvedEditPrompt, onUseTemplate, onUseStaticTemplate]);

  // ========== 一覧画面 ==========
  if (view === 'list') {
    return (
      <div>
        <div className="mb-5">
          <h2 className="text-lg font-bold text-gray-900">テンプレート</h2>
          <p className="text-xs text-gray-400 mt-1">勝ちパターンのデザインを選んで、テキストを差し替えるだけ。</p>
        </div>

        {/* カテゴリフィルター */}
        <div className="flex flex-wrap gap-2 mb-6">
          {TEMPLATE_CATEGORIES.map(cat => (
            <button
              key={cat.value}
              onClick={() => setCategory(cat.value)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all border ${
                category === cat.value
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300 hover:text-gray-700'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* グリッド */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(template => (
            <button
              key={template.id}
              onClick={() => openDetail(template)}
              className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:border-gray-300 hover:shadow-md transition-all text-left group"
            >
              {/* サムネイル */}
              <div
                className="aspect-video w-full flex items-center justify-center relative overflow-hidden"
                style={{ backgroundColor: template.thumbnailColor }}
              >
                {template.thumbnailImage ? (
                  <img
                    src={template.thumbnailImage}
                    alt={template.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="text-white/80 text-center px-4">
                    <p className="font-bold text-lg leading-tight">{template.formDefaults.mainText}</p>
                    <p className="text-sm mt-1 text-white/60">{template.formDefaults.subText}</p>
                  </div>
                )}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
              </div>
              {/* メタ情報 */}
              <div className="p-3">
                <h3 className="text-sm font-bold text-gray-800">{template.title}</h3>
                <p className="text-[11px] text-gray-400 mt-1 line-clamp-2">{template.description}</p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full">
                    {TEMPLATE_CATEGORIES.find(c => c.value === template.category)?.label}
                  </span>
                  <span className="text-[10px] text-gray-300">{template.createdAt}</span>
                </div>
              </div>
            </button>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-16 text-gray-300">
            <p className="text-4xl mb-3">📁</p>
            <p className="text-sm">このカテゴリにはまだテンプレートがありません</p>
          </div>
        )}
      </div>
    );
  }

  // ========== 詳細画面 ==========
  if (!selectedTemplate) return null;

  return (
    <div>
      {/* 戻るボタン */}
      <button
        onClick={backToList}
        className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 transition-colors mb-4"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        テンプレート一覧に戻る
      </button>

      <div className="flex gap-6 flex-col lg:flex-row">
        {/* 左: プレビュー */}
        <div className="lg:w-[480px] shrink-0">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/* カテゴリタグ */}
            <div className="px-4 pt-3">
              <span className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full">
                {TEMPLATE_CATEGORIES.find(c => c.value === selectedTemplate.category)?.label}
              </span>
            </div>

            {/* サムネイル */}
            <div className="p-4">
              <div
                className="aspect-video w-full rounded-lg flex items-center justify-center overflow-hidden"
                style={{ backgroundColor: selectedTemplate.thumbnailColor }}
              >
                {selectedTemplate.thumbnailImage ? (
                  <img
                    src={selectedTemplate.thumbnailImage}
                    alt={selectedTemplate.title}
                    className="w-full h-full object-cover rounded-lg"
                  />
                ) : (
                  <div className="text-white/80 text-center px-6">
                    <p className="font-bold text-2xl leading-tight">{selectedTemplate.formDefaults.mainText}</p>
                    <p className="text-base mt-2 text-white/60">{selectedTemplate.formDefaults.subText}</p>
                    {selectedTemplate.formDefaults.extraTexts?.map((et) => (
                      <p key={et.text} className="text-sm mt-1 text-white/50">{et.text}</p>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* メタ情報 */}
            <div className="px-4 pb-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-gray-800">{selectedTemplate.title}</h2>
                <p className="text-xs text-gray-400 mt-0.5">{selectedTemplate.description}</p>
              </div>
              <span className="text-xs text-gray-300 shrink-0">{selectedTemplate.createdAt}</span>
            </div>
          </div>
        </div>

        {/* 右: プロンプト */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* プロンプト表示 */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-600">プロンプト</h3>
              <button
                onClick={copyPrompt}
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

            {/* プロンプトテキスト（変数をハイライト表示） */}
            <div className="bg-gray-50 rounded-lg p-4">
              <HighlightedPrompt text={selectedTemplate.prompt} />
            </div>

            {/* 変数一覧 */}
            {selectedTemplate.variables.length > 0 && (
              <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
                <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px] font-medium">
                  変数 {selectedTemplate.variables.length}個
                </span>
                {selectedTemplate.variables.map(v => (
                  <span key={v.name} className="text-gray-400">
                    {v.label}: {v.defaultValue}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 変数入力フィールド */}
          {selectedTemplate.variables.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-3 h-3 bg-amber-100 border border-amber-300 rounded" />
                <h3 className="text-sm font-semibold text-gray-600">変数を編集</h3>
              </div>
              <div className="space-y-3">
                {selectedTemplate.variables.map(v => (
                  <div key={v.name}>
                    <label className="block text-xs text-gray-500 mb-1 font-medium">
                      {v.label}
                    </label>
                    <input
                      type="text"
                      value={variableValues[v.name] ?? v.defaultValue}
                      onChange={e => setVariableValues(prev => ({ ...prev, [v.name]: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                      placeholder={v.defaultValue}
                    />
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-2">
                空欄にすると該当の要素がバナーから除外されます
              </p>
            </div>
          )}

          {/* アクションボタン */}
          <div className="space-y-2">
            <button
              onClick={handleUseTemplate}
              className="w-full py-3.5 rounded-xl font-bold text-white text-base transition-all bg-blue-600 hover:bg-blue-500 active:scale-[0.98]"
            >
              このテンプレートでバナーを作る
            </button>
            <button
              onClick={openEditModal}
              className="w-full py-3 rounded-xl font-medium text-sm transition-all border border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300 active:scale-[0.98]"
            >
              プロンプトを編集して生成
            </button>
          </div>
        </div>
      </div>

      {/* ========== 編集モーダル ========== */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* オーバーレイ */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => { if (!isGeneratingInModal) setShowEditModal(false); }}
          />

          {/* モーダル本体 */}
          <div className="relative bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
            {/* ヘッダー */}
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 rounded-t-2xl flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-gray-900">プロンプトを編集して生成</h3>
                <p className="text-xs text-gray-400 mt-0.5">テキストを自由に編集して、オリジナルのバナーを生成できます</p>
              </div>
              <button
                onClick={() => setShowEditModal(false)}
                disabled={isGeneratingInModal}
                className="text-gray-300 hover:text-gray-500 text-2xl leading-none transition-colors disabled:opacity-50"
              >
                &times;
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* プロンプトプレビュー */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-600">プロンプト</label>
                  {selectedTemplate.variables.length > 0 && (
                    <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px] font-medium">
                      変数 {selectedTemplate.variables.length}個
                    </span>
                  )}
                </div>
                <div className="bg-gray-50 rounded-lg p-4 max-h-[240px] overflow-y-auto border border-gray-200">
                  <HighlightedPrompt text={selectedTemplate.prompt} />
                </div>
              </div>

              {/* 変数入力フィールド */}
              {selectedTemplate.variables.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-3 h-3 bg-amber-100 border border-amber-300 rounded" />
                    <span className="text-sm font-semibold text-gray-600">変数を編集</span>
                  </div>
                  <div className="space-y-3">
                    {selectedTemplate.variables.map(v => (
                      <div key={v.name}>
                        <label className="block text-xs text-gray-500 mb-1 font-medium">
                          {v.label}
                        </label>
                        <input
                          type="text"
                          value={variableValues[v.name] ?? v.defaultValue}
                          onChange={e => setVariableValues(prev => ({ ...prev, [v.name]: e.target.value }))}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                          placeholder={v.defaultValue}
                        />
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-2">
                    プロンプト内の <span className="bg-amber-100 text-amber-800 px-1 rounded text-[10px]">ハイライト部分</span> が入力値に置き換わります
                  </p>
                </div>
              )}

              {/* エラー表示 */}
              {modalError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
                  {modalError}
                </div>
              )}

              {/* 生成結果 */}
              {generatedImage && (
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-gray-600">生成結果</h4>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <img
                      src={generatedImage}
                      alt="生成されたバナー"
                      className="w-full rounded-lg"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={downloadImage}
                      className="flex-1 py-2.5 rounded-lg text-sm font-medium transition-all bg-gray-800 text-white hover:bg-gray-700 active:scale-[0.98]"
                    >
                      ダウンロード
                    </button>
                    <button
                      onClick={handleOpenInCreator}
                      className="flex-1 py-2.5 rounded-lg text-sm font-medium transition-all border border-gray-200 text-gray-600 hover:bg-gray-50 active:scale-[0.98]"
                    >
                      バナー作成タブで開く
                    </button>
                  </div>
                </div>
              )}

              {/* 生成ボタン */}
              <button
                onClick={handleGenerateInModal}
                disabled={isGeneratingInModal || !resolvedEditPrompt.trim()}
                className="w-full py-3.5 rounded-xl font-bold text-white text-base transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-blue-600 hover:bg-blue-500 active:scale-[0.98]"
              >
                {isGeneratingInModal ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                    生成中...
                  </span>
                ) : generatedImage ? (
                  '再生成する'
                ) : (
                  '生成する'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** プロンプトテキスト内の {{変数}} をハイライト表示するコンポーネント */
function HighlightedPrompt({ text }: { text: string }) {
  const parts = text.split(/(\{\{.+?\}\})/g);
  return (
    <pre className="whitespace-pre-wrap text-sm text-gray-700 font-sans leading-relaxed">
      {parts.map((part, i) => {
        if (part.startsWith('{{') && part.endsWith('}}')) {
          const varName = part.slice(2, -2);
          return (
            <span
              key={i}
              className="bg-amber-100 text-amber-800 px-1 py-0.5 rounded font-medium"
            >
              {varName}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </pre>
  );
}
