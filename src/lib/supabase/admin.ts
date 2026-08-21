import { createClient } from '@supabase/supabase-js';
import { getSupabaseUrl } from './config';

/**
 * ユーザー作成・削除・パスワード再発行（Supabase Auth Admin API）用のキー（Issue #10）。
 * 管理画面のユーザー管理を使う環境（本番Cloud Run含む）にはこのキーの設定が必要。
 * 🔐 Secret Manager / .env.local 管理。ブラウザには渡さない。
 */
export function hasServiceRoleKey(): boolean {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim() !== '';
}

/** Auth Admin API クライアント。キー未設定時は throw（呼び出し側で hasServiceRoleKey() を確認） */
export function createSupabaseAdminClient() {
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY が未設定です（ユーザーの作成・削除・パスワード再発行に必要）');
  return createClient(getSupabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
