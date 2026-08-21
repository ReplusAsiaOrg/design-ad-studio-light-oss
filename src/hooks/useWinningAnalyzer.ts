'use client';

import { useState, useCallback, useEffect } from 'react';
import type { AspectRatio, BannerFormData, DestinationBrief, ImageEngine, WinningAnalysis, WinningConcept, WinningStudioMode } from '@/lib/types';
import { DESTINATION_ACCOUNTS, findDestinationAccount } from '@/lib/winning-accounts';
import {
  BACKGROUND_OPTIONS,
  DEFAULT_TASTE_KEYS,
  backgroundByKey,
  buildThemeRemakeDirection,
  tasteByKey,
  themeByKey,
} from '@/lib/winning-tastes';

/** 編集枠で「何を1軸だけ変えるか」（BannerFormData.variationAxis に渡る値）。 */
export type VariationAxis = 'copy' | 'season' | 'taste' | 'background';

// 見た目替え枠（下段3案）: 同コピー・同2分割構造のまま世界観テーマごと描き直す「テーマ替え」×3
// でぱっと見の印象を一新する（CR疲れ対策）。テイスト/背景の1軸編集もプルダウン軸として温存。
// カタログは winning-tastes.ts。
/** background軸のとき、編集3枠の背景バリエ指示。 */
// 3枠で「別シーン / 単色ポップ / 柄パターン」に振り分ける。
// ※控えめな指示（softer/subtly/gentle）だと編集モデルが安全側に倒して
//   ほぼ無変化になるため、一目で分かる変化を明示的に要求する。
// 背景替えの選択肢は winning-tastes.ts の BACKGROUND_OPTIONS（プルダウン共用）に集約。
import { runGenerationQueue } from '@/lib/generation-queue';
import { generateBanner } from '@/lib/generate-client';
import { playChimeIfEnabled } from '@/lib/chime';

type Phase = 'input' | 'analyzing' | 'concepts' | 'generating';

/** 流用先プルダウンの選択肢。登録簿の全アカウント＋プリセット（brief/配色の初期値）のマージ。 */
export interface DestinationOption {
  accountId: string;
  name: string;
  brief?: string;
  paletteHex?: string[];
}

/**
 * 勝ち分析再現タブの状態管理。
 * Step 1 入力 → Step 2 画像分析 → Step 3 6案提示（コピー差替3＋見た目替え3） → Step 4 選択した案を生成
 */
export function useWinningAnalyzer() {
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1');
  // 既定はPoYo経由GPT Image 2（UIの先頭ボタンと一致）。Tier A編集は正規版(OpenAI直)が最も忠実。
  const [engine, setEngine] = useState<ImageEngine>('gpt-image-2');
  // 2モード: 同プロジェクト改善（既定・実物clone保持）/ 別プロジェクト流用（構造だけ移植）。
  const [studioMode, setStudioMode] = useState<WinningStudioMode>('same-project');
  // cross-project: 流用先アカウント / 流用先の商材画像 / 流用先ブランドのブリーフ（編集可）。
  const [destinationAccountId, setDestinationAccountId] = useState<string | undefined>(undefined);
  const [destinationProductImage, setDestinationProductImage] = useState<string | null>(null);
  const [destinationBrief, setDestinationBrief] = useState<string>('');
  // 流用先プルダウンの選択肢。アカウント管理タブの登録簿から取得し、プリセット（brief/配色）をマージ。
  // 取得失敗時はプリセットのみで動作（従来挙動）。
  const [destinationOptions, setDestinationOptions] = useState<DestinationOption[]>(DESTINATION_ACCOUNTS);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/meta/accounts')
      .then((r) => r.json())
      .then((d: { ok: boolean; accounts?: { accountId: string; client: string; enabled?: boolean; brief?: string; paletteHex?: string[] }[] }) => {
        if (cancelled || !d.ok) return;
        const merged: DestinationOption[] = (d.accounts ?? [])
          .filter((a) => a.enabled !== false)
          .map((a) => {
            // ブリーフ・配色は登録簿（アカウント管理タブで編集）＞ハードコードのプリセット の順で採用
            const preset = findDestinationAccount(a.accountId);
            return {
              accountId: a.accountId,
              name: preset?.name ?? a.client,
              brief: a.brief?.trim() ? a.brief : preset?.brief,
              paletteHex: a.paletteHex?.length ? a.paletteHex : preset?.paletteHex,
            };
          });
        // 登録簿に無いプリセットも残す（登録簿が空・別環境の保険）
        for (const p of DESTINATION_ACCOUNTS) {
          if (!merged.some((m) => m.accountId === p.accountId)) merged.push(p);
        }
        if (merged.length) setDestinationOptions(merged);
      })
      .catch(() => { /* 未取得時はプリセットのみ */ });
    return () => { cancelled = true; };
  }, []);
  const destinationOptionOf = useCallback(
    (accountId?: string) => (accountId ? destinationOptions.find((o) => o.accountId === accountId) : undefined),
    [destinationOptions],
  );
  const [phase, setPhase] = useState<Phase>('input');
  const [analysis, setAnalysis] = useState<WinningAnalysis | null>(null);
  const [concepts, setConcepts] = useState<WinningConcept[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setPhase('input');
    setAnalysis(null);
    setConcepts([]);
    setError(null);
    setImageBase64(null);
    setDestinationProductImage(null);
  }, []);

  /** 流用先アカウントを選択。プリセットのブリーフを（未編集なら）初期投入する。 */
  const selectDestinationAccount = useCallback((accountId: string | undefined) => {
    setDestinationAccountId(accountId);
    const preset = destinationOptionOf(accountId);
    // ブリーフ未入力ならプリセットを差し込む（手入力済みなら尊重）。
    setDestinationBrief(prev => (prev.trim() ? prev : (preset?.brief ?? '')));
  }, [destinationOptionOf]);

  /** API に渡す DestinationBrief を組み立てる（cross-project のみ）。 */
  const buildDestination = useCallback((): DestinationBrief | undefined => {
    if (studioMode !== 'cross-project') return undefined;
    const preset = destinationOptionOf(destinationAccountId);
    return {
      accountId: destinationAccountId,
      name: preset?.name,
      brief: destinationBrief.trim() || preset?.brief,
      paletteHex: preset?.paletteHex,
      hasProductImage: !!destinationProductImage,
    };
  }, [studioMode, destinationAccountId, destinationBrief, destinationProductImage, destinationOptionOf]);

  /**
   * 見た目替え3案（same-project 下段）をローカルで組み立てる。
   * LLM生成不要: コピーは元CRのまま、3枚とも「テーマ替え（作り直し）」。
   * （テイスト/背景の編集系は make() が引き続き対応。プルダウン軸として温存）
   */
  const buildVisualConcepts = (a: WinningAnalysis): WinningConcept[] => {
    const make = (
      i: number,
      axis: 'taste' | 'background' | 'theme',
      key: string,
      angle: string,
      layoutLabel: string,
    ): WinningConcept => {
      const isTheme = axis === 'theme';
      return {
        id: `winning-visual-${i}`,
        tier: 'B',
        angle,
        layoutAxis: 'format-clone',
        layoutLabel,
        inheritedFrom: isTheme
          ? '勝ちCRのゾーン構造・陰陽対比・コピーを踏襲し、世界観テーマごと丸ごと描き直し。'
          : '勝ちクリエイティブのレイアウト・コピー・視線誘導を完全に踏襲し、見た目の1軸だけ変更。',
        mainText: a.message.mainText,
        subText: a.message.subText,
        extraTexts: a.message.extraTexts.map((et) => ({ text: et.text, decoration: et.decoration })),
        mainColor: a.visual.paletteHex[0] || '#333333',
        // テーマ替えは formatBlueprint 骨格の再構築生成（編集ではない）
        customPrompt: isTheme
          ? buildThemeRemakeDirection(a.formatBlueprint, themeByKey(key)?.prompt ?? '')
          : '',
        ...(isTheme ? {} : { reproductionMode: 'edit' as const }),
        hasPersons: a.hasPersons,
        isGenerating: false,
        visualVariation: { axis, key },
      };
    };
    // 3枚とも「テーマ替え（作り直し）」。初期テーマは印象の離れた3種、プルダウンで変更可。
    const themeKeys = ['retro-game', 'news-flash', 'manga'];
    return themeKeys.map((key, i) =>
      make(i, 'theme', key, 'テーマ替え', themeByKey(key)?.label ?? key),
    );
  };

  /**
   * 見た目替えカードのプルダウンで画風/背景を切り替える。
   * 次の「再生成」からこの key のプロンプトで生成される。
   */
  const updateVisualVariation = useCallback((conceptId: string, key: string) => {
    setConcepts(prev => prev.map(c => {
      if (c.id !== conceptId || !c.visualVariation) return c;
      const { axis } = c.visualVariation;
      const option = axis === 'taste' ? tasteByKey(key) : axis === 'background' ? backgroundByKey(key) : themeByKey(key);
      return {
        ...c,
        visualVariation: { ...c.visualVariation, key },
        layoutLabel: option?.label ?? c.layoutLabel,
        // テーマ替えは customPrompt（再構築指示）ごと差し替える
        ...(axis === 'theme' && analysis
          ? { customPrompt: buildThemeRemakeDirection(analysis.formatBlueprint, option?.prompt ?? '') }
          : {}),
      };
    }));
  }, [analysis]);

  /** 見た目替えカードの「人物も別人に」チェックを切り替える。次の再生成から反映。 */
  const toggleVisualSwapPersons = useCallback((conceptId: string) => {
    setConcepts(prev => prev.map(c => (
      c.id === conceptId && c.visualVariation
        ? { ...c, visualVariation: { ...c.visualVariation, swapPersons: !c.visualVariation.swapPersons } }
        : c
    )));
  }, []);

  /** Step 2 + Step 3: 画像分析 → 構成案を取得（same-projectはコピー3案＋見た目3案） */
  const analyze = useCallback(async () => {
    if (!imageBase64) return;
    setError(null);
    setPhase('analyzing');

    try {
      const analyzeRes = await fetch('/api/analyze-winning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64 }),
      });
      const analyzeData = await analyzeRes.json();
      if (analyzeData.error) {
        setError(analyzeData.error);
        setPhase('input');
        return;
      }
      const a: WinningAnalysis = analyzeData.analysis;
      setAnalysis(a);

      const conceptRes = await fetch('/api/generate-winning-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysis: a, aspectRatio, mode: studioMode, destination: buildDestination() }),
      });
      const conceptData = await conceptRes.json();
      if (conceptData.error) {
        setError(conceptData.error);
        setPhase('input');
        return;
      }
      const fetched = conceptData.concepts as WinningConcept[];
      // same-project: LLM生成のコピー3案 + ローカル組み立ての見た目替え3案で計6案
      setConcepts(studioMode === 'same-project' ? [...fetched, ...buildVisualConcepts(a)] : fetched);
      setPhase('concepts');
    } catch (e) {
      setError(e instanceof Error ? e.message : '通信エラーが発生しました');
      setPhase('input');
    }
  }, [imageBase64, aspectRatio, studioMode, buildDestination]);

  // モード別に「参照画像」と「使い方」を決める。
  //  - same-project : 流用元の勝ちCRを参照。Tier A(edit)=clone編集（実物保持）/ Tier B=style継承。
  //  - cross-project: 流用元画像は絶対に土台にしない（盗用事故防止）。流用先の商材画像のみ使う
  //                   （あれば asset として被写体配置、無ければ参照なしで構造から t2i 生成）。
  const referenceForConcept = (c: WinningConcept): Pick<BannerFormData, 'referenceImageBase64' | 'referenceImageMode'> => {
    if (studioMode === 'cross-project') {
      return {
        referenceImageBase64: destinationProductImage ?? undefined,
        referenceImageMode: destinationProductImage ? 'asset' : undefined,
      };
    }
    // テーマ替え（作り直し）: 元画像を渡すとモデルが装飾ごと写してしまうため、
    // 参照なしで formatBlueprint（customPrompt）から新規生成する。
    if (c.visualVariation?.axis === 'theme') {
      return { referenceImageBase64: undefined, referenceImageMode: undefined };
    }
    return {
      referenceImageBase64: imageBase64 ?? undefined,
      referenceImageMode: c.reproductionMode === 'edit' ? 'clone' : 'style',
    };
  };

  // 編集枠のスロット番号（A-1=0, A-2=1, A-3=2）。id 末尾の数値から導出。
  /**
   * 編集枠(clone)のテキストとバリエーション軸を決める。
   * - コピー案（上段・visualVariation なし）: 各案の新コピーで copy 軸編集
   * - 見た目替え案（下段・visualVariation あり）: コピーは元の勝ちCRのまま、指定の1軸（画風/背景）だけ振る
   */
  const variationForConcept = (c: WinningConcept): {
    texts: Pick<BannerFormData, 'mainText' | 'subText' | 'extraTexts'>;
    variationAxis: VariationAxis;
    variationDetail?: string;
    variationSwapPersons?: boolean;
  } => {
    if (!c.visualVariation) {
      return {
        texts: {
          mainText: c.mainText,
          subText: c.subText,
          extraTexts: c.extraTexts.map((et, i) => ({ id: `et-${c.id}-${i}`, text: et.text, decoration: et.decoration })),
        },
        variationAxis: 'copy',
      };
    }
    // 見た目替え: 元コピー据え置き（analysis のテキストを使う）
    // ※ theme（作り直し）は reproductionMode='edit' ではないためここには来ない
    //   （customPrompt＋参照なし生成の通常経路。variationAxis も使わない）
    const { axis, key } = c.visualVariation;
    const m = analysis?.message;
    const origExtras = (m?.extraTexts ?? []).map((et, i) => ({ id: `et-orig-${i}`, text: et.text, decoration: et.decoration }));
    const editAxis: VariationAxis = axis === 'taste' ? 'taste' : 'background';
    const detail = editAxis === 'taste'
      ? (tasteByKey(key) ?? tasteByKey(DEFAULT_TASTE_KEYS[0])!).prompt
      : (backgroundByKey(key) ?? BACKGROUND_OPTIONS[0]).prompt;
    return {
      texts: { mainText: m?.mainText ?? c.mainText, subText: m?.subText ?? c.subText, extraTexts: origExtras },
      variationAxis: editAxis,
      variationDetail: detail,
      variationSwapPersons: !!c.visualVariation.swapPersons,
    };
  };

  const buildFormData = useCallback((c: WinningConcept): BannerFormData => {
    // バリエーション軸は same-project の clone 編集枠のみ。cross-project は流用先コピーをそのまま使う。
    const useVariation = studioMode === 'same-project' && c.reproductionMode === 'edit';
    const v = useVariation ? variationForConcept(c) : null;
    return {
      engine,
      mainText: v ? v.texts.mainText! : c.mainText,
      subText: v ? v.texts.subText! : c.subText,
      extraTexts: v ? v.texts.extraTexts! : c.extraTexts.map((et, i) => ({
        id: `et-${c.id}-${i}`,
        text: et.text,
        decoration: et.decoration,
      })),
      mainColor: c.mainColor,
      aspectRatio,
      fontStyle: 'auto',
      hasPersons: c.hasPersons,
      customPrompt: c.customPrompt,
      ...referenceForConcept(c),
      ...(v ? { variationAxis: v.variationAxis, variationDetail: v.variationDetail, variationSwapPersons: v.variationSwapPersons } : {}),
    };
  }, [engine, aspectRatio, imageBase64, studioMode, destinationProductImage, analysis]);

  /**
   * 生成前（または再生成前）にカード上でテキストを軽く手直しする。
   * mainText / subText / extraTexts を更新。次の generateConcept/generateAll に反映される。
   * ※ 見た目替え枠（visualVariation あり）はコピー据え置き設計のため、
   *   コピー編集は画像へ反映されない（UIも読み取り専用表示にしている）。
   */
  const updateConceptText = useCallback((
    conceptId: string,
    patch: Partial<Pick<WinningConcept, 'mainText' | 'subText' | 'extraTexts'>>,
  ) => {
    setConcepts(prev => prev.map(c => (c.id === conceptId ? { ...c, ...patch } : c)));
  }, []);

  /** Step 4: 指定したコンセプトの画像を生成 */
  const generateConcept = useCallback(async (conceptId: string) => {
    const target = concepts.find(c => c.id === conceptId);
    if (!target) return;

    setConcepts(prev => prev.map(c =>
      c.id === conceptId ? { ...c, isGenerating: true, error: undefined } : c
    ));

    try {
      const { imageBase64 } = await generateBanner(buildFormData(target), undefined, {});
      setConcepts(prev => prev.map(c =>
        c.id === conceptId
          ? { ...c, isGenerating: false, imageBase64: `data:image/png;base64,${imageBase64}` }
          : c
      ));
      playChimeIfEnabled();
    } catch (e) {
      setConcepts(prev => prev.map(c =>
        c.id === conceptId
          ? { ...c, isGenerating: false, error: e instanceof Error ? e.message : 'エラー' }
          : c
      ));
    }
  }, [concepts, buildFormData]);

  /** すべてのコンセプトを並列生成（最大3並列） */
  const generateAll = useCallback(async () => {
    const targets = concepts.filter(c => !c.imageBase64 && !c.isGenerating);
    if (targets.length === 0) return;

    setConcepts(prev => prev.map(c =>
      targets.find(t => t.id === c.id) ? { ...c, isGenerating: true, error: undefined } : c
    ));

    // 逐次生成（1枚できたら次を投入）+ 429 リトライ。
    // 旧実装は concurrency=3 の並列で PoYo の同時実行上限に当たり途中で止まっていた。
    await runGenerationQueue(
      targets.map(t => ({ id: t.id, formData: buildFormData(t), mode: 'winning-strict' as const })),
      {
        onSuccess: (id, dataUrl) => {
          setConcepts(prev => prev.map(c =>
            c.id === id ? { ...c, isGenerating: false, imageBase64: dataUrl } : c
          ));
        },
        onError: (id, message) => {
          setConcepts(prev => prev.map(c =>
            c.id === id ? { ...c, isGenerating: false, error: message } : c
          ));
        },
      },
    );
    playChimeIfEnabled();
  }, [concepts, buildFormData]);

  /** 「バナー作成タブで編集」用の formData 変換 */
  const conceptToFormData = useCallback((c: WinningConcept): Partial<BannerFormData> => {
    const useVariation = studioMode === 'same-project' && c.reproductionMode === 'edit';
    const v = useVariation ? variationForConcept(c) : null;
    return {
      engine,
      mainText: v ? v.texts.mainText! : c.mainText,
      subText: v ? v.texts.subText! : c.subText,
      extraTexts: v ? v.texts.extraTexts! : c.extraTexts.map((et, i) => ({
        id: `et-${c.id}-${i}`,
        text: et.text,
        decoration: et.decoration,
      })),
      mainColor: c.mainColor,
      aspectRatio,
      fontStyle: 'auto',
      hasPersons: c.hasPersons,
      customPrompt: c.customPrompt,
      ...referenceForConcept(c),
      ...(v ? { variationAxis: v.variationAxis, variationDetail: v.variationDetail, variationSwapPersons: v.variationSwapPersons } : {}),
    };
  }, [engine, aspectRatio, imageBase64, studioMode, destinationProductImage, analysis]);

  return {
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
  };
}
