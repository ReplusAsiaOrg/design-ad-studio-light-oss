import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseUrl, getSupabaseAnonKey } from './config';

/**
 * Route Handler / Server Component 用の Supabase クライアント（cookie セッション）。
 * 呼び出し前に supabaseAuthEnabled() で有効判定すること。
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Component からの呼び出しでは cookie を書けない（セッション更新は middleware が担う）
        }
      },
    },
  });
}
