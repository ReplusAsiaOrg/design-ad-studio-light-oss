import { NextRequest, NextResponse } from 'next/server';
import { listAdAccounts } from '@/lib/meta/accounts';
import { hasDb } from '@/lib/db/client';
import { syncAccount, syncAccountDaily, syncAccountSegmentsDaily } from '@/lib/meta/sync';
import { fetchInsights } from '@/lib/meta/client';
import { requireAdmin } from '@/lib/auth/guard';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * 初回バックフィル（過去データ取り込み）。
 * 配置×CVはレンジが長いとMeta側で併用不可になり、フォールバックが既存のCV付き行を
 * 上書きしてしまうため、必ず月次チャンクで同期する——というルールをコード化したもの。
 *
 * 1リクエスト＝1ヶ月分だけ処理し、続きがあれば next（翌月1日）を返す。
 * クライアント（アカウント管理タブ）が next が無くなるまで繰り返し呼ぶことで、
 * Vercelの実行時間上限に収まりながら何年分でも取り込める。
 *
 * body: { account: string, cursor?: 'YYYY-MM-01' }
 *   cursor なし（初回）: スナップショット同期＋配信開始月の検出＋最初の1ヶ月を処理
 *   cursor あり: その月を処理
 */

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** 'YYYY-MM-DD' に n ヶ月足した月の1日 */
function addMonths(dateStr: string, n: number): string {
  const [y, m] = dateStr.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-01`;
}

/** 月初〜月末（今日を超えない）のレンジ */
function monthRange(monthFirst: string, today: string): { since: string; until: string } {
  const nextFirst = addMonths(monthFirst, 1);
  const lastDay = ymd(new Date(new Date(nextFirst + 'T00:00:00Z').getTime() - 24 * 3600 * 1000));
  return { since: monthFirst, until: lastDay < today ? lastDay : today };
}

/** 配信開始月〜今月の月数 */
function monthsBetween(firstMonth: string, today: string): number {
  const [fy, fm] = firstMonth.split('-').map(Number);
  const [ty, tm] = today.split('-').map(Number);
  return (ty * 12 + tm) - (fy * 12 + fm) + 1;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (auth instanceof NextResponse) return auth;
    if (!hasDb()) {
      return NextResponse.json(
        { ok: false, error: '過去取込には DATABASE_URL（日次データ）の設定が必要です' },
        { status: 400 },
      );
    }
    const body = await request.json().catch(() => ({}));
    const account = typeof body?.account === 'string' ? body.account : null;
    const registered = await listAdAccounts();
    if (!account || !registered.some((a) => a.accountId === account)) {
      return NextResponse.json({ ok: false, error: `未登録のアカウントIDです: ${account}` }, { status: 400 });
    }

    const today = ymd(new Date());
    // Metaインサイトは現在から37ヶ月より前に遡れない（#3018）。余裕を見て36ヶ月前を下限にする
    const oldestAllowed = addMonths(today.slice(0, 7) + '-01', -36);
    let cursor: string;
    let totalMonths: number | null = null;

    if (typeof body?.cursor === 'string' && /^\d{4}-\d{2}-01$/.test(body.cursor)) {
      cursor = body.cursor < oldestAllowed ? oldestAllowed : body.cursor;
    } else {
      // 初回: スナップショットを同期し、アカウントの配信開始日を検出する
      await syncAccount(account);
      const rows = await fetchInsights(account, {
        range: { datePreset: 'maximum' },
        level: 'account',
        fields: 'spend',
      });
      const firstDate = rows[0]?.date_start;
      if (!firstDate) {
        // 配信実績なし＝日次バックフィル対象なし
        return NextResponse.json({ ok: true, account, processed: null, next: null, totalMonths: 0 });
      }
      cursor = firstDate.slice(0, 7) + '-01';
      if (cursor < oldestAllowed) cursor = oldestAllowed;
      totalMonths = monthsBetween(cursor, today);
    }

    if (cursor > today) {
      return NextResponse.json({ ok: true, account, processed: null, next: null, totalMonths });
    }

    const { since, until } = monthRange(cursor, today);
    const daily = await syncAccountDaily(account, { since, until });
    const segments = await syncAccountSegmentsDaily(account, { since, until });

    const nextCursor = addMonths(cursor, 1);
    return NextResponse.json({
      ok: true,
      account,
      processed: {
        since,
        until,
        dailyRows: daily.rowCount,
        segmentRows: segments.rowCount,
        placementCv: segments.placementCv,
      },
      next: nextCursor <= today ? nextCursor : null,
      totalMonths,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '過去取込に失敗しました';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
