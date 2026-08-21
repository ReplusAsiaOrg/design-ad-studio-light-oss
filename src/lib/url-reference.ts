import * as cheerio from 'cheerio';

const FETCH_TIMEOUT_MS = 10000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BannerGenerator/1.0)',
        ...(init?.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

function resolveImageUrl(src: string, base: URL): string | null {
  if (!src) return null;
  if (src.startsWith('data:')) return null;
  try {
    if (src.startsWith('//')) return 'https:' + src;
    if (src.startsWith('http')) return src;
    return new URL(src, base.toString()).toString();
  } catch {
    return null;
  }
}

async function pickReferenceImageUrl(pageUrl: URL): Promise<string | null> {
  const res = await fetchWithTimeout(pageUrl.toString(), {
    headers: { Accept: 'text/html,application/xhtml+xml' },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const $ = cheerio.load(html);

  // 1. og:image を最優先
  const ogImage = $('meta[property="og:image"]').attr('content')
    || $('meta[name="og:image"]').attr('content')
    || $('meta[name="twitter:image"]').attr('content');
  const ogResolved = ogImage ? resolveImageUrl(ogImage, pageUrl) : null;
  if (ogResolved) return ogResolved;

  // 2. ヒーロー画像（ページ冒頭のサイズ大きめimg）
  const $body = $('main, article, [role="main"], .main, #main, body').first();
  let picked: string | null = null;
  $body.find('img').each((_, el) => {
    if (picked) return false;
    const src = $(el).attr('src') || $(el).attr('data-src') || '';
    const width = parseInt($(el).attr('width') || '0', 10);
    const height = parseInt($(el).attr('height') || '0', 10);
    if ((width > 0 && width < 100) || (height > 0 && height < 100)) return;
    if (src.endsWith('.svg')) return;
    const resolved = resolveImageUrl(src, pageUrl);
    if (resolved) picked = resolved;
  });
  return picked;
}

async function downloadImageAsDataUrl(imageUrl: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(imageUrl);
    if (!res.ok) return null;
    const contentType = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
    if (!contentType.startsWith('image/')) return null;
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > MAX_IMAGE_BYTES) return null;
    const base64 = Buffer.from(buffer).toString('base64');
    return `data:${contentType};base64,${base64}`;
  } catch {
    return null;
  }
}

/**
 * 参照URL（LP等）からデザインテイストの参照画像を1枚取得し、data URL として返す。
 * og:image を最優先、無ければページ冒頭のヒーロー画像を使用する。
 * 取得できなければ null。
 */
export async function fetchReferenceImageFromUrl(url: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  } catch {
    return null;
  }

  const imageUrl = await pickReferenceImageUrl(parsed);
  if (!imageUrl) return null;
  return await downloadImageAsDataUrl(imageUrl);
}
