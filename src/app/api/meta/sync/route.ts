import { NextRequest, NextResponse } from 'next/server';
import { listAdAccounts } from '@/lib/meta/accounts';
import { syncAccount, syncAccountDaily, syncAccountSegmentsDaily } from '@/lib/meta/sync';
import { classifyAccountGenes } from '@/lib/meta/genes-sync';
import { hasDb } from '@/lib/db/client';
import { requireAdmin } from '@/lib/auth/guard';

// Graph APIの全件取得＋複数アカウントで時間がかかるため長め。
export const runtime = 'nodejs';
export const maxDuration = 300;

interface SyncResultRow {
  client: string;
  accountId: string;
  accountName: string;
  currency: string;
  adCount: number;
  syncedAt: string;
  daily?: { rangeFrom: string; rangeTo: string; rowCount: number };
  segments?: { rangeFrom: string; rangeTo: string; rowCount: number; placementCv: boolean };
  genes?: { classified: number; cacheTotal: number; refreshedUrls: number } | { error: string };
  top3BySpend: { name: string; spend: number; impressions: number; ctr: number }[];
}

async function syncOne(accountId: string, dailyOpts?: { since?: string; until?: string; days?: number }): Promise<SyncResultRow> {
  const snap = await syncAccount(accountId);
  const row: SyncResultRow = {
    client: snap.client,
    accountId: snap.accountId,
    accountName: snap.accountName,
    currency: snap.currency,
    adCount: snap.adCount,
    syncedAt: snap.syncedAt,
    top3BySpend: snap.ads.slice(0, 3).map((a) => ({
      name: a.name,
      spend: a.spend,
      impressions: a.impressions,
      ctr: a.ctr,
    })),
  };
  // DBがあれば日次fact＋内訳（性年齢・配置）も同期（既定: 直近7日。CVのアトリビューション遡及を取り込む）
  if (hasDb()) {
    row.daily = await syncAccountDaily(accountId, dailyOpts ?? {});
    row.segments = await syncAccountSegmentsDaily(accountId, dailyOpts ?? {});
  }
  // 勝ちCRのvision分類（キャッシュ済みはスキップ＝差分のみ）。失敗しても数値同期は成功扱い
  try {
    const g = await classifyAccountGenes(accountId);
    row.genes = { classified: g.classified, cacheTotal: g.cacheTotal, refreshedUrls: g.refreshedUrls };
  } catch (e) {
    row.genes = { error: e instanceof Error ? e.message : 'vision分類に失敗しました' };
  }
  return row;
}

/**
 * Metaから広告実数値を同期する（スナップショット＋DBがあれば日次fact）。
 * body: {
 *   accounts?: string[]  … 未指定なら登録済み（有効）アカウント全て
 *   since?, until?, days? … 日次同期の範囲（初回バックフィルは since/until を広げる）
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (auth instanceof NextResponse) return auth;
    const registered = await listAdAccounts();
    const known = new Set(registered.map((a) => a.accountId));
    let accounts = [...known];
    let dailyOpts: { since?: string; until?: string; days?: number } | undefined;
    try {
      const body = await request.json();
      if (Array.isArray(body?.accounts) && body.accounts.length) {
        // Graph APIパス・保存キーに到達する値なので、登録済みアカウントのみ許可
        const requested = body.accounts.filter((a: unknown): a is string => typeof a === 'string');
        const invalid = requested.filter((a: string) => !known.has(a));
        if (invalid.length) {
          return NextResponse.json(
            { ok: false, error: `未登録のアカウントIDです: ${invalid.join(', ')}` },
            { status: 400 },
          );
        }
        accounts = requested;
      }
      if (typeof body?.since === 'string' || typeof body?.until === 'string' || typeof body?.days === 'number') {
        dailyOpts = { since: body.since, until: body.until, days: body.days };
      }
    } catch {
      // body無しは全件
    }

    const results = [];
    for (const accountId of accounts) {
      results.push(await syncOne(accountId, dailyOpts));
    }

    return NextResponse.json({ ok: true, accounts: results });
  } catch (error) {
    const message = error instanceof Error ? error.message : '同期に失敗しました';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * Vercel Cron からの定期同期（毎朝）。Authorization: Bearer CRON_SECRET で認証。
 * 登録済み（有効）全アカウントを順に同期し、失敗はアカウント単位で握って続行する。
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const registered = await listAdAccounts();
  const results: { accountId: string; ok: boolean; adCount?: number; dailyRows?: number; genesClassified?: number; error?: string }[] = [];
  for (const a of registered) {
    try {
      const r = await syncOne(a.accountId);
      results.push({
        accountId: a.accountId,
        ok: true,
        adCount: r.adCount,
        dailyRows: r.daily?.rowCount,
        genesClassified: r.genes && 'classified' in r.genes ? r.genes.classified : undefined,
      });
    } catch (error) {
      results.push({
        accountId: a.accountId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  // 部分失敗でも200を返すとCloud Scheduler/Vercelのログ上「成功」に見える。
  // 非200にして実行履歴から失敗を検知できるようにする（Schedulerはリトライ0設定＝再同期の嵐にはならない）
  const status = failed === 0 ? 200 : 503;
  return NextResponse.json({ ok: failed === 0, synced: results.length - failed, failed, results }, { status });
}
