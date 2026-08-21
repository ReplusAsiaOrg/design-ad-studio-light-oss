import { NextRequest, NextResponse } from 'next/server';
import {
  listRegisteredAccounts,
  addAccount,
  updateAccount,
  removeAccount,
} from '@/lib/meta/account-registry';
import { listSnapshots } from '@/lib/meta/store';
import { requireAuth, requireAdmin, filterByAccount } from '@/lib/auth/guard';

export const runtime = 'nodejs';

/**
 * 登録済みアカウント一覧（同期状況付き）。member は所属テナントのアカウントのみ。
 * 返り値: { ok, accounts: [{ accountId, client, enabled, addedAt, accountName?, note?,
 *                            lastSyncedAt?, adCount?, currency? }] }
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const [allRegistered, snapshots] = await Promise.all([
      listRegisteredAccounts(),
      listSnapshots(),
    ]);
    const registered = filterByAccount(auth, allRegistered, (a) => a.accountId);
    const snapById = new Map(snapshots.map((s) => [s.accountId, s]));
    const accounts = registered.map((a) => {
      const snap = snapById.get(a.accountId);
      return {
        ...a,
        accountName: snap?.accountName ?? a.accountName,
        lastSyncedAt: snap?.syncedAt,
        adCount: snap?.adCount,
        currency: snap?.currency,
      };
    });
    return NextResponse.json({ ok: true, accounts });
  } catch (error) {
    const message = error instanceof Error ? error.message : '一覧の取得に失敗しました';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * 登録簿の編集。
 * body:
 *   { action: 'add',    accountId, client, accountName?, note? }
 *   { action: 'update', accountId, client?, enabled?, note? }
 *   { action: 'remove', accountId }
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (auth instanceof NextResponse) return auth;
    const body = await request.json();
    const action = body?.action;
    const accountId = typeof body?.accountId === 'string' ? body.accountId : '';
    if (!accountId) {
      return NextResponse.json({ ok: false, error: 'accountId は必須です' }, { status: 400 });
    }

    if (action === 'add') {
      const entry = await addAccount({
        accountId,
        client: typeof body?.client === 'string' ? body.client : '',
        accountName: typeof body?.accountName === 'string' ? body.accountName : undefined,
        note: typeof body?.note === 'string' ? body.note : undefined,
      });
      return NextResponse.json({ ok: true, account: entry });
    }

    if (action === 'update') {
      // paletteHex は #RRGGBB のみ許可（生成プロンプトに渡るため不正値を落とす）
      const paletteHex = Array.isArray(body?.paletteHex)
        ? (body.paletteHex as unknown[]).filter((h): h is string => typeof h === 'string' && /^#[0-9a-fA-F]{6}$/.test(h))
        : undefined;
      const entry = await updateAccount(accountId, {
        ...(typeof body?.client === 'string' ? { client: body.client } : {}),
        ...(typeof body?.enabled === 'boolean' ? { enabled: body.enabled } : {}),
        ...(typeof body?.note === 'string' ? { note: body.note } : {}),
        ...(typeof body?.brief === 'string' ? { brief: body.brief } : {}),
        ...(paletteHex !== undefined ? { paletteHex } : {}),
      });
      return NextResponse.json({ ok: true, account: entry });
    }

    if (action === 'remove') {
      await removeAccount(accountId);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: `不明なactionです: ${action}` }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '登録簿の更新に失敗しました';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
