import { NextRequest, NextResponse } from 'next/server';
import { listHistory } from '@/lib/generation-history';
import { requireAuth } from '@/lib/auth/guard';

export const runtime = 'nodejs';

/** 生成履歴の一覧（新しい順・最大100件）。 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const items = await listHistory(100);
    return NextResponse.json({ ok: true, items });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
