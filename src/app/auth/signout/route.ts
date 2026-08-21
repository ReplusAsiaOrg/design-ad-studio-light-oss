import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { supabaseAuthEnabled } from '@/lib/supabase/config';

export const runtime = 'nodejs';

/** ログアウト（セッション cookie を破棄）。クライアントは成功後 /login へ遷移する */
export async function POST() {
  if (!supabaseAuthEnabled()) {
    return NextResponse.json({ ok: false, error: 'Supabase Auth が設定されていません' }, { status: 400 });
  }
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
