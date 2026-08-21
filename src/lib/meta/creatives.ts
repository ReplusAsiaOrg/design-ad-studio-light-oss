import { fetchCreatives, type MetaCreative } from './client';
import { isDemoLocalImageUrl, readDemoLocalImage } from '../demo/local-image';

/**
 * Phase 2: 勝ち/負けクリエイティブの実画像を取得する。
 *   - 画像CR: image_url を使う
 *   - 動画CR: image_url が無いので thumbnail_url（サムネ）を使う
 * vision分類に渡す base64 にして返す。
 */

export interface CreativeMedia {
  creativeId: string;
  objectType?: string;
  /** 実際に取得に使ったURL（image_url 優先、無ければ thumbnail_url）。 */
  imageUrl?: string;
  isVideo: boolean;
  /** data URLプレフィックス無しの base64。取得失敗時 null。 */
  base64: string | null;
  mimeType: string;
  error?: string;
}

export async function downloadAsBase64(
  url: string,
): Promise<{ base64: string; mimeType: string } | { error: string }> {
  // デモモードのアプリ同梱画像（/demo/...）はファイルから読む
  if (isDemoLocalImageUrl(url)) return readDemoLocalImage(url);
  try {
    const res = await fetch(url);
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const mimeType = res.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg';
    const buf = Buffer.from(await res.arrayBuffer());
    return { base64: buf.toString('base64'), mimeType };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'download failed' };
  }
}

function pickUrl(c: MetaCreative): { url?: string; isVideo: boolean } {
  const isVideo = c.object_type === 'VIDEO' || !!c.video_id;
  // 静止画は image_url、動画はサムネ。どちらも無ければ thumbnail_url に頼る。
  const url = c.image_url || c.thumbnail_url;
  return { url, isVideo };
}

/**
 * creativeId配列 → 実画像base64マップ。
 * Meta APIのcreative取得（メタ）と画像CDNダウンロードを行う。
 */
export async function fetchCreativeMedia(creativeIds: string[]): Promise<Record<string, CreativeMedia>> {
  const uniq = [...new Set(creativeIds.filter(Boolean))];
  const creatives = await fetchCreatives(uniq);

  const out: Record<string, CreativeMedia> = {};
  for (const id of uniq) {
    const c = creatives[id];
    if (!c) {
      out[id] = { creativeId: id, isVideo: false, base64: null, mimeType: 'image/jpeg', error: 'creative not found' };
      continue;
    }
    const { url, isVideo } = pickUrl(c);
    if (!url) {
      out[id] = { creativeId: id, objectType: c.object_type, isVideo, base64: null, mimeType: 'image/jpeg', error: 'no image_url/thumbnail_url' };
      continue;
    }
    const dl = await downloadAsBase64(url);
    if ('error' in dl) {
      out[id] = { creativeId: id, objectType: c.object_type, imageUrl: url, isVideo, base64: null, mimeType: 'image/jpeg', error: dl.error };
      continue;
    }
    out[id] = {
      creativeId: id,
      objectType: c.object_type,
      imageUrl: url,
      isVideo,
      base64: dl.base64,
      mimeType: dl.mimeType,
    };
  }
  return out;
}
