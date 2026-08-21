'use client';

import { useState, useCallback } from 'react';
import type { AspectRatio, ScrapedPageData, BannerConcept, BannerFormData, ImageEngine } from '@/lib/types';
import { playChimeIfEnabled } from '@/lib/chime';
import { generateBanner } from '@/lib/generate-client';

type Phase = 'input' | 'concepts' | 'gallery';

/**
 * D&Dでアップロードされた素材ファイル。
 * Phase 1 では markdown/text のみ /api/scrape-file が受け付ける。
 * image/pdf/video は将来用に型だけ用意。
 */
export type SourceFileKind = 'markdown' | 'text' | 'image' | 'pdf' | 'video';

export interface SourceFile {
  kind: SourceFileKind;
  filename: string;
  /** markdown/text のときは生テキスト、それ以外は data URL */
  payload: string;
  /** UI 表示用のサイズ（バイト） */
  sizeBytes: number;
}

export function useSourceGenerator() {
  const [url, setUrl] = useState('');
  const [sourceFile, setSourceFile] = useState<SourceFile | null>(null);
  const [screenshotBase64, setScreenshotBase64] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1');
  const [engine, setEngine] = useState<ImageEngine>('gpt-image-2');
  const [phase, setPhase] = useState<Phase>('input');
  const [scrapedData, setScrapedData] = useState<ScrapedPageData | null>(null);
  const [concepts, setConcepts] = useState<BannerConcept[]>([]);
  const [isScraping, setIsScraping] = useState(false);
  const [isGeneratingConcepts, setIsGeneratingConcepts] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Phase 1: 素材（URL or ファイル）→ スクレイピング → コンセプト生成
  const analyze = useCallback(async () => {
    // ファイルがあればファイル優先、なければ URL
    if (!sourceFile && !url.trim()) return;
    setError(null);
    setIsScraping(true);

    try {
      // Step 1: 素材から ScrapedPageData を取得
      let scrapeData: { data?: ScrapedPageData; error?: string };
      if (sourceFile) {
        const res = await fetch('/api/scrape-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: sourceFile.kind,
            filename: sourceFile.filename,
            payload: sourceFile.payload,
          }),
        });
        scrapeData = await res.json();
      } else {
        const res = await fetch('/api/scrape-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        scrapeData = await res.json();
      }

      if (scrapeData.error || !scrapeData.data) {
        setError(scrapeData.error || '素材の解析に失敗しました');
        return;
      }
      setScrapedData(scrapeData.data);
      setIsScraping(false);
      setIsGeneratingConcepts(true);

      // Step 2: Generate concepts (スクショがあれば一緒に送る)
      const conceptRes = await fetch('/api/generate-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scrapedData: scrapeData.data,
          ...(screenshotBase64 ? { screenshotBase64 } : {}),
        }),
      });
      const conceptData = await conceptRes.json();
      if (conceptData.error) {
        setError(conceptData.error);
        return;
      }
      setConcepts(conceptData.concepts);
      setPhase('concepts');
    } catch (e) {
      setError(e instanceof Error ? e.message : '通信エラーが発生しました');
    } finally {
      setIsScraping(false);
      setIsGeneratingConcepts(false);
    }
  }, [url, sourceFile, screenshotBase64]);

  // コンセプトの選択/解除
  const toggleConcept = useCallback((id: string) => {
    setConcepts(prev => prev.map(c =>
      c.id === id ? { ...c, selected: !c.selected } : c
    ));
  }, []);

  // コンセプトのテキスト編集
  const updateConcept = useCallback((id: string, updates: Partial<BannerConcept>) => {
    setConcepts(prev => prev.map(c =>
      c.id === id ? { ...c, ...updates } : c
    ));
  }, []);

  // Phase 2: 選択コンセプト → バナー生成
  const generateBanners = useCallback(async () => {
    const selected = concepts.filter(c => c.selected);
    if (selected.length === 0) return;

    setPhase('gallery');

    // Mark selected as generating
    setConcepts(prev => prev.map(c =>
      c.selected ? { ...c, isGenerating: true, error: undefined, imageBase64: undefined } : c
    ));

    // 同時2並列で生成
    const concurrency = 2;
    const queue = [...selected];

    const processNext = async () => {
      while (queue.length > 0) {
        const concept = queue.shift()!;
        try {
          const formData: BannerFormData = {
            engine,
            mainText: concept.mainText,
            subText: concept.subText,
            extraTexts: concept.extraTexts.map((et, i) => ({
              id: `et-${concept.id}-${i}`,
              text: et.text,
              decoration: et.decoration,
            })),
            mainColor: concept.mainColor,
            aspectRatio,
            fontStyle: 'auto',
            hasPersons: concept.hasPersons,
            customPrompt: concept.customPrompt,
          };

          const { imageBase64 } = await generateBanner(formData, undefined, {});
          setConcepts(prev => prev.map(c =>
            c.id === concept.id
              ? { ...c, isGenerating: false, imageBase64: `data:image/png;base64,${imageBase64}` }
              : c
          ));
        } catch (e) {
          setConcepts(prev => prev.map(c =>
            c.id === concept.id
              ? { ...c, isGenerating: false, error: e instanceof Error ? e.message : 'エラーが発生しました' }
              : c
          ));
        }
      }
    };

    // Start concurrent workers
    const workers = Array.from({ length: Math.min(concurrency, selected.length) }, () => processNext());
    await Promise.all(workers);
    playChimeIfEnabled();
  }, [concepts, aspectRatio, engine]);

  // 単一コンセプトのリトライ
  const retryConcept = useCallback(async (conceptId: string) => {
    const concept = concepts.find(c => c.id === conceptId);
    if (!concept) return;

    setConcepts(prev => prev.map(c =>
      c.id === conceptId ? { ...c, isGenerating: true, error: undefined } : c
    ));

    try {
      const formData: BannerFormData = {
        engine,
        mainText: concept.mainText,
        subText: concept.subText,
        extraTexts: concept.extraTexts.map((et, i) => ({
          id: `et-${concept.id}-${i}`,
          text: et.text,
          decoration: et.decoration,
        })),
        mainColor: concept.mainColor,
        aspectRatio,
        fontStyle: 'auto',
        hasPersons: concept.hasPersons,
        customPrompt: concept.customPrompt,
      };

      const { imageBase64 } = await generateBanner(formData, undefined, {});
      setConcepts(prev => prev.map(c =>
        c.id === conceptId
          ? { ...c, isGenerating: false, imageBase64: `data:image/png;base64,${imageBase64}` }
          : c
      ));
    } catch (e) {
      setConcepts(prev => prev.map(c =>
        c.id === conceptId
          ? { ...c, isGenerating: false, error: e instanceof Error ? e.message : 'エラーが発生しました' }
          : c
      ));
    }
  }, [concepts, aspectRatio, engine]);

  // リセット
  const reset = useCallback(() => {
    setPhase('input');
    setScrapedData(null);
    setConcepts([]);
    setError(null);
    setScreenshotBase64(null);
    setSourceFile(null);
  }, []);

  // BannerConcept → BannerFormData 変換（バナー作成タブへの受け渡し用）
  const conceptToFormData = useCallback((concept: BannerConcept): Partial<BannerFormData> => {
    return {
      engine,
      mainText: concept.mainText,
      subText: concept.subText,
      extraTexts: concept.extraTexts.map((et, i) => ({
        id: `et-${concept.id}-${i}`,
        text: et.text,
        decoration: et.decoration,
      })),
      mainColor: concept.mainColor,
      aspectRatio,
      fontStyle: 'auto',
      hasPersons: concept.hasPersons,
      customPrompt: concept.customPrompt,
    };
  }, [aspectRatio, engine]);

  return {
    // State
    url,
    setUrl,
    sourceFile,
    setSourceFile,
    screenshotBase64,
    setScreenshotBase64,
    aspectRatio,
    setAspectRatio,
    engine,
    setEngine,
    phase,
    scrapedData,
    concepts,
    isScraping,
    isGeneratingConcepts,
    error,
    // Actions
    analyze,
    toggleConcept,
    updateConcept,
    generateBanners,
    retryConcept,
    reset,
    conceptToFormData,
  };
}
