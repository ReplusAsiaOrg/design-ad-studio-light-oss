import type { DestinationBrief } from '@/lib/types';

/**
 * cross-project（別プロジェクト流用）の「流用先プロジェクト」プリセット。
 * アカウントを選ぶとブランド文脈（brief）と配色（paletteHex）の既定値が入る。
 * brief は UI 上で編集可能（プリセットはあくまで初期値）。
 *
 * paletteHex はブランドの世界観を表す目安色。流用先の mainColor ステアリングに使う。
 * 厳密なブランドガイドではないので、必要に応じて調整する。
 */
export type DestinationAccountPreset = Required<Pick<DestinationBrief, 'accountId' | 'name' | 'brief' | 'paletteHex'>>;

export const DESTINATION_ACCOUNTS: DestinationAccountPreset[] = [
  {
    accountId: 'act_0000000000000001',
    name: 'サンプルブランドA（食・健康）',
    brief: '女性向けの食・健康ブランドのサンプル。温かみがあり、季節感を大切にするトーン。ターゲットは美容・健康に関心のある30〜50代女性。権威性（専門家監修）とベネフィット（体が整う）が刺さる想定。実際のブランドに合わせて書き換えて使う。',
    paletteHex: ['#A8472E', '#E0A458', '#7B8B5A', '#F4E9D8'],
  },
  {
    accountId: 'act_0000000000000002',
    name: 'サンプルブランドB（育児サポート）',
    brief: '赤ちゃん・育児サポートブランドのサンプル。やさしく明るく、安心感のあるトーン。ターゲットは妊娠中〜乳幼児を育てるママ。専門家の安心感と「今のうちに知っておきたい」共感が刺さる想定。実際のブランドに合わせて書き換えて使う。',
    paletteHex: ['#F6C6C6', '#FCEAD3', '#A9D4E0', '#FBF6EE'],
  },
];

export function findDestinationAccount(accountId?: string): DestinationAccountPreset | undefined {
  if (!accountId) return undefined;
  return DESTINATION_ACCOUNTS.find(a => a.accountId === accountId);
}
