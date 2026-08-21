'use client';

import { useEffect, useState } from 'react';

export interface Me {
  /** legacy = Basic認証フォールバック中（ログアウトUI非表示・全機能） */
  mode: 'legacy' | 'cron' | 'supabase';
  email: string | null;
  role: 'admin' | 'member';
  isAdmin: boolean;
  /** デモモード（架空データ）で起動中 */
  demo?: boolean;
}

/**
 * ログイン中ユーザー情報（/api/me）。取得完了まで null。
 * 管理UIの表示判定は「me?.isAdmin ?? false」で行う（取得前・失敗時に管理UIを見せない）。
 */
export function useMe(): Me | null {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/me')
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d.ok) setMe(d as Me);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return me;
}
