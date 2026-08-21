import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { supabaseAuthEnabled } from '@/lib/supabase/config';
import { hasDb, q } from '@/lib/db/client';

/**
 * API 層のテナントスコープ強制（Issue #8, #9）。
 *
 * 規約: /api/meta/* の全ルートは、DB・Meta API に触れる前に必ず
 *   requireAuth() / requireAdmin() を通し、アカウント指定があれば
 *   assertAccountAccess()（一覧系は filterByAccount()）を適用する。
 * 新ルートを追加する時もこのヘルパーを経由すること（直接 store/q を叩かない）。
 */
export interface AuthContext {
  /** legacy=Basic認証フォールバック / cron=CRON_SECRET Bearer / supabase=通常ログイン */
  mode: 'legacy' | 'cron' | 'supabase';
  userId: string | null;
  email: string | null;
  role: 'admin' | 'member';
  /** 'all'（admin・legacy・cron）または member の許可 account_id 集合 */
  allowedAccounts: 'all' | Set<string>;
}

const FULL_ACCESS = {
  userId: null,
  email: null,
  role: 'admin' as const,
  allowedAccounts: 'all' as const,
};

/**
 * リクエストの認証コンテキストを解決する。未認証なら null。
 * - Supabase 未設定（ローカル・移行前）: Basic 認証（middleware）前提の全権限
 * - Bearer CRON_SECRET: Cloud Scheduler 等のジョブ。管理者相当
 */
export async function getAuthContext(request?: NextRequest): Promise<AuthContext | null> {
  const cronSecret = (process.env.CRON_SECRET ?? '').trim();
  const authHeader = request?.headers.get('authorization');
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return { mode: 'cron', ...FULL_ACCESS };
  }
  if (!supabaseAuthEnabled()) {
    return { mode: 'legacy', ...FULL_ACCESS };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  let role: 'admin' | 'member' = 'member';
  // DB無し（fsモード）でSupabase Authだけ有効な場合、テナント表が無いため member は空スコープになる
  let allowed: 'all' | Set<string> = new Set<string>();
  if (hasDb()) {
    const rows = await q<{ role: string }>('SELECT role FROM app_users WHERE user_id = $1', [user.id]);
    if (rows[0]?.role === 'admin') role = 'admin';
    if (role === 'admin') {
      allowed = 'all';
    } else {
      const accts = await q<{ account_id: string }>(
        `SELECT DISTINCT ta.account_id
         FROM user_tenants ut
         JOIN tenant_accounts ta ON ta.tenant_id = ut.tenant_id
         WHERE ut.user_id = $1`,
        [user.id],
      );
      allowed = new Set(accts.map((r) => r.account_id));
    }
  }
  return { mode: 'supabase', userId: user.id, email: user.email ?? null, role, allowedAccounts: allowed };
}

/** 認証必須。未認証なら 401 の NextResponse を返す（呼び出し側で instanceof NextResponse チェック） */
export async function requireAuth(request?: NextRequest): Promise<AuthContext | NextResponse> {
  const ctx = await getAuthContext(request);
  if (!ctx) return NextResponse.json({ ok: false, error: 'ログインが必要です' }, { status: 401 });
  return ctx;
}

/** 管理者必須（アカウント登録・同期・評価設定の変更・分類実行など運用系操作） */
export async function requireAdmin(request?: NextRequest): Promise<AuthContext | NextResponse> {
  const ctx = await requireAuth(request);
  if (ctx instanceof NextResponse) return ctx;
  if (ctx.role !== 'admin') {
    return NextResponse.json({ ok: false, error: 'この操作には管理者権限が必要です' }, { status: 403 });
  }
  return ctx;
}

export function canAccessAccount(ctx: AuthContext, accountId: string): boolean {
  return ctx.allowedAccounts === 'all' || ctx.allowedAccounts.has(accountId);
}

/** アカウント指定型API用。権限外なら 403 の NextResponse、OKなら null */
export function assertAccountAccess(ctx: AuthContext, accountId: string): NextResponse | null {
  if (canAccessAccount(ctx, accountId)) return null;
  return NextResponse.json(
    { ok: false, error: `このアカウントへのアクセス権がありません: ${accountId}` },
    { status: 403 },
  );
}

/** 一覧系API用。返却リストを許可アカウントのみに絞る */
export function filterByAccount<T>(ctx: AuthContext, list: T[], getId: (item: T) => string): T[] {
  if (ctx.allowedAccounts === 'all') return list;
  const allowed = ctx.allowedAccounts;
  return list.filter((item) => allowed.has(getId(item)));
}
