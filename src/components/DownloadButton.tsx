'use client';

import { useState, useEffect } from 'react';
import { getBannerDimensions, AspectRatio } from '@/lib/types';
import { BannerCanvasHandle } from './BannerCanvas';

interface Props {
  canvasRef: React.RefObject<BannerCanvasHandle | null>;
  aspectRatio: AspectRatio;
  customWidth?: number;
  customHeight?: number;
  disabled?: boolean;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function dataURLToBytes(dataURL: string): number {
  const base64 = dataURL.split(',')[1];
  if (!base64) return 0;
  const padding = (base64.match(/=+$/) || [''])[0].length;
  return Math.ceil((base64.length * 3) / 4) - padding;
}

function triggerDownload(dataURL: string, filename: string) {
  const link = document.createElement('a');
  link.download = filename;
  link.href = dataURL;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export default function DownloadButton({ canvasRef, aspectRatio, customWidth, customHeight, disabled }: Props) {
  const [compressedSize, setCompressedSize] = useState<string | null>(null);

  useEffect(() => {
    setCompressedSize(null);
  }, [aspectRatio]);

  const getExportContext = () => {
    const stage = canvasRef.current?.getStage();
    if (!stage) return null;
    const dims = getBannerDimensions({ aspectRatio, customWidth, customHeight });
    const ratio = dims.width / stage.width();
    return { stage, dims, ratio };
  };

  const handleDownload = () => {
    const ctx = getExportContext();
    if (!ctx) return;

    const dataURL = ctx.stage.toDataURL({
      pixelRatio: ctx.ratio,
      mimeType: 'image/jpeg',
      quality: 0.92,
    });

    setCompressedSize(formatFileSize(dataURLToBytes(dataURL)));
    triggerDownload(dataURL, `banner_${ctx.dims.width}x${ctx.dims.height}_${Date.now()}.jpg`);
  };

  const handleDownloadOriginal = () => {
    const ctx = getExportContext();
    if (!ctx) return;

    const dataURL = ctx.stage.toDataURL({
      pixelRatio: ctx.ratio,
      mimeType: 'image/png',
    });

    triggerDownload(dataURL, `banner_${ctx.dims.width}x${ctx.dims.height}_${Date.now()}.png`);
  };

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleDownload}
        disabled={disabled}
        className="flex items-center gap-2 px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        ダウンロード
        {compressedSize && <span className="ml-1 text-xs text-gray-400">({compressedSize})</span>}
      </button>
      <button
        onClick={handleDownloadOriginal}
        disabled={disabled}
        className="text-xs text-gray-500 hover:text-gray-700 underline disabled:opacity-30 disabled:cursor-not-allowed"
      >
        元画像(PNG)
      </button>
    </div>
  );
}
