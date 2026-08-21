import { promises as fs } from 'fs';
import path from 'path';
import { hasDb, q } from '../db/client';

/**
 * 全期間スナップショット保存。
 * DATABASE_URL があれば Postgres（snapshots テーブル）、無ければローカル data/ads/（.gitignore対象）。
 */
const DATA_DIR = path.join(process.cwd(), 'data', 'ads');

export interface StoredAd {
  id: string;
  name: string;
  campaignId?: string;
  adsetId?: string;
  status?: string;
  effectiveStatus?: string;
  creativeId?: string;
  spend: number;
  impressions: number;
  /** 全期間リーチ（期間指定レポートでは使わない。日次の合算は重複するため） */
  reach?: number;
  clicks: number;
  ctr: number;
  cpc: number;
  /** action_type ごとのCV（生）。キャンペーンで最適化対象が違うため正規化せず保持。 */
  actions: { action_type: string; value: number }[];
  costPerActionType: { action_type: string; value: number }[];
}

export interface AccountSnapshot {
  client: string;
  accountId: string;
  accountName: string;
  currency: string;
  syncedAt: string;
  adCount: number;
  ads: StoredAd[];
}

/** accountId は act_数字 のみ許可（クエリ/ボディ経由の値がファイルパスに入るため）。 */
export function isValidAccountId(accountId: string): boolean {
  return /^act_\d+$/.test(accountId);
}

export async function saveSnapshot(snap: AccountSnapshot): Promise<string> {
  if (!isValidAccountId(snap.accountId)) {
    throw new Error(`不正なアカウントIDです: ${snap.accountId}`);
  }

  if (hasDb()) {
    await q(
      `INSERT INTO snapshots (account_id, data, synced_at)
       VALUES ($1, $2, now())
       ON CONFLICT (account_id) DO UPDATE SET data = $2, synced_at = now()`,
      [snap.accountId, JSON.stringify(snap)],
    );
    return `db:snapshots/${snap.accountId}`;
  }

  await fs.mkdir(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, `${snap.accountId}.json`);
  // 書きかけJSONを読まれないよう tmp→rename でアトミックに置き換える
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(snap, null, 2), 'utf-8');
  await fs.rename(tmp, file);
  return file;
}

export async function loadSnapshot(accountId: string): Promise<AccountSnapshot | null> {
  if (!isValidAccountId(accountId)) return null;

  if (hasDb()) {
    const rows = await q<{ data: AccountSnapshot }>(
      'SELECT data FROM snapshots WHERE account_id = $1',
      [accountId],
    );
    return rows[0]?.data ?? null;
  }

  try {
    const file = path.join(DATA_DIR, `${accountId}.json`);
    return JSON.parse(await fs.readFile(file, 'utf-8')) as AccountSnapshot;
  } catch {
    return null;
  }
}

export async function listSnapshots(): Promise<AccountSnapshot[]> {
  if (hasDb()) {
    const rows = await q<{ data: AccountSnapshot }>('SELECT data FROM snapshots ORDER BY account_id');
    return rows.map((r) => r.data);
  }

  try {
    const files = await fs.readdir(DATA_DIR);
    const out: AccountSnapshot[] = [];
    for (const f of files) {
      // アカウントスナップショット（act_*.json）のみ。genes-*.json 等の付随ファイルは除外。
      if (!f.startsWith('act_') || !f.endsWith('.json')) continue;
      out.push(JSON.parse(await fs.readFile(path.join(DATA_DIR, f), 'utf-8')));
    }
    return out;
  } catch {
    return [];
  }
}
