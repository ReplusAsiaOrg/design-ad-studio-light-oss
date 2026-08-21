import { NextRequest, NextResponse } from 'next/server';
import { fetchAvailableAdAccounts, MetaGraphError } from '@/lib/meta/client';
import { listRegisteredAccounts } from '@/lib/meta/account-registry';
import { requireAdmin } from '@/lib/auth/guard';

export const runtime = 'nodejs';
// 100件超のアカウント一覧取得（ページネーションあり）のため余裕を持たせる
export const maxDuration = 60;

/**
 * トークンで見える全広告アカウント（追加候補）を取得。
 * 登録済みかどうかのフラグ付きで返す。管理画面の「アカウントを追加」で使う。
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (auth instanceof NextResponse) return auth;
    const [available, registered] = await Promise.all([
      fetchAvailableAdAccounts(),
      listRegisteredAccounts(),
    ]);
    const registeredIds = new Set(registered.map((a) => a.accountId));
    const accounts = available.map((a) => ({
      accountId: a.id,
      name: a.name ?? '(no name)',
      accountStatus: a.account_status,
      currency: a.currency,
      amountSpent: a.amount_spent,
      businessName: a.business?.name,
      registered: registeredIds.has(a.id),
    }));
    // アクティブ→名前順で見やすく
    accounts.sort((x, y) => {
      const ax = x.accountStatus === 1 ? 0 : 1;
      const ay = y.accountStatus === 1 ? 0 : 1;
      if (ax !== ay) return ax - ay;
      return (x.name ?? '').localeCompare(y.name ?? '', 'ja');
    });
    return NextResponse.json({ ok: true, accounts });
  } catch (error) {
    if (error instanceof MetaGraphError && error.status === 0) {
      return NextResponse.json(
        { ok: false, error: 'META_ACCESS_TOKEN が未設定です。.env.local に設定してください（西川さんから受領後）' },
        { status: 503 },
      );
    }
    const message = error instanceof Error ? error.message : 'アカウント一覧の取得に失敗しました';
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
