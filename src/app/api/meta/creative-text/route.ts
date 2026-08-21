import { NextRequest, NextResponse } from 'next/server';
import { fetchCreativeText } from '@/lib/meta/client';
import { requireAuth } from '@/lib/auth/guard';

export const runtime = 'nodejs';

/**
 * クリエイティブの広告テキスト（本文/見出し/説明/CTA）を返す。
 * モーダルを開いた時にだけ呼ぶ。Advantage+ はテキスト違いが配列で返る。
 * query: ?creativeId=xxxx
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const creativeId = request.nextUrl.searchParams.get('creativeId');
  if (!creativeId) return NextResponse.json({ ok: false, error: 'creativeId がありません' }, { status: 400 });
  try {
    const text = await fetchCreativeText(creativeId);
    return NextResponse.json({ ok: true, ...text });
  } catch (error) {
    const message = error instanceof Error ? error.message : '広告テキスト取得に失敗しました';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
