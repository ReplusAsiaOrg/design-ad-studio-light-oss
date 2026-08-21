import { promises as fs } from 'fs';
import path from 'path';
import type { CreativeTraits } from '../genes';
import { hasDb, q } from '../db/client';

/**
 * vision分類した CreativeTraits をキャッシュする（同じ画像を二度課金しない）。
 * DATABASE_URL があれば Postgres（gene_caches テーブル）、無ければ data/ads/genes-<accountId>.json。
 * キーは creativeId（複数広告が同じcreativeを共有しても1回で済む）。
 */

const DATA_DIR = path.join(process.cwd(), 'data', 'ads');

export interface GeneRecord {
  creativeId: string;
  genes: CreativeTraits;
  isVideo: boolean;
  imageUrl?: string;
  classifiedAt: string;
}

export type GeneCache = Record<string, GeneRecord>;

function cacheFile(accountId: string): string {
  return path.join(DATA_DIR, `genes-${accountId}.json`);
}

export async function loadGeneCache(accountId: string): Promise<GeneCache> {
  if (hasDb()) {
    const rows = await q<{ creative_id: string; record: GeneRecord }>(
      'SELECT creative_id, record FROM gene_caches WHERE account_id = $1',
      [accountId],
    );
    const cache: GeneCache = {};
    for (const r of rows) cache[r.creative_id] = r.record;
    return cache;
  }

  try {
    return JSON.parse(await fs.readFile(cacheFile(accountId), 'utf-8')) as GeneCache;
  } catch {
    return {};
  }
}

export async function saveGeneCache(accountId: string, cache: GeneCache): Promise<string> {
  if (hasDb()) {
    // キー単位のupsertなので、並行リクエストが保存した他creativeの分類を消さない
    for (const [creativeId, record] of Object.entries(cache)) {
      await q(
        `INSERT INTO gene_caches (account_id, creative_id, record)
         VALUES ($1, $2, $3)
         ON CONFLICT (account_id, creative_id) DO UPDATE SET record = $3`,
        [accountId, creativeId, JSON.stringify(record)],
      );
    }
    return `db:gene_caches/${accountId}`;
  }

  await fs.mkdir(DATA_DIR, { recursive: true });
  const file = cacheFile(accountId);
  // load→分類（長時間）→save の間に別リクエストが保存した分類を消さないよう、
  // 保存直前にディスクの最新とマージする（キー単位の後勝ちは許容）。
  const current = await loadGeneCache(accountId);
  const merged: GeneCache = { ...current, ...cache };
  // tmp→rename でアトミックに置き換え（書きかけJSON読み込み防止）
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(merged, null, 2), 'utf-8');
  await fs.rename(tmp, file);
  return file;
}
