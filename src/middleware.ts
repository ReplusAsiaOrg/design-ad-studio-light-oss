import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseUrl, getSupabaseAnonKey, supabaseAuthEnabled } from '@/lib/supabase/config';

/**
 * Supabase Auth モード（Issue #6）: セッション検証＋トークンリフレッシュ。
 * 未ログインはページ→/login リダイレクト・API→401。/login と /auth/* は素通し。
 */
async function supabaseGuard(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // @supabase/ssr 標準パターン: リフレッシュされたトークンを request/response 両方の cookie に反映
  let response = NextResponse.next({ request });
  const supabase = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // リダイレクト時もリフレッシュ済み cookie を落とさない
  const redirectTo = (path: string) => {
    const res = NextResponse.redirect(new URL(path, request.url));
    response.cookies.getAll().forEach((c) => res.cookies.set(c));
    return res;
  };

  const isAuthPath = pathname === '/login' || pathname.startsWith('/auth/');
  if (user && pathname === '/login') return redirectTo('/');
  if (!user && !isAuthPath) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ ok: false, error: 'ログインが必要です' }, { status: 401 });
    }
    return redirectTo('/login');
  }
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 静的ファイルはスキップ
  if (pathname.startsWith('/_next/') || pathname === '/favicon.ico') {
    return NextResponse.next();
  }

  // CSRF対策: 悪意ある外部サイトからの cross-origin リクエストで
  // 同期の乱発・生成API課金を発火させない（text/plain の simple request は preflight されない）
  if ((pathname.startsWith('/api/') || pathname.startsWith('/auth/')) && request.method !== 'GET') {
    const origin = request.headers.get('origin');
    if (origin) {
      try {
        const originHost = new URL(origin).host;
        const host = request.headers.get('host');
        if (!host || originHost !== host) {
          return new NextResponse('Cross-origin request blocked', { status: 403 });
        }
      } catch {
        return new NextResponse('Invalid origin', { status: 403 });
      }
    }
  }

  // Cloud Scheduler / Cron（Authorization: Bearer CRON_SECRET）は認証を通す。
  // 認可の実体は各ルート側でCRON_SECRETを再検証する
  const cronSecret = (process.env.CRON_SECRET ?? '').trim();
  if (cronSecret && request.headers.get('authorization') === `Bearer ${cronSecret}`) {
    return NextResponse.next();
  }

  // Supabase Auth モード（SUPABASE_URL + SUPABASE_ANON_KEY 設定時）。Basic 認証を置き換える
  if (supabaseAuthEnabled()) {
    return supabaseGuard(request);
  }

  // ---- 以下、従来の Basic 認証（Supabase 未設定時のフォールバック） ----

  // 環境変数の前後空白・改行を吸収（Vercel 等で誤って末尾改行が混入したケースを救う）
  const validUser = (process.env.BASIC_AUTH_USER ?? 'admin').trim();
  const validPass = (process.env.BASIC_AUTH_PASS ?? '').trim();

  // パスワード未設定なら Basic 認証を無効化（ローカル運用ではこれが既定）。
  // 将来デプロイする際は BASIC_AUTH_PASS を設定すれば自動的に認証が復活する。
  // ページだけでなく /api/（広告実数値の閲覧・生成APIの課金）も同じ認証で守る。
  if (validPass === '') {
    return NextResponse.next();
  }

  const authHeader = request.headers.get('authorization');

  if (authHeader) {
    const [scheme, encoded] = authHeader.split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = atob(encoded);
      const [user, pass] = decoded.split(':');

      if (user === validUser && pass === validPass) {
        return NextResponse.next();
      }
    }
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Ad Studio Light"',
    },
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
