'use client';

import { useState, useCallback } from 'react';
import { BannerFormData, DesignPlan } from '@/lib/types';
import { generateId } from '@/lib/utils';
import { playChimeIfEnabled } from '@/lib/chime';
import { generateBanner, editBannerImage } from '@/lib/generate-client';

const DEFAULT_FORM: BannerFormData = {
  engine: 'gpt-image-2',
  mainText: '',
  subText: '',
  extraTexts: [],
  mainColor: '',
  aspectRatio: '1:1',
  fontStyle: 'auto',
  hasPersons: false,
  personMode: 'auto',
  customPrompt: '',
  referenceUrl: '',
};

export function useBannerState() {
  const [formData, setFormData] = useState<BannerFormData>(DEFAULT_FORM);
  const [backgroundImage, setBackgroundImage] = useState<string | null>(null);
  const [designPlan, setDesignPlan] = useState<DesignPlan | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateForm = useCallback((updates: Partial<BannerFormData>) => {
    setFormData(prev => ({ ...prev, ...updates }));
  }, []);

  const addExtraText = useCallback(() => {
    const id = generateId();
    setFormData(prev => ({
      ...prev,
      extraTexts: [...prev.extraTexts, { id, text: '', decoration: 'none' as const }],
    }));
  }, []);

  const removeExtraText = useCallback((id: string) => {
    setFormData(prev => ({
      ...prev,
      extraTexts: prev.extraTexts.filter(t => t.id !== id),
    }));
  }, []);

  // アイキャッチモード（静的背景テンプレート使用中）
  const [isEyecatchMode, setIsEyecatchMode] = useState(false);

  const generate = useCallback(async () => {
    setIsGenerating(true);
    setError(null);
    try {
      // アイキャッチモード: 背景イラスト生成 + フレーム合成
      if (isEyecatchMode) {
        const articleTitle = [formData.mainText, formData.subText, ...formData.extraTexts.map(t => t.text)]
          .filter(Boolean).join(' ');
        const res = await fetch('/api/generate-eyecatch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ formData, articleTitle }),
        });
        const data = await res.json();
        if (data.error) {
          setError(data.error);
        } else {
          setBackgroundImage(`data:image/png;base64,${data.imageBase64}`);
          if (data.designPlan) {
            setDesignPlan(data.designPlan);
          }
          playChimeIfEnabled();
        }
      } else {
        // 通常モード（submit→ブラウザ側ポーリング）
        const { imageBase64, designPlan } = await generateBanner(formData, undefined, {});
        setBackgroundImage(`data:image/png;base64,${imageBase64}`);
        if (designPlan) {
          setDesignPlan(designPlan);
        }
        playChimeIfEnabled();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '通信エラーが発生しました');
    } finally {
      setIsGenerating(false);
    }
  }, [formData, isEyecatchMode]);

  const editBanner = useCallback(async (instruction: string) => {
    if (!backgroundImage || !instruction.trim()) return;
    setIsEditing(true);
    setError(null);
    try {
      // backgroundImage は AI 生成時は data URL、静的テンプレ時は /templates/xxx.png のパス。
      // PoYo / OpenAI 等の API は data URL or 生 base64 しか受け付けないため、
      // パスの場合は fetch + FileReader で data URL 化してから送る。
      let imageDataUrl = backgroundImage;
      if (!imageDataUrl.startsWith('data:')) {
        const blob = await fetch(imageDataUrl).then(r => r.blob());
        imageDataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }
      // submit→ブラウザ側ポーリング（本番60秒制限回避）
      const { imageBase64 } = await editBannerImage(imageDataUrl, instruction, formData, {});
      setBackgroundImage(`data:image/png;base64,${imageBase64}`);
      playChimeIfEnabled();
    } catch (e) {
      setError(e instanceof Error ? e.message : '通信エラーが発生しました');
    } finally {
      setIsEditing(false);
    }
  }, [backgroundImage, formData]);

  return {
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
  };
}
