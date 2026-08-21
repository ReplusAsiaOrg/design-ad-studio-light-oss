'use client';

import { useState, useCallback } from 'react';
import type { AspectRatio, BannerAnalysis, BannerFormData, ImageEngine, Variation, VariationCategory } from '@/lib/types';
import { runGenerationQueue } from '@/lib/generation-queue';
import { generateBanner } from '@/lib/generate-client';
import { playChimeIfEnabled } from '@/lib/chime';

type Phase = 'input' | 'analyzing' | 'review' | 'styling' | 'gallery';

export function useVariationGenerator() {
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  /** 変更禁止の素材画像（書籍・商品・パッケージ・人物）。生成時に asset 参照としてエンジンへ渡す */
  const [assetImageBase64, setAssetImageBase64] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1');
  const [engine, setEngine] = useState<ImageEngine>('nano-pro');
  const [category, setCategoryRaw] = useState<VariationCategory>('auto');
  /** ユーザーが手動でカテゴリを変更したか。true なら analysis 結果で上書きしない */
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [phase, setPhase] = useState<Phase>('input');
  const [analysis, setAnalysis] = useState<BannerAnalysis | null>(null);
  const [variations, setVariations] = useState<Variation[]>([]);
  const [error, setError] = useState<string | null>(null);

  /** ユーザー操作経由のカテゴリ変更（手動扱いとしてマーク） */
  const setCategory = useCallback((c: VariationCategory) => {
    setCategoryRaw(c);
    setCategoryTouched(true);
  }, []);

  const reset = useCallback(() => {
    setPhase('input');
    setAnalysis(null);
    setVariations([]);
    setError(null);
    setImageBase64(null);
    setAssetImageBase64(null);
    setCategoryRaw('auto');
    setCategoryTouched(false);
  }, []);

  /** Step 1: 画像を解析して「読み取った内容」を表示（review フェーズで停止。ここでテキストを削れる） */
  const analyze = useCallback(async () => {
    if (!imageBase64) return;
    setError(null);
    setPhase('analyzing');

    try {
      const analyzeRes = await fetch('/api/analyze-banner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64, assetImageBase64: assetImageBase64 ?? undefined }),
      });
      const analyzeData = await analyzeRes.json();
      if (analyzeData.error) {
        setError(analyzeData.error);
        setPhase('input');
        return;
      }
      const a: BannerAnalysis = analyzeData.analysis;
      setAnalysis(a);

      // ユーザーが手動で変更していなければ、解析結果のカテゴリを採用
      if (!categoryTouched) {
        setCategoryRaw(a.suggestedCategory);
      }
      setPhase('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : '通信エラーが発生しました');
      setPhase('input');
    }
  }, [imageBase64, assetImageBase64, categoryTouched]);

  /** 読み取った内容からテキストを1つ削除（review 中は初回生成に、gallery 中は以降の再生成に反映） */
  const removeExtraText = useCallback((index: number) => {
    setAnalysis(prev => prev
      ? { ...prev, extraTexts: prev.extraTexts.filter((_, i) => i !== index) }
      : prev);
  }, []);

  /** Step 2-3: 確認済みの読み取り内容で6テイストを考案し、順次生成する */
  const startGeneration = useCallback(async () => {
    if (!analysis) return;
    const a = analysis;
    setError(null);
    setPhase('styling');

    try {
      const styleRes = await fetch('/api/generate-variation-styles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysis: a, aspectRatio, category }),
      });
      const styleData = await styleRes.json();
      if (styleData.error) {
        setError(styleData.error);
        setPhase('review'); // 読み取り内容は保持したままやり直せるように
        return;
      }

      const initialVariations: Variation[] = styleData.styles.map((s: Variation, i: number) => ({
        id: `variation-${i}`,
        name: s.name,
        paletteHex: s.paletteHex,
        descriptionJa: s.descriptionJa,
        customPrompt: s.customPrompt,
        hasPersons: s.hasPersons,
        isGenerating: true,
      }));
      setVariations(initialVariations);
      setPhase('gallery');

      // Step 3: 逐次生成（1枚できたら次を投入）。
      // 旧実装は concurrency=3 の並列だったが、PoYo の同時実行上限に当たり
      // 途中で止まる事故があったため、共通キューで完全逐次 + 429 リトライに変更。
      const buildFormData = (v: Variation): BannerFormData => ({
        engine,
        mainText: a.mainText,
        subText: a.subText,
        extraTexts: a.extraTexts.map((et, i) => ({
          id: `et-${v.id}-${i}`,
          text: et.text,
          decoration: et.decoration,
        })),
        mainColor: v.paletteHex[0] || '#333333',
        aspectRatio,
        fontStyle: 'auto',
        hasPersons: v.hasPersons,
        customPrompt: v.customPrompt,
        // 素材画像は「変更禁止のメインビジュアル」としてそのままエンジンに渡す
        referenceImageBase64: assetImageBase64 ?? undefined,
        referenceImageMode: assetImageBase64 ? 'asset' : undefined,
      });

      await runGenerationQueue(
        initialVariations.map(v => ({ id: v.id, formData: buildFormData(v) })),
        {
          onSuccess: (id, dataUrl) => {
            setVariations(prev => prev.map(x =>
              x.id === id ? { ...x, isGenerating: false, imageBase64: dataUrl } : x
            ));
          },
          onError: (id, message) => {
            setVariations(prev => prev.map(x =>
              x.id === id ? { ...x, isGenerating: false, error: message } : x
            ));
          },
        },
      );
      playChimeIfEnabled();
    } catch (e) {
      setError(e instanceof Error ? e.message : '通信エラーが発生しました');
      setPhase('review');
    }
  }, [analysis, assetImageBase64, aspectRatio, engine, category]);

  const retryVariation = useCallback(async (variationId: string) => {
    if (!analysis) return;
    const target = variations.find(v => v.id === variationId);
    if (!target) return;

    setVariations(prev => prev.map(x =>
      x.id === variationId ? { ...x, isGenerating: true, error: undefined } : x
    ));

    try {
      const formData: BannerFormData = {
        engine,
        mainText: analysis.mainText,
        subText: analysis.subText,
        extraTexts: analysis.extraTexts.map((et, i) => ({
          id: `et-${target.id}-${i}`,
          text: et.text,
          decoration: et.decoration,
        })),
        mainColor: target.paletteHex[0] || '#333333',
        aspectRatio,
        fontStyle: 'auto',
        hasPersons: target.hasPersons,
        customPrompt: target.customPrompt,
        referenceImageBase64: assetImageBase64 ?? undefined,
        referenceImageMode: assetImageBase64 ? 'asset' : undefined,
      };

      const { imageBase64 } = await generateBanner(formData, undefined, {});
      setVariations(prev => prev.map(x =>
        x.id === variationId
          ? { ...x, isGenerating: false, imageBase64: `data:image/png;base64,${imageBase64}` }
          : x
      ));
    } catch (e) {
      setVariations(prev => prev.map(x =>
        x.id === variationId
          ? { ...x, isGenerating: false, error: e instanceof Error ? e.message : 'エラー' }
          : x
      ));
    }
  }, [analysis, variations, aspectRatio, engine, assetImageBase64]);

  /** バリエーションを「バナー作成タブで編集」する用の formData 変換 */
  const variationToFormData = useCallback((v: Variation): Partial<BannerFormData> | null => {
    if (!analysis) return null;
    return {
      engine,
      mainText: analysis.mainText,
      subText: analysis.subText,
      extraTexts: analysis.extraTexts.map((et, i) => ({
        id: `et-${v.id}-${i}`,
        text: et.text,
        decoration: et.decoration,
      })),
      mainColor: v.paletteHex[0] || '#333333',
      aspectRatio,
      fontStyle: 'auto',
      hasPersons: v.hasPersons,
      customPrompt: v.customPrompt,
      referenceImageBase64: assetImageBase64 ?? undefined,
      referenceImageMode: assetImageBase64 ? 'asset' : undefined,
    };
  }, [analysis, aspectRatio, engine, assetImageBase64]);

  return {
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
  };
}
