// 使い方マニュアルの公開用HTML（単一ファイル）をビルドする。
// docs/MANUAL.md と同内容を、スクショを base64 で埋め込んだ自己完結ページにする。
//
//   node docs/site/build.mjs
//   → docs/site/dist/design-ad-studio-manual/index.html
//
// デプロイ（design課の Vercel・Git連携なし手動デプロイ運用）:
//   cd docs/site/dist/design-ad-studio-manual
//   npx vercel deploy --prod --yes --scope design-ai-projects
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const imgDir = join(here, '..', 'images', 'manual');
const outDir = join(here, 'dist', 'design-ad-studio-manual');

const tpl = readFileSync(join(here, 'manual-template.html'), 'utf8');
const html = tpl.replace(/\{\{IMG:([^}]+)\}\}/g, (_, name) => {
  const mime = name.endsWith('.jpg') || name.endsWith('.jpeg') ? 'image/jpeg' : 'image/png';
  const b64 = readFileSync(join(imgDir, name)).toString('base64');
  return `data:${mime};base64,${b64}`;
});

if (html.includes('{{IMG')) throw new Error('未解決の画像プレースホルダがあります');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'index.html'), html);
console.log(`built: ${join(outDir, 'index.html')} (${(html.length / 1024 / 1024).toFixed(1)} MB)`);
