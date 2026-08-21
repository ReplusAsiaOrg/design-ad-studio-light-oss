import { NextRequest, NextResponse } from 'next/server';
import { listSnapshots, loadSnapshot } from '@/lib/meta/store';
import { rankByCpa } from '@/lib/meta/analyze';
import { requireAuth, assertAccountAccess, filterByAccount } from '@/lib/auth/guard';

export const runtime = 'nodejs';

/**
 * ローカル保存済みデータからCPA順ランキングを返す（同期はしない・読み取りのみ）。
 * query: ?account=act_xxx（省略時は全アカウント）, ?minSpend=10000
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const sp = request.nextUrl.searchParams;
    const account = sp.get('account');
    const minSpend = Number(sp.get('minSpend') ?? '0') || 0;

    if (account) {
      const denied = assertAccountAccess(auth, account);
      if (denied) return denied;
    }
    const snaps = account
      ? [await loadSnapshot(account)].filter(Boolean)
      : filterByAccount(auth, await listSnapshots(), (s) => s.accountId);
    if (snaps.length === 0) {
      return NextResponse.json({ ok: false, error: '同期データがありません（先に /api/meta/sync を実行）' }, { status: 404 });
    }

    const groups = snaps.flatMap((s) => rankByCpa(s!, minSpend));
    return NextResponse.json({ ok: true, minSpend, groups });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ランキング生成に失敗しました';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
