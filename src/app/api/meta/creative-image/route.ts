import { NextRequest, NextResponse } from 'next/server';
import { downloadAsBase64 } from '@/lib/meta/creatives';
import { requireAuth } from '@/lib/auth/guard';
import { isDemoLocalImageUrl } from '@/lib/demo/local-image';

export const runtime = 'nodejs';

/**
 * Phase 3 出口接続: 勝ちCR画像を data URL（base64）で返すプロキシ。
 * fbcdn画像はクライアントから直接 canvas 読み出し（CORS）できないため、
 * サーバ側でダウンロードして base64 にし、「勝ち分析再現」タブの imageBase64 に渡す。
 * body: { imageUrl: "https://...fbcdn..." }
 */
/** Meta CDN のみ許可（任意URLの中継＝オープンプロキシ/SSRFにしない）。 */
function isAllowedImageHost(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return /(^|\.)fbcdn\.net$|(^|\.)facebook\.com$|(^|\.)fbsbx\.com$/.test(host);
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const body = (await request.json().catch(() => ({}))) as { imageUrl?: string };
    const imageUrl = body.imageUrl;
    // デモモードのアプリ同梱画像（/demo/creatives/...）はそのまま通す
    const isDemoLocal = !!imageUrl && isDemoLocalImageUrl(imageUrl);
    if (!imageUrl || (!isDemoLocal && !/^https:\/\//.test(imageUrl))) {
      return NextResponse.json({ ok: false, error: 'imageUrl（https）を指定してください' }, { status: 400 });
    }
    if (!isDemoLocal && !isAllowedImageHost(imageUrl)) {
      return NextResponse.json({ ok: false, error: 'Meta CDN（fbcdn/facebook.com）以外のURLは取得できません' }, { status: 400 });
    }

    const dl = await downloadAsBase64(imageUrl);
    if ('error' in dl) {
      return NextResponse.json({ ok: false, error: `画像取得失敗: ${dl.error}` }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      dataUrl: `data:${dl.mimeType};base64,${dl.base64}`,
      mimeType: dl.mimeType,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '画像取得に失敗しました';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
