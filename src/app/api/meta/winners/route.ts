import { NextRequest, NextResponse } from 'next/server';
import { listSnapshots, loadSnapshot } from '@/lib/meta/store';
import { labelWinners } from '@/lib/meta/winner';
import { requireAuth, assertAccountAccess, filterByAccount } from '@/lib/auth/guard';

export const runtime = 'nodejs';

/**
 * ローカル保存済みデータから勝ち/負けラベルを返す（読み取りのみ・API課金なし）。
 * query: ?account=act_xxx（省略時は全アカウント）, ?minSpend=3000
 * 返り値は件数が嵩むため、各群 winners/losers は上位のみ name/cpa/cpaRatio に絞る。
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const sp = request.nextUrl.searchParams;
    const account = sp.get('account');
    const minSpend = Number(sp.get('minSpend') ?? '3000') || 0;

    if (account) {
      const denied = assertAccountAccess(auth, account);
      if (denied) return denied;
    }
    const snaps = account
      ? [await loadSnapshot(account)].filter(Boolean)
      : filterByAccount(auth, await listSnapshots(), (s) => s.accountId);
    if (snaps.length === 0) {
      return NextResponse.json(
        { ok: false, error: '同期データがありません（先に /api/meta/sync を実行）' },
        { status: 404 },
      );
    }

    const groups = snaps.flatMap((s) => labelWinners(s!, minSpend));
    const summary = groups.map((g) => ({
      client: g.client,
      accountId: g.accountId,
      conversion: g.conversionLabel,
      medianCpa: g.medianCpa,
      evaluatedCount: g.evaluatedCount,
      winnerCount: g.winners.length,
      loserCount: g.losers.length,
      topWinners: g.winners.slice(0, 5).map((a) => ({ name: a.name, cv: a.cv, cpa: a.cpa, ratio: a.cpaRatio })),
      topLosers: g.losers.slice(0, 5).map((a) => ({ name: a.name, cv: a.cv, cpa: a.cpa, ratio: a.cpaRatio })),
    }));

    return NextResponse.json({ ok: true, minSpend, groups: summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : '勝ち負け判定に失敗しました';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
