import { NextRequest, NextResponse } from 'next/server';
import { listSnapshots, loadSnapshot } from '@/lib/meta/store';
import { loadGeneCache } from '@/lib/meta/genes-store';
import { buildAccountPatterns } from '@/lib/meta/patterns';
import { requireAuth, assertAccountAccess, filterByAccount } from '@/lib/auth/guard';

export const runtime = 'nodejs';

/**
 * 勝ち/負けラベル × CreativeTraits を集計し「勝ちは○○/負けは××」を返す（読み取りのみ）。
 * 先に /api/meta/genes で vision分類を済ませておく必要がある。
 * query: ?account=act_xxx（省略時は全アカウント）, ?minSamples=3
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const sp = request.nextUrl.searchParams;
    const account = sp.get('account');
    const minSamples = Number(sp.get('minSamples') ?? '3') || 3;

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

    const patterns = [];
    for (const s of snaps) {
      const geneCache = await loadGeneCache(s!.accountId);
      patterns.push(buildAccountPatterns(s!, geneCache, { minSamples }));
    }

    return NextResponse.json({ ok: true, minSamples, patterns });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'パターン集計に失敗しました';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
