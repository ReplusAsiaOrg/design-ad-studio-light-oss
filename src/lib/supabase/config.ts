// Supabase Auth の有効判定と接続情報（Issue #6）。
// URL・キーはサーバー側 env のみ参照する（NEXT_PUBLIC_ のビルド時インライン焼き込みに依存しない。
// ログイン処理は /auth/login Route Handler 経由なのでブラウザにキーを渡す必要がない＝
// Cloud Run のランタイム env だけで動く）。
export function getSupabaseUrl(): string {
  return (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
}

export function getSupabaseAnonKey(): string {
  return (
    process.env.SUPABASE_ANON_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    ''
  ).trim();
}

/**
 * Supabase Auth モードか。false なら従来の Basic 認証で動く（段階移行用フォールバック。
 * SUPABASE_URL と SUPABASE_ANON_KEY を設定すると自動的に Supabase Auth に切り替わる）。
 */
export function supabaseAuthEnabled(): boolean {
  return getSupabaseUrl() !== '' && getSupabaseAnonKey() !== '';
}
