// テナントスコープ強制の検証（Issue #8 完了条件）。
// member ユーザーでログインし、(a) 権限外アカウント指定の全ルートが 403、
// (b) 管理系APIが 403 になることを実サーバーに対して確認する。
//
// 前提: Supabase Auth 有効（SUPABASE_URL / SUPABASE_ANON_KEY 設定済み）のサーバーが起動中で、
//       member ユーザー（add-user.mjs で発行）が存在すること。
//
// 例: node scripts/verify-tenant-scope.mjs \
//       --base http://localhost:3210 \
//       --email client@example.com --password '***' \
//       --denied-account act_0000000000000000
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const base = arg('base', 'http://localhost:3210');
const email = arg('email');
const password = arg('password');
const denied = arg('denied-account');

if (!email || !password || !denied) {
  console.error('使い方: verify-tenant-scope.mjs --base <url> --email <member> --password <pass> --denied-account <act_他テナント>');
  process.exit(1);
}

// ---- ログインして cookie jar を作る ----
const jar = new Map();
function storeCookies(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}
function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

const loginRes = await fetch(`${base}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
storeCookies(loginRes);
if (!loginRes.ok) {
  console.error(`ログイン失敗 (HTTP ${loginRes.status}): ${await loginRes.text()}`);
  process.exit(1);
}
console.log(`ログインOK: ${email}\n`);

// ---- テストケース ----
let failed = 0;
async function expect403(name, path, init = {}) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader(), ...(init.headers ?? {}) },
  });
  const ok = res.status === 403;
  if (!ok) failed++;
  console.log(`${ok ? '✅' : '❌'} ${name}: HTTP ${res.status}${ok ? '' : ' (403であるべき)'}`);
}

console.log('--- (a) 権限外アカウント指定 → 403 ---');
await expect403('priority', `/api/meta/priority?account=${denied}`);
await expect403('report', `/api/meta/report?account=${denied}&preset=last_7d`);
await expect403('segments', `/api/meta/segments?account=${denied}`);
await expect403('ranking', `/api/meta/ranking?account=${denied}`);
await expect403('winners', `/api/meta/winners?account=${denied}`);
await expect403('patterns', `/api/meta/patterns?account=${denied}`);
await expect403('winning-creatives', `/api/meta/winning-creatives?account=${denied}`);
await expect403('creative-breakdown', `/api/meta/creative-breakdown?account=${denied}&adId=123`);
await expect403('settings GET', `/api/meta/settings?account=${denied}`);
await expect403('report-insights', '/api/meta/report-insights', {
  method: 'POST',
  body: JSON.stringify({ summary: { spend: 0 }, account: denied }),
});
await expect403('insights-chat', '/api/meta/insights-chat', {
  method: 'POST',
  body: JSON.stringify({
    summary: { spend: 0 },
    analysis: { actions: [{ title: 'x' }] },
    messages: [{ role: 'user', content: 'test' }],
    account: denied,
  }),
});

console.log('\n--- (b) 管理系API（member） → 403 ---');
await expect403('accounts POST', '/api/meta/accounts', {
  method: 'POST',
  body: JSON.stringify({ action: 'add', accountId: 'act_1', client: 'x' }),
});
await expect403('accounts/available', '/api/meta/accounts/available');
await expect403('sync POST', '/api/meta/sync', { method: 'POST', body: '{}' });
await expect403('backfill POST', '/api/meta/backfill', { method: 'POST', body: JSON.stringify({ account: denied }) });
await expect403('genes POST', '/api/meta/genes', { method: 'POST', body: JSON.stringify({ account: denied }) });
await expect403('settings PUT', `/api/meta/settings?account=${denied}`, { method: 'PUT', body: '{}' });
await expect403('settings DELETE', `/api/meta/settings?account=${denied}`, { method: 'DELETE' });

console.log(failed === 0 ? '\n全件PASS' : `\n${failed}件FAIL`);
process.exit(failed === 0 ? 0 : 1);
