'use client';

import { useEffect, useState } from 'react';

/**
 * 表紙（ホーム画面）。アクセス直後はここだけを表示し、Meta取得（広告レポート）は
 * アカウントカードをクリックして初めて走らせる。
 * - 広告分析: 登録アカウントのカード（/api/meta/accounts＝DBのみで軽い）→ クリックでレポートへ
 * - 広告CR生成: 生成系ツールのカード → クリックで各タブへ
 */

interface AccountCard {
  accountId: string;
  client: string;
  accountName?: string;
  enabled: boolean;
  lastSyncedAt?: string;
  adCount?: number;
}

export interface HomeTool {
  tab: string;
  icon: string;
  label: string;
  desc: string;
  disabled?: boolean;
}

const TOOLS: HomeTool[] = [
  { tab: 'winning', icon: '🏆', label: '勝ち分析再現', desc: '勝ちCRを起点に新CRを生成' },
  { tab: 'create', icon: '🎨', label: 'バナー作成', desc: 'キャッチコピーから作成' },
  { tab: 'url', icon: '🖼️', label: '素材から生成', desc: '手持ち素材・URLからバナー化' },
  { tab: 'variation', icon: '🔁', label: 'バリエーション作成', desc: '1枚から複数パターン展開' },
  { tab: 'prompt', icon: '✍️', label: 'プロンプトジェネレーター', desc: '生成プロンプトを設計' },
  { tab: 'template', icon: '📐', label: '勝ちテンプレート', desc: 'light版では利用できません', disabled: true },
];

const fmtDate = (iso?: string) => {
  if (!iso) return null;
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export default function HomeCover({ onOpenAccount, onOpenTool, isAdmin }: {
  onOpenAccount: (accountId: string) => void;
  onOpenTool: (tab: string) => void;
  isAdmin: boolean;
}) {
  const [accounts, setAccounts] = useState<AccountCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/meta/accounts')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.ok) setAccounts((d.accounts as AccountCard[]).filter((a) => a.enabled));
        else setError(d.error ?? 'アカウント一覧の取得に失敗しました');
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : '通信エラー'); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-10 space-y-12">
      {/* 広告分析 */}
      <section>
        <div className="flex items-baseline gap-3 mb-1">
          <h2 className="text-xl font-bold text-gray-900">📊 広告分析</h2>
          <p className="text-xs text-gray-400">アカウントを選ぶとレポートを読み込みます</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mt-4">
          {accounts == null && !error && (
            [0, 1].map((i) => <div key={i} className="h-28 rounded-2xl bg-gray-100 animate-pulse" />)
          )}
          {error && (
            <div className="col-span-full rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-600">{error}</div>
          )}
          {accounts?.map((a) => (
            <button
              key={a.accountId}
              onClick={() => onOpenAccount(a.accountId)}
              className="group text-left rounded-2xl border border-gray-200 bg-white p-5 hover:border-blue-400 hover:shadow-md transition-all active:scale-[0.99]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-lg font-bold text-gray-900 truncate">{a.client}</span>
                <span className="text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity text-sm font-bold shrink-0">レポートを開く →</span>
              </div>
              {a.accountName && <p className="text-[11px] text-gray-400 truncate mt-0.5" title={a.accountName}>{a.accountName}</p>}
              <div className="flex items-center gap-3 mt-3 text-[11px] text-gray-500">
                {a.adCount != null && <span>広告 <b className="text-gray-700">{a.adCount}</b> 件</span>}
                {a.lastSyncedAt && <span>最終同期 {fmtDate(a.lastSyncedAt)}</span>}
                {!a.lastSyncedAt && <span className="text-amber-600">未同期</span>}
              </div>
            </button>
          ))}
          {accounts != null && isAdmin && (
            <button
              onClick={() => onOpenTool('accounts')}
              className="rounded-2xl border-2 border-dashed border-gray-200 p-5 text-sm text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors flex items-center justify-center min-h-28"
            >
              ＋ 広告アカウントを追加
            </button>
          )}
        </div>
      </section>

      {/* 広告CR生成 */}
      <section>
        <div className="flex items-baseline gap-3 mb-1">
          <h2 className="text-xl font-bold text-gray-900">🎨 広告CR生成</h2>
          <p className="text-xs text-gray-400">バナーの新規作成・展開</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mt-4">
          {TOOLS.map((t) => (
            <button
              key={t.tab}
              onClick={() => { if (!t.disabled) onOpenTool(t.tab); }}
              disabled={t.disabled}
              title={t.disabled ? 'light版では利用できません' : undefined}
              className={`text-left rounded-2xl border p-5 transition-all ${
                t.disabled
                  ? 'border-gray-100 bg-gray-50 cursor-not-allowed opacity-60'
                  : 'border-gray-200 bg-white hover:border-blue-400 hover:shadow-md active:scale-[0.99]'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span className={`text-2xl ${t.disabled ? 'grayscale' : ''}`}>{t.icon}</span>
                <div>
                  <p className={`text-sm font-bold ${t.disabled ? 'text-gray-400' : 'text-gray-900'}`}>{t.label}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{t.desc}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
