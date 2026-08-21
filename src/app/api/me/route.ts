import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/guard';
import { isDemoMode } from '@/lib/demo/mode';

export const runtime = 'nodejs';

/**
 * ログイン中ユーザーの情報（UIの出し分け用。Issue #9）。
 * mode: 'legacy' なら Basic 認証フォールバック中（＝全機能表示・ログアウト非表示）
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({
    ok: true,
    mode: auth.mode,
    email: auth.email,
    role: auth.role,
    isAdmin: auth.role === 'admin',
    /** デモモード（架空データ・Meta API未接続）。UIにバッジを出す */
    demo: isDemoMode(),
  });
}
