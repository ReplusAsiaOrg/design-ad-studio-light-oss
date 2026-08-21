import { Pool, type QueryResultRow } from 'pg';
import { isDemoMode } from '../demo/mode';

/**
 * Postgres接続（Neon本番 / ローカルPostgres開発の両対応）。
 * DATABASE_URL 未設定時は従来の fs 保存（data/ads/）にフォールバックするため、
 * 呼び出し側は hasDb() で分岐する。
 *
 * デモモード（DEMO_MODE=1）:
 *   - DATABASE_URL の有無に関わらず、常に組み込みPostgres（PGlite・WASM）を data/demo-db/ に自動作成して使う
 *     → Postgresのインストール不要で全タブ（勝ちセグメント等）が動き、実運用DBに架空データが混ざらない
 *   - 最初のクエリ前に架空データを自動投入する（demo/seed.ts）
 */

// Next.js dev のホットリロードでプールが増殖しないよう globalThis にキャッシュ
const globalForDb = globalThis as unknown as {
  __adStudioPool?: Pool;
  __adStudioPglite?: Promise<PgliteLike>;
};

/** PGlite の最小インターフェース（型パッケージへの直接依存を避ける） */
interface PgliteLike {
  query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(text: string): Promise<unknown>;
}

function isEmbeddedDb(): boolean {
  return isDemoMode();
}

export function hasDb(): boolean {
  return Boolean(process.env.DATABASE_URL) || isDemoMode();
}

export function getPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL が未設定です');
  if (!globalForDb.__adStudioPool) {
    const isLocal = /localhost|127\.0\.0\.1/.test(url);
    globalForDb.__adStudioPool = new Pool({
      connectionString: url,
      max: 5,
      // Neon等のマネージドPostgresはTLS必須。ローカルは無効
      ssl: isLocal ? undefined : { rejectUnauthorized: false },
    });
  }
  return globalForDb.__adStudioPool;
}

async function getPglite(): Promise<PgliteLike> {
  if (!globalForDb.__adStudioPglite) {
    globalForDb.__adStudioPglite = (async () => {
      const path = await import('node:path');
      const dir = path.join(process.cwd(), 'data', 'demo-db');
      const { promises: fs } = await import('node:fs');
      await fs.mkdir(dir, { recursive: true });
      const { PGlite } = await import('@electric-sql/pglite');
      const db = await PGlite.create(dir);
      return db as unknown as PgliteLike;
    })().catch((e) => {
      // 失敗を握ったままにせず次回再試行できるようにする
      globalForDb.__adStudioPglite = undefined;
      throw e;
    });
  }
  return globalForDb.__adStudioPglite;
}

/** 生クエリ（デモの自動投入待ちをしない。seed 自身と内部用） */
async function qRaw<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  if (isEmbeddedDb()) {
    const db = await getPglite();
    // 複数文（schema.sql）はパラメータ無しの exec で流す
    if (params.length === 0 && /;\s*[\s\S]*\S/.test(text)) {
      await db.exec(text);
      return [];
    }
    const res = await db.query<T>(text, params);
    return res.rows;
  }
  const res = await getPool().query<T>(text, params);
  return res.rows;
}

export async function q<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  if (isDemoMode()) {
    const { ensureDemoReady, seedingContext } = await import('../demo/seed');
    if (!seedingContext.getStore()?.seeding) {
      await ensureDemoReady((t, p) => qRaw(t, p));
    }
  }
  return qRaw<T>(text, params);
}
