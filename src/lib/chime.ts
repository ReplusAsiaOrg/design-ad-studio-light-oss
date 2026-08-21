'use client';

/**
 * 生成完了の「ピコン！」音。各生成フロー（単発・素材・バリエーション・勝ち分析・一括）の
 * 完了時に鳴らす。時間がかかる間にユーザーが他の作業をしていても気づけるように。
 *
 * ON/OFF は localStorage で全ページ共通に保持する（既定 ON）。
 */

const STORAGE_KEY = 'banner-chime-enabled';

export function isChimeEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem(STORAGE_KEY) !== '0';
}

export function setChimeEnabled(on: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
}

/** Web Audio で2音（A5→E6）の上昇チャイムを合成（音声ファイル不要） */
export function playChime(): void {
  try {
    if (typeof window === 'undefined') return;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [{ f: 880, t: 0 }, { f: 1318.5, t: 0.12 }].forEach(({ f, t }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, now + t);
      gain.gain.exponentialRampToValueAtTime(0.25, now + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + t);
      osc.stop(now + t + 0.32);
    });
    setTimeout(() => ctx.close(), 900);
  } catch {
    /* 音が出せない環境では無視 */
  }
}

/** 設定が ON のときだけ鳴らす（各フローの完了時はこちらを呼ぶ） */
export function playChimeIfEnabled(): void {
  if (isChimeEnabled()) playChime();
}
