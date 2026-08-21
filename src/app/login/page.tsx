'use client';

import { useState } from 'react';

/**
 * ログイン画面（Issue #6）。認証は /auth/login（Route Handler・サーバー側で
 * Supabase Auth を呼ぶ）に委譲する＝ブラウザに Supabase キーを持たせない。
 */
export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error ?? `ログインに失敗しました (HTTP ${res.status})`);
        return;
      }
      // middleware にセッション cookie を確実に評価させるためフルリロードで遷移
      window.location.href = '/';
    } catch {
      setError('通信エラーが発生しました。時間をおいて再度お試しください');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Ad Studio Light</h1>
          <p className="text-xs text-gray-400 mt-1">Meta広告レポート＆勝ちCR分析・生成スタジオ</p>
        </div>
        <form onSubmit={submit} className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">メールアドレス</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">パスワード</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            disabled={isSubmitting || !email || !password}
            className="w-full py-2.5 rounded-lg font-bold text-white text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-blue-600 hover:bg-blue-500 active:scale-[0.98]"
          >
            {isSubmitting ? 'ログイン中...' : 'ログイン'}
          </button>
          <p className="text-[11px] text-gray-400 leading-relaxed">
            アカウントは管理者が発行します。ログインできない場合は担当者にお問い合わせください。
          </p>
        </form>
      </div>
    </div>
  );
}
