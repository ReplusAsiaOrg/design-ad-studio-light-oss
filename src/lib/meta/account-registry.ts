import { promises as fs } from 'fs';
import path from 'path';
import { isValidAccountId } from './store';
import { hasDb, q } from '../db/client';

/**
 * 分析対象アカウントの登録簿（管理画面から編集）。
 * コード直書きではなくストア管理にして管理画面から登録する。
 * DATABASE_URL があれば Postgres（accounts テーブル）、無ければローカル fs 保存。
 */
const DATA_DIR = path.join(process.cwd(), 'data', 'ads');
const REGISTRY_FILE = path.join(DATA_DIR, 'accounts-registry.json');

export interface RegisteredAccount {
  /** act_ から始まるMeta広告アカウントID */
  accountId: string;
  /** 表示用クライアント名 */
  client: string;
  /** false で同期・レポート対象から一時的に外す（登録は残る） */
  enabled: boolean;
  addedAt: string;
  /** Meta上のアカウント名（登録時のスナップショット・表示補助） */
  accountName?: string;
  note?: string;
  /** 勝ち分析再現（別プロジェクト流用）用のブランドブリーフ */
  brief?: string;
  /** ブランドの目安配色（hex）。流用先の mainColor ステアリングに使う */
  paletteHex?: string[];
}

// ---- DB実装 ----

interface AccountRow {
  account_id: string;
  client: string;
  enabled: boolean;
  account_name: string | null;
  note: string | null;
  added_at: Date;
  brief: string | null;
  palette_hex: string[] | null;
}

function rowToAccount(r: AccountRow): RegisteredAccount {
  return {
    accountId: r.account_id,
    client: r.client,
    enabled: r.enabled,
    addedAt: r.added_at.toISOString(),
    accountName: r.account_name ?? undefined,
    note: r.note ?? undefined,
    brief: r.brief ?? undefined,
    paletteHex: Array.isArray(r.palette_hex) ? r.palette_hex : undefined,
  };
}

// ---- fs実装（ローカル開発フォールバック） ----

async function readRegistryFs(): Promise<RegisteredAccount[]> {
  try {
    const raw = await fs.readFile(REGISTRY_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RegisteredAccount[]) : [];
  } catch {
    return [];
  }
}

async function writeRegistryFs(list: RegisteredAccount[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  // 書きかけJSONを読まれないよう tmp→rename でアトミックに置き換える
  const tmp = `${REGISTRY_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(list, null, 2), 'utf-8');
  await fs.rename(tmp, REGISTRY_FILE);
}

// ---- 公開API ----

/** 登録済み全件（無効含む）。追加順を保持。 */
export async function listRegisteredAccounts(): Promise<RegisteredAccount[]> {
  if (hasDb()) {
    const rows = await q<AccountRow>('SELECT * FROM accounts ORDER BY added_at');
    return rows.map(rowToAccount);
  }
  return readRegistryFs();
}

export async function findRegisteredAccount(accountId: string): Promise<RegisteredAccount | undefined> {
  if (hasDb()) {
    const rows = await q<AccountRow>('SELECT * FROM accounts WHERE account_id = $1', [accountId]);
    return rows[0] ? rowToAccount(rows[0]) : undefined;
  }
  const list = await readRegistryFs();
  return list.find((a) => a.accountId === accountId);
}

export async function addAccount(input: {
  accountId: string;
  client: string;
  accountName?: string;
  note?: string;
}): Promise<RegisteredAccount> {
  if (!isValidAccountId(input.accountId)) {
    throw new Error(`不正なアカウントIDです: ${input.accountId}`);
  }
  const client = input.client.trim();
  if (!client) throw new Error('クライアント名（表示名）を入力してください');

  if (hasDb()) {
    const rows = await q<AccountRow>(
      `INSERT INTO accounts (account_id, client, account_name, note)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id) DO NOTHING
       RETURNING *`,
      [input.accountId, client, input.accountName ?? null, input.note ?? null],
    );
    if (!rows[0]) throw new Error(`既に登録済みのアカウントです: ${input.accountId}`);
    return rowToAccount(rows[0]);
  }

  const list = await readRegistryFs();
  if (list.some((a) => a.accountId === input.accountId)) {
    throw new Error(`既に登録済みのアカウントです: ${input.accountId}`);
  }
  const entry: RegisteredAccount = {
    accountId: input.accountId,
    client,
    enabled: true,
    addedAt: new Date().toISOString(),
    accountName: input.accountName,
    note: input.note,
  };
  list.push(entry);
  await writeRegistryFs(list);
  return entry;
}

export async function updateAccount(
  accountId: string,
  patch: Partial<Pick<RegisteredAccount, 'client' | 'enabled' | 'note' | 'brief' | 'paletteHex'>>,
): Promise<RegisteredAccount> {
  if (patch.client !== undefined && !patch.client.trim()) {
    throw new Error('クライアント名（表示名）は空にできません');
  }

  if (hasDb()) {
    // brief/palette_hex は「undefined＝変更なし / 空文字・空配列＝クリア」（COALESCEのnull=変更なしと使い分け）
    const rows = await q<AccountRow>(
      `UPDATE accounts SET
         client      = COALESCE($2, client),
         enabled     = COALESCE($3, enabled),
         note        = COALESCE($4, note),
         brief       = CASE WHEN $5 THEN $6 ELSE brief END,
         palette_hex = CASE WHEN $7 THEN $8::jsonb ELSE palette_hex END
       WHERE account_id = $1
       RETURNING *`,
      [
        accountId, patch.client?.trim() ?? null, patch.enabled ?? null, patch.note ?? null,
        patch.brief !== undefined, patch.brief?.trim() || null,
        patch.paletteHex !== undefined, patch.paletteHex?.length ? JSON.stringify(patch.paletteHex) : null,
      ],
    );
    if (!rows[0]) throw new Error(`未登録のアカウントです: ${accountId}`);
    return rowToAccount(rows[0]);
  }

  const list = await readRegistryFs();
  const entry = list.find((a) => a.accountId === accountId);
  if (!entry) throw new Error(`未登録のアカウントです: ${accountId}`);
  if (patch.client !== undefined) entry.client = patch.client.trim();
  if (patch.enabled !== undefined) entry.enabled = patch.enabled;
  if (patch.note !== undefined) entry.note = patch.note;
  if (patch.brief !== undefined) entry.brief = patch.brief.trim() || undefined;
  if (patch.paletteHex !== undefined) entry.paletteHex = patch.paletteHex.length ? patch.paletteHex : undefined;
  await writeRegistryFs(list);
  return entry;
}

/** 登録解除。同期済みデータ（snapshots/facts）は消さない（データ保全）。 */
export async function removeAccount(accountId: string): Promise<void> {
  if (hasDb()) {
    const rows = await q('DELETE FROM accounts WHERE account_id = $1 RETURNING account_id', [accountId]);
    if (!rows[0]) throw new Error(`未登録のアカウントです: ${accountId}`);
    return;
  }
  const list = await readRegistryFs();
  const next = list.filter((a) => a.accountId !== accountId);
  if (next.length === list.length) throw new Error(`未登録のアカウントです: ${accountId}`);
  await writeRegistryFs(next);
}
