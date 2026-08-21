import { promises as fs } from 'fs';
import path from 'path';

/**
 * デモモードのクリエイティブ画像はアプリ同梱（public/demo/creatives/）で、
 * URLは "/demo/creatives/xxx.png" のようなアプリ内相対パス。
 * サーバー側で base64 が必要な処理（vision分類・勝ち分析再現の画像取り込み）は
 * fetch ではなくファイルから読む。
 */
export function isDemoLocalImageUrl(url: string): boolean {
  return /^\/demo\/[A-Za-z0-9_\-/.]+\.(png|jpe?g|webp)$/.test(url) && !url.includes('..');
}

export async function readDemoLocalImage(url: string): Promise<{ base64: string; mimeType: string } | { error: string }> {
  if (!isDemoLocalImageUrl(url)) return { error: 'デモ画像のパスではありません' };
  const file = path.join(process.cwd(), 'public', url);
  try {
    const buf = await fs.readFile(file);
    const ext = path.extname(file).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    return { base64: buf.toString('base64'), mimeType };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'read failed' };
  }
}
