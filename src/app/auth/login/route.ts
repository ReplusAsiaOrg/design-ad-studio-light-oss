import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { supabaseAuthEnabled } from '@/lib/supabase/config';

export const runtime = 'nodejs';

/**
 * メール＋パスワードでログインし、セッション cookie を設定する（Issue #6）。
 * body: { email, password }
 */
export async function POST(request: NextRequest) {
  if (!supabaseAuthEnabled()) {
    return NextResponse.json({ ok: false, error: 'Supabase Auth が設定されていません' }, { status: 400 });
  }
  const body = await request.json().catch(() => ({}));
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!email || !password) {
    return NextResponse.json({ ok: false, error: 'メールアドレスとパスワードを入力してください' }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // 存在有無を漏らさないため詳細は返さない
    return NextResponse.json({ ok: false, error: 'メールアドレスまたはパスワードが違います' }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
