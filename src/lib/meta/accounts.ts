import { listRegisteredAccounts, findRegisteredAccount } from './account-registry';

/**
 * 分析対象にする広告アカウント。
 * 実体は登録簿（account-registry.ts）にあり、アプリの「アカウント管理」タブから追加・編集する。
 * ここは sync/report が使う読み取りインターフェース。
 */
export interface AdAccountConfig {
  /** 表示用クライアント名 */
  client: string;
  /** act_ から始まるMeta広告アカウントID */
  accountId: string;
}

/** 同期・レポート対象のアカウント一覧（enabled のみ）。 */
export async function listAdAccounts(): Promise<AdAccountConfig[]> {
  const list = await listRegisteredAccounts();
  return list
    .filter((a) => a.enabled)
    .map((a) => ({ client: a.client, accountId: a.accountId }));
}

export async function findAccount(accountId: string): Promise<AdAccountConfig | undefined> {
  const a = await findRegisteredAccount(accountId);
  return a ? { client: a.client, accountId: a.accountId } : undefined;
}
