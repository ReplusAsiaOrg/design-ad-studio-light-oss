/**
 * デモモード（DEMO_MODE=1）。
 * Meta Graph API を一切叩かず、架空の化粧品ブランド「LUMINA（サンプル）」の
 * 決定的（乱数シード固定）なダミーデータでアプリ全体を動かす。
 * セミナー・スクリーンショット・OSS利用者の動作確認用。実アカウント情報は一切含まない。
 */
export function isDemoMode(): boolean {
  const v = (process.env.DEMO_MODE ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on';
}
