// ユーザー発行スクリプト（Issue #6, #9。管理UIができるまでの運用手段）。
// Supabase Auth にユーザーを作成（既存ならスキップ）し、app_users（role）と
// user_tenants（所属テナント）を登録する。冪等（同じ引数で再実行OK）。
//
// 必要env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / DATABASE_URL
//
// 例: 管理者（リプラス側・全テナント）
//   node --env-file=.env.local scripts/add-user.mjs --email user@example.com --password '***' --role admin
// 例: クライアント（member・テナント指定）
//   node --env-file=.env.local scripts/add-user.mjs --email client@example.com --password '***' --role member --tenant 'エステレラ'
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const email = arg('email');
const password = arg('password');
const role = arg('role') ?? 'member';
const tenantName = arg('tenant');

if (!email || !password || !['admin', 'member'].includes(role)) {
  console.error("使い方: add-user.mjs --email <email> --password <pass> --role admin|member [--tenant 'テナント名']");
  process.exit(1);
}
if (role === 'member' && !tenantName) {
  console.error('member には --tenant（所属テナント名）が必要です');
  process.exit(1);
}

const supabaseUrl = (process.env.SUPABASE_URL ?? '').trim();
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
const dbUrl = process.env.DATABASE_URL;
if (!supabaseUrl || !serviceKey || !dbUrl) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / DATABASE_URL を .env.local に設定してください');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
const pool = new pg.Pool({
  connectionString: dbUrl,
  ssl: /localhost|127\.0\.0\.1/.test(dbUrl) ? undefined : { rejectUnauthorized: false },
});

try {
  // 1) Auth ユーザー作成（既存ならIDを引く）
  let userId;
  const { data: created, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // 招待メールフローは使わない（管理者が直接パスワードを渡す運用）
  });
  if (error) {
    if (/already|registered|exists/i.test(error.message)) {
      const { data: list, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
      if (listErr) throw listErr;
      const existing = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
      if (!existing) throw new Error(`既存ユーザーのはずが見つかりません: ${email}`);
      userId = existing.id;
      console.log(`Auth: 既存ユーザー (${userId})`);
    } else {
      throw error;
    }
  } else {
    userId = created.user.id;
    console.log(`Auth: 作成しました (${userId})`);
  }

  // 2) app_users（role）
  await pool.query(
    `INSERT INTO app_users (user_id, email, role) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, role = EXCLUDED.role`,
    [userId, email, role],
  );
  console.log(`app_users: role=${role}`);

  // 3) user_tenants（member のみ）
  if (role === 'member') {
    const { rows: [tenant] } = await pool.query('SELECT tenant_id, name FROM tenants WHERE name = $1', [tenantName]);
    if (!tenant) {
      const { rows } = await pool.query('SELECT name FROM tenants ORDER BY name');
      throw new Error(`テナント「${tenantName}」がありません。存在するテナント: ${rows.map((r) => r.name).join(', ') || '(なし。先に seed-tenants.mjs)'}`);
    }
    await pool.query(
      'INSERT INTO user_tenants (user_id, tenant_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, tenant.tenant_id],
    );
    console.log(`user_tenants: 「${tenant.name}」に所属`);
  }

  console.log('\n完了');
} finally {
  await pool.end();
}
