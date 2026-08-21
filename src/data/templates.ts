import type { BannerTemplate } from '@/lib/template-types';

/**
 * light版ではテンプレート（勝ちテンプレート）は未提供のため空。
 * タブ自体もグレーアウトしており画面から到達しない。
 * 追加する場合は BannerTemplate 形式で定義し、サムネ画像は public/templates/ に置く
 * （実在の人物写真・実名・ブランドロゴを含む素材は入れないこと）。
 */
export const TEMPLATES: BannerTemplate[] = [];
