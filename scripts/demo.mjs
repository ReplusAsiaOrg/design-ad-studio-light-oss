/**
 * デモモード起動: `npm run demo`
 *   - Meta API・APIキー・Postgres なしで、架空の化粧品ブランドのサンプルデータでアプリ全体を触れる
 *   - DEMO_MODE=1 を立てて `next dev` を起動するだけ（Windows でも同じコマンドで動くように node で包む）
 *   - DBは常に組み込みPostgres（data/demo-db/）。.env.local の DATABASE_URL は無視される（実運用DBに架空データを混ぜない）
 *   - 初回はサンプルデータの投入に10〜20秒かかる（data/demo-db/ を消せば作り直す）
 *   - `.env.local` に OPENAI_API_KEY / GEMINI_API_KEY があれば AI分析・バナー生成も実際に動く
 * 本番ビルドで試す: DEMO_MODE=1 npm run build && DEMO_MODE=1 npm run start
 */
import { spawn } from 'node:child_process';

const port = process.env.PORT ?? '3000';
console.log(`\n🧪 Ad Studio Light をデモモードで起動します（架空データ・Meta API未接続） → http://localhost:${port} （または http://127.0.0.1:${port}）\n`);

const child = spawn('npx', ['next', 'dev', '-p', port], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, DEMO_MODE: '1' },
});
child.on('exit', (code) => process.exit(code ?? 0));
