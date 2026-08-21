// デプロイ識別子の生成（Issue #4）。
// package.json の version ＋ gitコミット短縮ハッシュ＋生成時刻を
// src/generated/build-info.json に書き出す。画面右下のバッジ（BuildBadge）が表示する。
//
// 実行タイミング:
//   - npm run deploy（デプロイ直前にローカルで実行→生成物ごとVercelにアップロード）
//   - prebuild（ローカルビルド時。Vercelリモートビルドでは .git が無いため
//     生成をスキップし、アップロード済みのファイルをそのまま使う）
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = join(root, 'src', 'generated', 'build-info.json');

let commit;
try {
  commit = execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  const dirty = execSync('git status --porcelain', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  if (dirty) commit += '+';
} catch {
  // git が使えない環境（Vercelリモートビルド等）では既存ファイルを維持する
  console.log('build-info: git不在のためスキップ（既存の build-info.json を使用）');
  process.exit(0);
}

const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
// デプロイ識別子は日本時間の MMDD-HHmm（スクショから一目で判別する用途なので秒は不要）
const jst = new Date(Date.now() + 9 * 3600 * 1000);
const pad = (n) => String(n).padStart(2, '0');
const builtAt = `${pad(jst.getUTCMonth() + 1)}${pad(jst.getUTCDate())}-${pad(jst.getUTCHours())}${pad(jst.getUTCMinutes())}`;

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify({ version, commit, builtAt }, null, 2) + '\n');
console.log(`build-info: v${version} ${commit}@${builtAt} → src/generated/build-info.json`);
