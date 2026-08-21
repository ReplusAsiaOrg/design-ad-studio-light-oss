// 既存の登録済み広告アカウントを初期テナントとして投入する（Issue #7・冪等）。
// accounts.client（クライアント名）ごとに tenants を1件作り、tenant_accounts で紐付ける。
//
// 実行: node --env-file=.env.local scripts/seed-tenants.mjs
//       （DATABASE_URL の向き先に対して実行される。本番へは向き先を差し替えて実行）
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL がありません（--env-file=.env.local を付けて実行）');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: url,
  ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false },
});

try {
  const { rows: accounts } = await pool.query(
    'SELECT account_id, client, account_name FROM accounts ORDER BY added_at',
  );
  if (accounts.length === 0) {
    console.log('accounts が空です。先にアカウント登録（または本番データ移行）をしてください');
    process.exit(0);
  }

  for (const a of accounts) {
    const name = (a.client || a.account_name || a.account_id).trim();
    const { rows: [tenant] } = await pool.query(
      `INSERT INTO tenants (name) VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING tenant_id, name`,
      [name],
    );
    const { rowCount } = await pool.query(
      `INSERT INTO tenant_accounts (tenant_id, account_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [tenant.tenant_id, a.account_id],
    );
    console.log(`${rowCount ? '追加' : '済  '}: テナント「${tenant.name}」 ← ${a.account_id}`);
  }

  const { rows: [{ t, ta }] } = await pool.query(
    'SELECT (SELECT count(*) FROM tenants) AS t, (SELECT count(*) FROM tenant_accounts) AS ta',
  );
  console.log(`\n完了: tenants=${t}件 / tenant_accounts=${ta}件`);
} finally {
  await pool.end();
}
