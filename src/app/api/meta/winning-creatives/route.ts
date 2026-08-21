import { NextRequest, NextResponse } from 'next/server';
import { listSnapshots, loadSnapshot } from '@/lib/meta/store';
import { labelWinners } from '@/lib/meta/winner';
import { loadGeneCache } from '@/lib/meta/genes-store';
import { buildAccountPatterns } from '@/lib/meta/patterns';
import { describeTraitsForPrompt } from '@/lib/genes';
import { requireAuth, assertAccountAccess, filterByAccount } from '@/lib/auth/guard';

export const runtime = 'nodejs';

/**
 * Phase 3 出口接続: 「勝ち分析再現」タブに流し込む勝ちCR一覧を返す。
 *   - genes分類済み（= imageUrl を保持）の winner のみを対象にする（画像表示できるため）。
 *   - 各CRに cpa / cpaRatio / genes / 勝ちパターンの説明を付ける。
 *   - account単位の勝ちパターン headlines も同梱（UIで文脈表示）。
 * query: ?account=act_xxx（省略時は全アカウント）
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const sp = request.nextUrl.searchParams;
    const account = sp.get('account');

    // 勝ちCRピッカーの全アカウント横断返却は自テナントのみに制限（Issue #8）
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

    const accounts = [];
    for (const snap of snaps) {
      const geneCache = await loadGeneCache(snap!.accountId);
      const patterns = buildAccountPatterns(snap!, geneCache);
      const groups = labelWinners(snap!);

      // creativeId をキーに重複排除（同一CRが複数CV群で勝ちに入ることがある＝Reactのkey重複防止）。
      // 同一CRはCPAが安い方（勝ち度が高い方）を残す。
      interface WinnerCreative {
        creativeId: string;
        name: string;
        conversion: string;
        cv: number;
        cpa: number | null;
        cpaRatio: number | null;
        isVideo: boolean;
        imageUrl?: string;
        genesText: string;
      }
      const byCreative = new Map<string, WinnerCreative>();
      for (const g of groups) {
        for (const a of g.winners) {
          if (!a.creativeId) continue;
          const rec = geneCache[a.creativeId];
          if (!rec || !rec.imageUrl) continue; // 画像表示できるものだけ
          const prev = byCreative.get(a.creativeId);
          if (prev && (prev.cpa ?? Infinity) <= (a.cpa ?? Infinity)) continue;
          byCreative.set(a.creativeId, {
            creativeId: a.creativeId,
            name: a.name,
            conversion: g.conversionLabel,
            cv: a.cv,
            cpa: a.cpa,
            cpaRatio: a.cpaRatio,
            isVideo: rec.isVideo,
            imageUrl: rec.imageUrl,
            genesText: describeTraitsForPrompt(rec.genes),
          });
        }
      }
      // CPAが安い順（=勝ち度が高い順）
      const creatives = [...byCreative.values()].sort((x, y) => (x.cpa ?? Infinity) - (y.cpa ?? Infinity));

      accounts.push({
        client: snap!.client,
        accountId: snap!.accountId,
        winningHeadlines: patterns.headlines,
        creatives,
      });
    }

    return NextResponse.json({ ok: true, accounts });
  } catch (error) {
    const message = error instanceof Error ? error.message : '勝ちCR一覧の取得に失敗しました';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
