import { NextRequest, NextResponse } from 'next/server';
import { fetchVideoSource } from '@/lib/meta/client';
import { requireAuth } from '@/lib/auth/guard';

export const runtime = 'nodejs';

/**
 * 動画クリエイティブの再生用ソースURLを返す。
 * ギャラリーのカードをクリックした時にだけ呼ぶ（ソースURLは時間制限つきのため遅延取得）。
 * query: ?videoId=xxxx
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const videoId = request.nextUrl.searchParams.get('videoId');
  if (!videoId) return NextResponse.json({ ok: false, error: 'videoId がありません' }, { status: 400 });
  try {
    const { source, permalink } = await fetchVideoSource(videoId);
    if (!source) {
      return NextResponse.json(
        { ok: false, error: 'この動画の再生ソースを取得できませんでした（権限/失効の可能性）', permalink },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, source, permalink });
  } catch (error) {
    const message = error instanceof Error ? error.message : '動画取得に失敗しました';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
