import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { imagePathOf } from '@/lib/generation-history';
import { requireAuth } from '@/lib/auth/guard';

export const runtime = 'nodejs';

/** 生成履歴のサムネイル画像を返す（data/generated/images/<id>.png）。 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const id = request.nextUrl.searchParams.get('id') ?? '';
    const buf = await fs.readFile(imagePathOf(id));
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: '画像が見つかりません' }, { status: 404 });
  }
}
