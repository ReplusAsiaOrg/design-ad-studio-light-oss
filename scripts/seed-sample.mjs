/**
 * 開発用シード: シート由来サンプル（386広告）をローカルDBに投入する。
 * アカウント act_9999999999「サンプル（シート由来）」として登録し、
 * スナップショット・dim_ad・fact_ad_daily（2026-07-05の1日分として）を作る。
 * 実行: node --env-file=.env.local scripts/seed-sample.mjs
 * 削除: node --env-file=.env.local scripts/seed-sample.mjs --clean
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const ACCOUNT_ID = 'act_9999999999';
const SEED_DATE = '2026-07-05';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL が未設定です'); process.exit(1); }
const client = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false } });
await client.connect();

try {
  if (process.argv.includes('--clean')) {
    for (const t of ['fact_ad_segment_daily', 'fact_ad_daily', 'dim_ad', 'snapshots', 'accounts', 'account_settings']) {
      await client.query(`DELETE FROM ${t} WHERE account_id = $1`, [ACCOUNT_ID]);
    }
    console.log(`🧹 ${ACCOUNT_ID} のシードデータを削除しました`);
    process.exit(0);
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const fixture = JSON.parse(readFileSync(path.join(here, 'fixtures/sheet-sample.json'), 'utf-8'));

  await client.query(
    `INSERT INTO accounts (account_id, client, account_name, note)
     VALUES ($1, 'サンプル（シート由来）', 'Sheet Sample', '開発用シード。scripts/seed-sample.mjs --clean で削除')
     ON CONFLICT (account_id) DO NOTHING`,
    [ACCOUNT_ID],
  );

  const ads = fixture.input.map(([name, reach, purchases, spend], i) => ({
    id: `seed_${String(i + 1).padStart(4, '0')}`,
    name,
    spend,
    impressions: Math.round(reach * 1.6),
    reach,
    clicks: Math.round(spend / 600),
    ctr: 0,
    cpc: 0,
    actions: purchases > 0 ? [{ action_type: 'offsite_conversion.fb_pixel_purchase', value: purchases }] : [],
    costPerActionType: [],
  }));
  ads.sort((a, b) => b.spend - a.spend);

  const snapshot = {
    client: 'サンプル（シート由来）',
    accountId: ACCOUNT_ID,
    accountName: 'Sheet Sample',
    currency: 'JPY',
    syncedAt: new Date().toISOString(),
    adCount: ads.length,
    ads,
  };
  await client.query(
    `INSERT INTO snapshots (account_id, data, synced_at) VALUES ($1, $2, now())
     ON CONFLICT (account_id) DO UPDATE SET data = $2, synced_at = now()`,
    [ACCOUNT_ID, JSON.stringify(snapshot)],
  );

  for (const ad of ads) {
    await client.query(
      `INSERT INTO dim_ad (account_id, ad_id, name) VALUES ($1, $2, $3)
       ON CONFLICT (account_id, ad_id) DO UPDATE SET name = $3, updated_at = now()`,
      [ACCOUNT_ID, ad.id, ad.name],
    );
    await client.query(
      `INSERT INTO fact_ad_daily (account_id, ad_id, date, spend, impressions, reach, clicks, actions)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (account_id, ad_id, date) DO UPDATE SET
         spend = $4, impressions = $5, reach = $6, clicks = $7, actions = $8`,
      [ACCOUNT_ID, ad.id, SEED_DATE, ad.spend, ad.impressions, ad.reach, ad.clicks, JSON.stringify(ad.actions)],
    );
  }

  // ---- 内訳シード（fact_ad_segment_daily）----
  // 決定的な比率で各広告の実績をセグメントに按分する（勝ちセグメントタブの開発確認用）。
  // CVは最大比率のセグメントから順に整数配分。placement は Meta 制約の再現で actions を空にする。
  const SPLITS = {
    gender: [['female', 0.55], ['male', 0.4], ['unknown', 0.05]],
    age: [['25-34', 0.1], ['35-44', 0.35], ['45-54', 0.3], ['55-64', 0.25]],
    placement: [['facebook/feed', 0.6], ['instagram/instream', 0.4]],
  };
  const splitInt = (total, ratios) => {
    const out = ratios.map(([, r]) => Math.floor(total * r));
    let rest = total - out.reduce((s, v) => s + v, 0);
    for (let i = 0; rest > 0; i = (i + 1) % out.length) { out[i]++; rest--; }
    return out;
  };
  let segRows = 0;
  for (const ad of ads) {
    for (const [dimension, ratios] of Object.entries(SPLITS)) {
      const cvSplit = splitInt(ad.actions[0]?.value ?? 0, ratios);
      for (let i = 0; i < ratios.length; i++) {
        const [segment, ratio] = ratios[i];
        const actions = dimension !== 'placement' && cvSplit[i] > 0
          ? [{ action_type: 'offsite_conversion.fb_pixel_purchase', value: cvSplit[i] }]
          : [];
        await client.query(
          `INSERT INTO fact_ad_segment_daily (account_id, ad_id, date, dimension, segment, spend, impressions, clicks, actions)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (account_id, ad_id, date, dimension, segment) DO UPDATE SET
             spend = $6, impressions = $7, clicks = $8, actions = $9`,
          [ACCOUNT_ID, ad.id, SEED_DATE, dimension, segment,
           Math.round(ad.spend * ratio), Math.round(ad.impressions * ratio), Math.round(ad.clicks * ratio),
           JSON.stringify(actions)],
        );
        segRows++;
      }
    }
  }

  console.log(`✅ シード完了: ${ACCOUNT_ID} 広告${ads.length}件（snapshot + fact_ad_daily@${SEED_DATE} + 内訳${segRows}行）`);
} finally {
  await client.end();
}
