import { NextRequest, NextResponse } from 'next/server';
import { trackGenerationOutcomes } from '@/lib/generation-history';
import { listAdAccounts } from '@/lib/meta/accounts';
import { loadSnapshot } from '@/lib/meta/store';
import { getScoringSettings } from '@/lib/meta/scoring-settings';
import { requireAuth, filterByAccount } from '@/lib/auth/guard';
import type { AccountSnapshot } from '@/lib/meta/store';
import type { ScoringSettings } from '@/lib/scoring';

export const runtime = 'nodejs';

/**
 * 採用済みバナーの勝敗追跡。登録済み全アカウントの同期スナップショットと
 * 名寄せ（素材名⇔統合名）で突き合わせ、一致した実績を履歴に書き戻す。
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const registered = filterByAccount(auth, await listAdAccounts(), (a) => a.accountId);

    const targets: { snapshot: AccountSnapshot; settings: ScoringSettings }[] = [];
    for (const acc of registered) {
      const snapshot = await loadSnapshot(acc.accountId).catch(() => null);
      if (!snapshot) continue;
      targets.push({ snapshot, settings: await getScoringSettings(acc.accountId) });
    }
    if (targets.length === 0) {
      return NextResponse.json(
        { ok: false, error: '同期済みアカウントがありません。先に「アカウント管理」から同期してください' },
        { status: 404 },
      );
    }
    const { updated } = await trackGenerationOutcomes(targets);
    return NextResponse.json({ ok: true, updated, accounts: targets.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
