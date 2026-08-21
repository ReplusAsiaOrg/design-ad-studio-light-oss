/**
 * デモモードの自動セットアップ。
 * サーバー起動後、最初にDBが触られたタイミングで1回だけ:
 *   1. スキーマ適用（schema.sql・冪等）
 *   2. デモアカウントの登録（未登録なら）＋ブランドブリーフ・配色
 *   3. スナップショット同期・日次同期・内訳同期（偽Graph APIから全期間）
 *   4. CreativeTraits（vision分類結果）の投入
 * を行う。同じ日に2回目以降の起動では「直近7日の取り直し」だけ行う（本番の日次同期と同じ挙動）。
 *
 * ここでは db/client の q() を直接使わず、循環参照を避けるために q 相当の関数を注入してもらう。
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEMO_ACCOUNT_ID, DEMO_ACCOUNT_NAME, DEMO_CLIENT_NAME, demoGeneRecords, demoEarliestDate, demoToday, addDays,
} from './dataset';

type Q = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

/** シード処理中であることを示すコンテキスト（q() がシード待ちをスキップするため） */
export const seedingContext = new AsyncLocalStorage<{ seeding: true }>();

const g = globalThis as unknown as { __adStudioDemoSeed?: { day: string; promise: Promise<void> } };

/** デモDBが今日の状態に整っていることを保証する（多重呼び出し・並行呼び出し安全） */
export function ensureDemoReady(q: Q): Promise<void> {
  const today = demoToday();
  if (g.__adStudioDemoSeed && g.__adStudioDemoSeed.day === today) return g.__adStudioDemoSeed.promise;
  const promise = seedingContext.run({ seeding: true }, () => runSeed(q, today)).catch((e) => {
    // 失敗したら次の呼び出しで再試行できるようにする
    if (g.__adStudioDemoSeed?.day === today) g.__adStudioDemoSeed = undefined;
    throw e;
  });
  g.__adStudioDemoSeed = { day: today, promise };
  return promise;
}

async function runSeed(q: Q, today: string): Promise<void> {
  const t0 = Date.now();
  // 1. スキーマ（複数文をそのまま流す。冪等）
  const schema = readFileSync(path.join(process.cwd(), 'src', 'lib', 'db', 'schema.sql'), 'utf-8');
  await q(schema);

  // 2. アカウント登録
  await q(
    `INSERT INTO accounts (account_id, client, account_name, note, brief, palette_hex)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (account_id) DO NOTHING`,
    [
      DEMO_ACCOUNT_ID, DEMO_CLIENT_NAME, DEMO_ACCOUNT_NAME,
      'デモモードの架空アカウント。実在のクライアント・実績とは無関係です',
      'LUMINA（架空の化粧品ブランド）の高保湿美容液。ターゲットは乾燥・ハリ不足が気になり始めた30〜50代女性。上品で清潔感のあるトーンに、口コミ・ビフォーアフター・実績数字の訴求が刺さる想定。SNS映えするローズベージュ×ゴールドの世界観。',
      JSON.stringify(['#E8C4C4', '#C9A96E', '#FAF6F2', '#5C4A4A']),
    ],
  );

  // 3. 同期（偽Graph API経由。sync.ts の実装をそのまま使う＝本番と同じ経路で貯まる）
  const sync = await import('../meta/sync');
  const lastRun = await q(
    `SELECT max(range_to) AS last FROM sync_runs WHERE account_id = $1 AND kind = 'daily' AND ok = true`,
    [DEMO_ACCOUNT_ID],
  );
  const lastTo = lastRun[0]?.last ? String(lastRun[0].last).slice(0, 10) : null;
  const full = !lastTo;
  const since = full ? demoEarliestDate() : addDays(today, -7);

  await sync.syncAccount(DEMO_ACCOUNT_ID);
  await sync.syncAccountDaily(DEMO_ACCOUNT_ID, { since, until: today });
  await sync.syncAccountSegmentsDaily(DEMO_ACCOUNT_ID, { since, until: today });

  // 4. CreativeTraits（vision分類の代替。既存があっても上書きして語彙変更に追従）
  for (const rec of demoGeneRecords()) {
    await q(
      `INSERT INTO gene_caches (account_id, creative_id, record)
       VALUES ($1, $2, $3)
       ON CONFLICT (account_id, creative_id) DO UPDATE SET record = $3`,
      [DEMO_ACCOUNT_ID, rec.creativeId, JSON.stringify({ ...rec, classifiedAt: new Date().toISOString() })],
    );
  }

  console.log(`[demo] デモデータ準備完了（${full ? '全期間' : '直近7日を更新'}: ${since}〜${today}, ${Date.now() - t0}ms）`);
}
