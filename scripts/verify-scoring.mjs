/**
 * scoring.ts がシート（汎用クリエイティブ集計シートv5）と同じ結果を出すか検証する。
 * 実行: npm run verify:scoring
 * 入力386行 → 名寄せ・集計・ランク付け → シートのOUT_優先順位246行と突き合わせ。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  buildPriorityRows, DEFAULT_SCORING_SETTINGS,
  segmentVerdict, buildAdName, normalizeAdName,
} from '../src/lib/scoring.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(path.join(here, 'fixtures/sheet-sample.json'), 'utf-8'));

const input = fixture.input.map(([name, reach, purchases, spend]) => ({ name, reach, purchases, spend }));
const rows = buildPriorityRows(input, DEFAULT_SCORING_SETTINGS);
const byName = new Map(rows.map((r) => [r.integratedName, r]));

let ng = 0;
const fail = (msg) => { ng++; console.error(`  ✗ ${msg}`); };

// 1) 統合名の集合が一致するか
const expectedNames = new Set(fixture.expected.map((e) => e[0]));
const actualNames = new Set(rows.map((r) => r.integratedName));
for (const n of expectedNames) if (!actualNames.has(n)) fail(`期待側にあるが生成されず: "${n}"`);
for (const n of actualNames) if (!expectedNames.has(n)) fail(`生成されたが期待側にない: "${n}"`);

// 2) 各統合名の 集計値・ランク・総合評価 が一致するか
let checked = 0;
for (const [name, reach, purchases, spend, cpaRank, spendRank, verdict] of fixture.expected) {
  const r = byName.get(name);
  if (!r) continue;
  checked++;
  if (r.reach !== reach) fail(`${name}: リーチ ${r.reach} ≠ 期待 ${reach}`);
  if (r.purchases !== purchases) fail(`${name}: 購入数 ${r.purchases} ≠ 期待 ${purchases}`);
  if (Math.round(r.spend) !== spend) fail(`${name}: 消化金額 ${r.spend} ≠ 期待 ${spend}`);
  if (r.cpaRank !== cpaRank) fail(`${name}: 購入単価ランク ${r.cpaRank} ≠ 期待 ${cpaRank}（CPA=${r.cpa?.toFixed(1)}）`);
  if (r.spendRank !== spendRank) fail(`${name}: 消化金額ランク ${r.spendRank} ≠ 期待 ${spendRank}`);
  if (r.verdict !== verdict) fail(`${name}: 総合評価 ${r.verdict} ≠ 期待 ${verdict}`);
}

// 3) 並び順（シートのOUT_優先順位と同順か・参考情報）
let orderMismatch = 0;
const expectedOrder = fixture.expected.map((e) => e[0]);
const actualOrder = rows.map((r) => r.integratedName);
for (let i = 0; i < Math.min(expectedOrder.length, actualOrder.length); i++) {
  if (expectedOrder[i] !== actualOrder[i]) orderMismatch++;
}

// 4) segmentVerdict（内訳系★判定・Phase 1c）: 既定値での境界ケース
//    CPA上限（既定）: 優秀5000 / 良好6666.67 / 継続10000 / 内訳系消化下限c=1万 / ★下限 s3=10万・s2=3万
const s = DEFAULT_SCORING_SETTINGS;
const segCases = [
  // [spend, purchases, 期待]（cpa = spend/purchases）
  [9000, 5, '判定不可'],    // 消化 < 内訳系c(1万)
  [120000, 30, '★★★'],    // cpa4000 ≤優秀 かつ 消化 ≥ s3(10万)
  [50000, 10, '★★'],       // cpa5000 ≤優秀 だが 消化 < s3 → ★★（≤良好 かつ ≥ s2(3万)）
  [20000, 4, '★継続'],     // cpa5000 ≤優秀 だが 消化 < s2 → ★★ならず → ≤継続で★継続
  [50000, 6, '★継続'],     // cpa8333 ≤継続(1万)
  [50000, 3, '停止推奨'],   // cpa16667 > 要改善でも内訳系は停止推奨
  [50000, 0, '停止推奨'],   // CV=0
];
for (const [spend, purchases, expected] of segCases) {
  const cpa = purchases > 0 ? spend / purchases : null;
  const got = segmentVerdict(spend, purchases, cpa, s);
  if (got !== expected) fail(`segmentVerdict(消化${spend}, CV${purchases}): ${got} ≠ 期待 ${expected}`);
}

// 5) buildAdName（入稿用名称・Phase 1c）: 生成→normalizeAdName で必ず素材名に戻る（名寄せ整合）
const nameCases = [
  ['素材A_春訴求', { date: '2026-07-07' }, '20260707_素材A_春訴求', []],
  ['素材A_春訴求', { date: '20260707', brandPrefix: 'brandname' }, '20260707_brandname_素材A_春訴求', ['brandname']],
];
for (const [material, opts, expected, prefixes] of nameCases) {
  const built = buildAdName(material, opts);
  if (built !== expected) fail(`buildAdName("${material}"): "${built}" ≠ 期待 "${expected}"`);
  const back = normalizeAdName(built, prefixes);
  if (back !== material) fail(`ラウンドトリップ不一致: "${built}" → normalizeAdName → "${back}" ≠ "${material}"`);
}

console.log(`\n検証結果: 入力${input.length}行 → 統合${rows.length}件（期待${fixture.expected.length}件）/ 値チェック${checked}件 / segmentVerdict ${segCases.length}件 / 入稿名称 ${nameCases.length}件`);
console.log(`並び順の一致: ${expectedOrder.length - orderMismatch}/${expectedOrder.length}${orderMismatch ? '（不一致は同値タイブレークの差の可能性）' : ''}`);
if (ng > 0) {
  console.error(`\n❌ ${ng}件の不一致`);
  process.exit(1);
}
console.log('✅ 全件一致: 名寄せ・集計・購入単価ランク・消化金額ランク・総合評価がシートと同一');
