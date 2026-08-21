import { promises as fs } from 'fs';
import path from 'path';
import { hasDb, q } from '../db/client';
import { DEFAULT_SCORING_SETTINGS, type ScoringSettings } from '../scoring';

/**
 * クライアント（アカウント）別の評価設定。
 * 部分上書きを保存し、読み出し時に既定値とマージする。
 * DATABASE_URL があれば Postgres（account_settings・jsonb）、
 * 無ければ data/ads/account-settings.json（accountId → 部分上書き のマップ）。
 */

const DATA_DIR = path.join(process.cwd(), 'data', 'ads');
const SETTINGS_FILE = path.join(DATA_DIR, 'account-settings.json');

async function readFileMap(): Promise<Record<string, Partial<ScoringSettings>>> {
  try {
    return JSON.parse(await fs.readFile(SETTINGS_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

async function writeFileMap(map: Record<string, Partial<ScoringSettings>>): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  // 書き込み途中のプロセス停止で設定ファイルを壊さないよう tmp → rename
  const tmp = `${SETTINGS_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(map, null, 2), 'utf-8');
  await fs.rename(tmp, SETTINGS_FILE);
}

async function loadStored(accountId: string): Promise<Partial<ScoringSettings> | undefined> {
  if (hasDb()) {
    const rows = await q<{ settings: Partial<ScoringSettings> }>(
      'SELECT settings FROM account_settings WHERE account_id = $1',
      [accountId],
    );
    return rows[0]?.settings;
  }
  return (await readFileMap())[accountId];
}

function mergeWithDefaults(stored: Partial<ScoringSettings> | undefined): ScoringSettings {
  if (!stored) return DEFAULT_SCORING_SETTINGS;
  return {
    ...DEFAULT_SCORING_SETTINGS,
    ...stored,
    roasPct: { ...DEFAULT_SCORING_SETTINGS.roasPct, ...stored.roasPct },
    spendRank: { ...DEFAULT_SCORING_SETTINGS.spendRank, ...stored.spendRank },
    spendRankBreakdown: { ...DEFAULT_SCORING_SETTINGS.spendRankBreakdown, ...stored.spendRankBreakdown },
    starSpendMin: { ...DEFAULT_SCORING_SETTINGS.starSpendMin, ...stored.starSpendMin },
    winFilter: { ...DEFAULT_SCORING_SETTINGS.winFilter, ...stored.winFilter },
  };
}

export async function getScoringSettings(accountId: string): Promise<ScoringSettings> {
  return mergeWithDefaults(await loadStored(accountId));
}

/** 上書き設定が保存されているか（設定画面の「カスタマイズ済み」表示用）。 */
export async function hasCustomSettings(accountId: string): Promise<boolean> {
  return (await loadStored(accountId)) !== undefined;
}

export async function saveScoringSettings(
  accountId: string,
  settings: Partial<ScoringSettings>,
): Promise<void> {
  if (hasDb()) {
    await q(
      `INSERT INTO account_settings (account_id, settings, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (account_id) DO UPDATE SET settings = $2, updated_at = now()`,
      [accountId, JSON.stringify(settings)],
    );
    return;
  }
  const map = await readFileMap();
  map[accountId] = settings;
  await writeFileMap(map);
}

/** 上書きを削除して既定値に戻す。 */
export async function deleteScoringSettings(accountId: string): Promise<void> {
  if (hasDb()) {
    await q('DELETE FROM account_settings WHERE account_id = $1', [accountId]);
    return;
  }
  const map = await readFileMap();
  if (accountId in map) {
    delete map[accountId];
    await writeFileMap(map);
  }
}
