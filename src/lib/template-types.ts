import type { AspectRatio, FontStyle } from './types';

export type TemplateCategory = 'all' | 'ad' | 'seminar' | 'thumbnail' | 'sns' | 'sale' | 'recruitment';

export const TEMPLATE_CATEGORIES: { value: TemplateCategory; label: string }[] = [
  { value: 'all', label: '全て' },
  { value: 'ad', label: '広告' },
  { value: 'seminar', label: 'セミナー・講座' },
  { value: 'thumbnail', label: 'サムネイル' },
  { value: 'sns', label: 'SNS' },
  { value: 'sale', label: 'セール・キャンペーン' },
  { value: 'recruitment', label: '募集・採用' },
];

export interface TemplateVariable {
  name: string;       // {{name}} の name 部分
  label: string;      // 表示用ラベル
  defaultValue: string; // デフォルト値
}

export interface BannerTemplate {
  id: string;
  title: string;
  description: string;
  category: TemplateCategory;
  prompt: string;     // {{変数}} を含むプロンプトテキスト
  variables: TemplateVariable[];
  formDefaults: {
    mainText: string;
    subText: string;
    extraTexts?: { text: string; decoration?: import('./types').TextDecoration }[];
    mainColor: string;
    aspectRatio: AspectRatio;
    fontStyle: FontStyle;
    hasPersons: boolean;
  };
  logoImage?: string;      // ロゴ画像パス（/templates/xxx.png）— テンプレート選択時に自動セット
  logoPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  staticBackground?: string; // 静的背景画像パス — AI生成をスキップしてこの画像を背景に使う
  thumbnailImage?: string; // サムネ画像パス（/templates/xxx.png）
  thumbnailColor: string;  // サムネ画像がない場合のフォールバックカラー
  createdAt: string;
}

/** プロンプト内の {{変数}} を値で置換する。未定義の変数はそのまま残す。空文字の変数を含む行は削除する */
export function replaceVariables(prompt: string, values: Record<string, string>): string {
  const replaced = prompt.replace(/\{\{(.+?)\}\}/g, (match, name) => values[name] ?? match);
  // 変数が空文字に置換された結果、中身のない行を除去
  return replaced
    .split('\n')
    .filter(line => {
      // 変数置換後に空になった行を検出（前後の装飾テキストだけ残ってるケース）
      // 例: "■ メインタイトルの背後〜下: 「」を薄いグレーの..." → 削除
      if (/「」/.test(line)) return false;
      return true;
    })
    .join('\n');
}

/** プロンプトから変数名を抽出する */
export function extractVariableNames(prompt: string): string[] {
  const matches = prompt.matchAll(/\{\{(.+?)\}\}/g);
  return [...new Set([...matches].map(m => m[1]))];
}
