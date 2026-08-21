/**
 * スキーマ適用（冪等）。
 * ローカル: npm run db:migrate
 * Neon:     DATABASE_URL=postgres://... node scripts/db-migrate.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL が未設定です（例: node --env-file=.env.local scripts/db-migrate.mjs）');
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(path.join(here, '../src/lib/db/schema.sql'), 'utf-8');

const isLocal = /localhost|127\.0\.0\.1/.test(url);
const client = new pg.Client({
  connectionString: url,
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
});

await client.connect();
try {
  await client.query(sql);
  const { rows } = await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
  );
  console.log(`✅ マイグレーション完了: ${url.replace(/\/\/[^@]*@/, '//***@')}`);
  console.log(`   テーブル: ${rows.map((r) => r.table_name).join(', ')}`);
} finally {
  await client.end();
}
