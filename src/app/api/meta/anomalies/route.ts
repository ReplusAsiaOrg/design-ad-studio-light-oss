import { NextRequest, NextResponse } from 'next/server';
import { listAdAccounts } from '@/lib/meta/accounts';
import { fetchAdInsightsDaily } from '@/lib/meta/client';
import { loadSnapshot, isValidAccountId } from '@/lib/meta/store';
import { getScoringSettings } from '@/lib/meta/scoring-settings';
import { detectAnomalies, type DailyAdRow } from '@/lib/meta/anomaly';
import { requireAuth, assertAccountAccess, filterByAccount } from '@/lib/auth/guard';

export const runtime = 'nodejs';

const num = (v: string | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** YYYY-MM-DD（UTC基準。sync.ts と同じ近似） */
function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * 異常検知: 直近の完了日を過去7日ベースラインと比較したアラートを返す。
 * Meta API から直近15日の日次インサイトをオンデマンド取得するため DB 不要。
 *
 * query: account=act_xxx（省略時は登録済み先頭）
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const sp = request.nextUrl.searchParams;
    const registered = filterByAccount(auth, await listAdAccounts(), (a) => a.accountId);
    const account = sp.get('account') ?? registered[0]?.accountId;
    if (!account) {
      return NextResponse.json(
        { ok: false, error: '対象アカウントがありません。「アカウント管理」タブから追加してください' },
        { status: 404 },
      );
    }
    if (!isValidAccountId(account)) {
      return NextResponse.json({ ok: false, error: `不正なアカウントIDです: ${account}` }, { status: 400 });
    }
    const denied = assertAccountAccess(auth, account);
    if (denied) return denied;

    const today = dateStr(new Date());
    const since = dateStr(new Date(Date.now() - 15 * 86400_000));
    const [settings, raw, snap] = await Promise.all([
      getScoringSettings(account),
      fetchAdInsightsDaily(account, { since, until: today }),
      loadSnapshot(account).catch(() => null),
    ]);

    const rows: DailyAdRow[] = raw
      .filter((r) => r.ad_id && r.date_start)
      .map((r) => ({
        adId: r.ad_id!,
        date: r.date_start!,
        spend: num(r.spend),
        impressions: num(r.impressions),
        clicks: num(r.clicks),
        actions: (r.actions ?? []).map((a) => ({ action_type: a.action_type, value: num(a.value) })),
      }));

    const adNames = new Map((snap?.ads ?? []).map((a) => [a.id, a.name]));
    const report = detectAnomalies(rows, { settings, adNames, today });
    return NextResponse.json({ ok: true, account, ...report });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
