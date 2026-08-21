import { NextRequest, NextResponse } from 'next/server';
import { classifyAccountGenes } from '@/lib/meta/genes-sync';
import { requireAdmin } from '@/lib/auth/guard';

// vision分類を複数件まわすため長め。
export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Phase 2b: 勝ち/負けクリエイティブの画像を vision分類し CreativeTraits を付与する。
 * body: { account: "act_xxx", limit?: number, refresh?: boolean }
 *   - 対象 = 各CV群の winners + losers（上位 limit 件ずつ、既定6）。
 *   - 既にキャッシュ済みの creativeId はスキップ（refresh:true で再分類）。
 * 返り値: 新規分類した件数とサンプル、キャッシュ総数。
 * ※ 同期（/api/meta/sync）・過去取込完了時にも自動実行される。ここは手動再実行用。
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (auth instanceof NextResponse) return auth;
    const body = (await request.json().catch(() => ({}))) as {
      account?: string;
      limit?: number;
      refresh?: boolean;
    };
    const account = body.account;
    if (!account) {
      return NextResponse.json({ ok: false, error: 'account（act_xxx）を指定してください' }, { status: 400 });
    }

    const r = await classifyAccountGenes(account, { limit: body.limit, refresh: body.refresh });

    if (r.attempted === 0) {
      return NextResponse.json({
        ok: true,
        account,
        classified: 0,
        skipped: r.skipped,
        cacheTotal: r.cacheTotal,
        note: r.skipped > 0 ? '対象は全てキャッシュ済みでした（refresh:true で再分類可）' : '勝ち/負け判定に該当するCRがありません',
      });
    }

    return NextResponse.json({
      ok: true,
      account,
      attempted: r.attempted,
      classified: r.classified,
      cacheTotal: r.cacheTotal,
      results: r.results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'vision分類に失敗しました';
    const status = message.startsWith('同期データがありません') ? 404 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
