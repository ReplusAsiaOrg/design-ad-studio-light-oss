'use client';

import { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import { Stage, Layer, Image as KonvaImage, Rect, Line, Circle, Group, Shape } from 'react-konva';
import Konva from 'konva';
import { DesignPlan, DesignElement, AspectRatio, getBannerDimensions } from '@/lib/types';

interface Props {
  backgroundImage: string | null;
  designPlan: DesignPlan | null;
  aspectRatio: AspectRatio;
  customWidth?: number;
  customHeight?: number;
}

export interface BannerCanvasHandle {
  getStage: () => Konva.Stage | null;
}

/** テキスト幅を推定（全角≈fontSize、半角≈fontSize×0.55） */
function estimateTextWidth(text: string, fontSize: number, letterSpacing: number): number {
  let w = 0;
  for (const ch of text) {
    if (/[\u3000-\u9FFF\uF900-\uFAFF\uFF01-\uFF60\uFFE0-\uFFEF]/.test(ch)) {
      w += fontSize;
    } else {
      w += fontSize * 0.55;
    }
  }
  if (text.length > 1) {
    w += (text.length - 1) * letterSpacing;
  }
  return w;
}

/** 日本語の自然な区切り位置を見つける（助詞・句読点の直後） */
function findJapaneseBreakPoint(text: string, targetPos: number): number {
  // targetPos付近で、自然な区切り位置を探す（前後5文字の範囲）
  const searchRange = 5;
  const start = Math.max(0, targetPos - searchRange);
  const end = Math.min(text.length, targetPos + searchRange);

  // 助詞・接続助詞・句読点の直後を優先的に探す
  const breakAfterPattern = /[をにはがでとも・、。！？からまでよりへ]/;
  // 「から」「まで」「より」等の2文字助詞もチェック
  const twoCharBreaks = ['から', 'まで', 'より', 'など', 'して', 'った', 'って'];

  let bestBreak = targetPos;
  let bestDistance = searchRange + 1;

  for (let i = start; i < end; i++) {
    let isBreakPoint = false;

    // 2文字助詞の直後
    for (const tw of twoCharBreaks) {
      if (i >= tw.length - 1 && text.slice(i - tw.length + 1, i + 1) === tw) {
        isBreakPoint = true;
        break;
      }
    }

    // 1文字助詞・句読点の直後
    if (!isBreakPoint && breakAfterPattern.test(text[i])) {
      isBreakPoint = true;
    }

    if (isBreakPoint) {
      const breakPos = i + 1;
      const distance = Math.abs(breakPos - targetPos);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestBreak = breakPos;
      }
    }
  }

  return bestBreak;
}

/** 長いテキストをキャンバス幅に収まるよう自動で行分割（日本語区切り対応） */
function autoWrapText(text: string, fontSize: number, letterSpacing: number, maxWidth: number): string[] {
  // ユーザーが入力欄で手動改行（\n）した場合はその位置を必ず尊重し、
  // 各セグメントが幅オーバーしている時だけ自動折り返しを追加で適用する。
  const manualLines = text.split('\n');
  const result: string[] = [];
  for (const segment of manualLines) {
    if (!segment) {
      result.push('');
      continue;
    }
    const totalW = estimateTextWidth(segment, fontSize, letterSpacing);
    if (totalW <= maxWidth) {
      result.push(segment);
      continue;
    }
    const numLines = Math.ceil(totalW / maxWidth);
    const charsPerLine = Math.ceil(segment.length / numLines);
    let remaining = segment;
    for (let i = 0; i < numLines - 1; i++) {
      const breakPos = findJapaneseBreakPoint(remaining, charsPerLine);
      result.push(remaining.slice(0, breakPos));
      remaining = remaining.slice(breakPos);
    }
    if (remaining) result.push(remaining);
  }
  return result;
}

/** テキストがキャンバス幅に収まるようfontSizeを縮小 */
function fitFontSize(text: string, baseFontSize: number, letterSpacing: number, maxWidth: number): number {
  let fs = baseFontSize;
  while (fs > 16 && estimateTextWidth(text, fs, letterSpacing) > maxWidth) {
    fs -= 2;
  }
  return fs;
}

/** 1文字ずつ描画（letterSpacing対応） */
function drawTextWithSpacing(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  letterSpacing: number,
  mode: 'fill' | 'stroke' | 'both'
) {
  // letterSpacingが0なら標準描画（文字幅推定の誤差を回避）
  if (letterSpacing <= 0) {
    if (mode === 'fill' || mode === 'both') ctx.fillText(text, x, y);
    if (mode === 'stroke' || mode === 'both') ctx.strokeText(text, x, y);
    return;
  }
  let curX = x;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (mode === 'fill' || mode === 'both') ctx.fillText(ch, curX, y);
    if (mode === 'stroke' || mode === 'both') ctx.strokeText(ch, curX, y);
    // 文字幅を実測
    const charWidth = ctx.measureText(ch).width;
    curX += charWidth + letterSpacing;
  }
}

const FONT_FAMILY = '"Noto Sans JP", "Hiragino Kaku Gothic ProN", sans-serif';

const BannerCanvas = forwardRef<BannerCanvasHandle, Props>(
  function BannerCanvas({ backgroundImage, designPlan, aspectRatio, customWidth, customHeight }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const stageRef = useRef<Konva.Stage>(null);
    const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
    const [containerWidth, setContainerWidth] = useState(800);

    const dims = getBannerDimensions({ aspectRatio, customWidth, customHeight });
    const scale = containerWidth / dims.width;
    const stageWidth = containerWidth;
    const stageHeight = dims.height * scale;

    useImperativeHandle(ref, () => ({
      getStage: () => stageRef.current,
    }));

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      setContainerWidth(container.clientWidth);
      const observer = new ResizeObserver(entries => {
        for (const entry of entries) {
          setContainerWidth(entry.contentRect.width);
        }
      });
      observer.observe(container);
      return () => observer.disconnect();
    }, []);

    useEffect(() => {
      if (!backgroundImage) {
        setBgImage(null);
        return;
      }
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => setBgImage(img);
      img.src = backgroundImage;
    }, [backgroundImage]);

    const renderElement = (el: DesignElement) => {
      const isHeadline = el.fontSize >= 60;
      // ヘッドラインは88%幅、それ以外は90%幅でフォントサイズ縮小
      const maxTextWidth = stageWidth * (isHeadline ? 0.88 : 0.90);

      // ヘッドラインのみ自動折り返し、サブテキストは1行のまま自動縮小（ただし手動改行は尊重）
      const lines = isHeadline
        ? autoWrapText(el.text, el.fontSize * scale, el.letterSpacing * scale, maxTextWidth)
        : el.text.split('\n');

      const baseFsScaled = el.fontSize * scale;
      const fittedFs = lines.reduce((minFs, line) => {
        return Math.min(minFs, fitFontSize(line, baseFsScaled, el.letterSpacing * scale, maxTextWidth));
      }, baseFsScaled);

      const fs = fittedFs;
      const ls = el.letterSpacing * scale;
      const sw = el.strokeWidth * scale;
      const lineHeight = fs * 1.3;
      const totalTextHeight = lineHeight * lines.length;

      // デコレーション用の寸法計算（1行目ベース）
      const firstLineTw = estimateTextWidth(lines[0], fs, ls);
      const padX = fs * 1.2;
      const padY = fs * 0.35;

      return (
        <Group
          key={el.id}
          x={el.x * scale}
          y={el.y * scale}
          rotation={el.rotation}
        >
          {/* === デコレーション === */}
          {el.decoration === 'ribbon' && (() => {
            const tw = firstLineTw;
            const halfW = tw / 2 + padX;
            const halfH = fs * 1.2 / 2 + padY;
            return (
              <Line
                points={[
                  -(halfW + fs * 0.3), 0,
                  -halfW, -halfH,
                  halfW, -halfH,
                  halfW + fs * 0.3, 0,
                  halfW, halfH,
                  -halfW, halfH,
                ]}
                closed fill={el.decorationColor}
                stroke={adjustColor(el.decorationColor, -40)}
                strokeWidth={2.5 * scale}
                shadowEnabled shadowColor="rgba(0,0,0,0.4)"
                shadowBlur={8 * scale} shadowOffsetY={4 * scale}
              />
            );
          })()}

          {el.decoration === 'highlight' && (() => {
            const tw = firstLineTw;
            const halfW = tw / 2 + padX;
            const halfH = fs * 1.2 / 2 + padY;
            return (
              <Rect
                x={-halfW} y={-halfH}
                width={halfW * 2} height={halfH * 2}
                fill={el.decorationColor}
                cornerRadius={halfH}
              />
            );
          })()}

          {el.decoration === 'arrow' && (() => {
            const tw = firstLineTw;
            const halfW = tw / 2 + padX;
            const halfH = fs * 1.2 / 2 + padY;
            return (
              <Line
                points={[
                  -halfW - fs * 0.1, -halfH,
                  halfW, -halfH,
                  halfW + fs * 0.5, 0,
                  halfW, halfH,
                  -halfW - fs * 0.1, halfH,
                  -halfW + fs * 0.2, 0,
                ]}
                closed fill={el.decorationColor}
                stroke={adjustColor(el.decorationColor, -40)}
                strokeWidth={2.5 * scale}
                shadowEnabled shadowColor="rgba(0,0,0,0.4)"
                shadowBlur={8 * scale} shadowOffsetY={4 * scale}
              />
            );
          })()}

          {el.decoration === 'badge' && (
            <Circle
              x={0} y={0}
              radius={Math.max(firstLineTw, totalTextHeight) / 2 + padX * 1.3}
              fill={el.decorationColor}
              stroke={adjustColor(el.decorationColor, -40)}
              strokeWidth={3 * scale}
              shadowEnabled shadowColor="rgba(0,0,0,0.4)"
              shadowBlur={8 * scale} shadowOffsetY={4 * scale}
            />
          )}

          {el.decoration === 'circle' && (
            <Circle
              x={0} y={0}
              radius={Math.max(firstLineTw, totalTextHeight) / 2 + padX}
              stroke={el.decorationColor}
              strokeWidth={4 * scale}
            />
          )}

          {/* === テキスト描画（Shape + ネイティブCanvas API） === */}
          <Shape
            sceneFunc={(context) => {
              const ctx = context._context as CanvasRenderingContext2D;
              ctx.save();
              const weight = el.fontWeight === 'bold' ? 700 : 400;
              ctx.font = `${weight} ${fs}px ${FONT_FAMILY}`;
              ctx.textBaseline = 'middle';
              ctx.lineJoin = 'round';
              ctx.miterLimit = 2;

              lines.forEach((lineText, lineIdx) => {
                // letterSpacing 0 ならmeasureTextで正確な幅を取得
                const tw = ls > 0 ? estimateTextWidth(lineText, fs, ls) : ctx.measureText(lineText).width;
                const lineY = (lineIdx - (lines.length - 1) / 2) * lineHeight;
                const startX = -tw / 2;

                if (el.stroke) {
                  // ドロップシャドウ（最背面）
                  if (el.shadow) {
                    ctx.save();
                    ctx.shadowColor = el.shadowColor;
                    ctx.shadowBlur = 12 * scale;
                    ctx.shadowOffsetX = 3 * scale;
                    ctx.shadowOffsetY = 5 * scale;
                    ctx.lineWidth = sw * 3.5;
                    ctx.strokeStyle = adjustColor(el.strokeColor, -80);
                    drawTextWithSpacing(ctx, lineText, startX, lineY, fs, ls, 'stroke');
                    ctx.restore();
                  }

                  // レイヤー1: 最外殻（暗い太いアウトライン）
                  ctx.lineWidth = sw * 3;
                  ctx.strokeStyle = adjustColor(el.strokeColor, -60);
                  drawTextWithSpacing(ctx, lineText, startX, lineY, fs, ls, 'stroke');

                  // レイヤー2: 白アウトライン
                  ctx.lineWidth = sw * 1.8;
                  ctx.strokeStyle = '#ffffff';
                  drawTextWithSpacing(ctx, lineText, startX, lineY, fs, ls, 'stroke');

                  // レイヤー3: テキスト塗り
                  ctx.fillStyle = el.color;
                  drawTextWithSpacing(ctx, lineText, startX, lineY, fs, ls, 'fill');
                } else {
                  // ストロークなしのテキスト（装飾あり要素など）
                  if (el.shadow) {
                    ctx.shadowColor = el.shadowColor;
                    ctx.shadowBlur = 8 * scale;
                    ctx.shadowOffsetX = 2 * scale;
                    ctx.shadowOffsetY = 3 * scale;
                  }
                  ctx.fillStyle = el.color;
                  drawTextWithSpacing(ctx, lineText, startX, lineY, fs, ls, 'fill');
                }
              });

              ctx.restore();
            }}
          />
        </Group>
      );
    };

    return (
      <div ref={containerRef} className="w-full relative">
        <Stage
          ref={stageRef}
          width={stageWidth}
          height={stageHeight}
          style={{ borderRadius: '12px', overflow: 'hidden' }}
        >
          <Layer>
            <Rect width={stageWidth} height={stageHeight} fill="#f0f0f0" />
            {bgImage && (() => {
              const imgRatio = bgImage.naturalWidth / bgImage.naturalHeight;
              const stageRatio = stageWidth / stageHeight;
              let drawW: number, drawH: number, drawX: number, drawY: number;
              if (imgRatio > stageRatio) {
                drawH = stageHeight;
                drawW = stageHeight * imgRatio;
                drawX = (stageWidth - drawW) / 2;
                drawY = 0;
              } else {
                drawW = stageWidth;
                drawH = stageWidth / imgRatio;
                drawX = 0;
                drawY = (stageHeight - drawH) / 2;
              }
              return (
                <KonvaImage image={bgImage} x={drawX} y={drawY} width={drawW} height={drawH} />
              );
            })()}
            {designPlan?.elements.map(renderElement)}
          </Layer>
        </Stage>

        {!backgroundImage && !designPlan && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <div className="text-4xl mb-3 opacity-30">🎨</div>
              <p className="text-gray-400 text-base font-medium">テキストを入力して「バナーを生成」</p>
              <p className="text-gray-300 text-sm mt-1">AIが背景もテキストデザインも自動で作ります</p>
            </div>
          </div>
        )}
      </div>
    );
  }
);

function adjustColor(color: string, delta: number): string {
  const rgbaMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbaMatch) {
    const r = Math.max(0, Math.min(255, parseInt(rgbaMatch[1]) + delta));
    const g = Math.max(0, Math.min(255, parseInt(rgbaMatch[2]) + delta));
    const b = Math.max(0, Math.min(255, parseInt(rgbaMatch[3]) + delta));
    return `rgb(${r},${g},${b})`;
  }
  const hex = color.replace('#', '');
  if (hex.length === 6) {
    const r = Math.max(0, Math.min(255, parseInt(hex.slice(0, 2), 16) + delta));
    const g = Math.max(0, Math.min(255, parseInt(hex.slice(2, 4), 16) + delta));
    const b = Math.max(0, Math.min(255, parseInt(hex.slice(4, 6), 16) + delta));
    return `rgb(${r},${g},${b})`;
  }
  return color;
}

export default BannerCanvas;
