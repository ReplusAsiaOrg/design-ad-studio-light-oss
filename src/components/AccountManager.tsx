'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ScoringSettingsEditor from './ScoringSettingsEditor';

interface RegisteredRow {
  accountId: string;
  client: string;
  enabled: boolean;
  addedAt: string;
  accountName?: string;
  note?: string;
  brief?: string;
  paletteHex?: string[];
  lastSyncedAt?: string;
  adCount?: number;
  currency?: string;
}

interface AvailableRow {
  accountId: string;
  name: string;
  accountStatus?: number;
  currency?: string;
  amountSpent?: string;
  businessName?: string;
  registered: boolean;
}

/** Meta account_status → 表示ラベル */
function statusLabel(s?: number): { label: string; className: string } {
  switch (s) {
    case 1: return { label: '有効', className: 'bg-emerald-50 text-emerald-600' };
    case 2: return { label: '停止', className: 'bg-red-50 text-red-500' };
    case 3: return { label: '未払い', className: 'bg-amber-50 text-amber-600' };
    case 101: return { label: '閉鎖', className: 'bg-gray-100 text-gray-400' };
    default: return { label: s != null ? `status:${s}` : '—', className: 'bg-gray-100 text-gray-400' };
  }
}

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** amount_spent は通貨最小単位の文字列（JPYはそのまま円）。ざっくり規模感表示用。 */
function fmtSpent(v?: string, currency?: string): string {
  const n = Number(v);
  if (!v || !Number.isFinite(n)) return '—';
  const yen = currency === 'JPY' ? n : n / 100;
  if (yen >= 100_000_000) return `${(yen / 100_000_000).toFixed(1)}億`;
  if (yen >= 10_000) return `${Math.round(yen / 10_000).toLocaleString('ja-JP')}万`;
  return Math.round(yen).toLocaleString('ja-JP');
}

export default function AccountManager() {
  const [registered, setRegistered] = useState<RegisteredRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 追加候補（Metaから取得）
  const [available, setAvailable] = useState<AvailableRow[] | null>(null);
  const [availableError, setAvailableError] = useState<string | null>(null);
  const [loadingAvailable, setLoadingAvailable] = useState(false);
  const [query, setQuery] = useState('');
  const [showPicker, setShowPicker] = useState(false);

  // 同期中のアカウントID（'*' は全件）
  const [syncing, setSyncing] = useState<Set<string>>(new Set());
  // 勝ちCRのvision分類（CR分類）実行中のアカウントID
  const [classifying, setClassifying] = useState<Set<string>>(new Set());
  // 過去取込（初回バックフィル）の進捗。同時実行は1アカウントのみ
  const [backfill, setBackfill] = useState<{ accountId: string; done: number; total: number | null; month: string } | null>(null);
  // 表示名の編集中
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  // 評価設定モーダルの対象
  const [settingsTarget, setSettingsTarget] = useState<RegisteredRow | null>(null);
  // ブリーフ編集モーダルの対象（勝ち分析再現の流用先で使うブランド説明・配色）
  const [briefTarget, setBriefTarget] = useState<RegisteredRow | null>(null);

  const loadRegistered = useCallback(async () => {
    try {
      const res = await fetch('/api/meta/accounts');
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? '一覧の取得に失敗しました');
      setRegistered(json.accounts);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '一覧の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadRegistered(); }, [loadRegistered]);

  const loadAvailable = useCallback(async () => {
    setLoadingAvailable(true);
    setAvailableError(null);
    try {
      const res = await fetch('/api/meta/accounts/available');
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? 'アカウント一覧の取得に失敗しました');
      setAvailable(json.accounts);
    } catch (e) {
      setAvailableError(e instanceof Error ? e.message : 'アカウント一覧の取得に失敗しました');
      setAvailable(null);
    } finally {
      setLoadingAvailable(false);
    }
  }, []);

  const openPicker = useCallback(() => {
    setShowPicker(true);
    if (!available && !loadingAvailable) loadAvailable();
  }, [available, loadingAvailable, loadAvailable]);

  const post = useCallback(async (body: Record<string, unknown>): Promise<boolean> => {
    try {
      const res = await fetch('/api/meta/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? '更新に失敗しました');
      setError(null);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新に失敗しました');
      return false;
    }
  }, []);

  // 勝ちCRのvision分類（genes）。同期にも組み込まれているが、分類だけやり直したい時用
  const runGenes = useCallback(async (accountId: string, label: string) => {
    setClassifying((prev) => new Set(prev).add(accountId));
    setNotice(null);
    try {
      const res = await fetch('/api/meta/genes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: accountId }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? 'CR分類に失敗しました');
      setNotice(
        json.classified > 0
          ? `CR分類完了: 「${label}」 新規${json.classified}件を分類（累計${json.cacheTotal}件）`
          : `CR分類: 「${label}」 新規対象なし（累計${json.cacheTotal ?? 0}件）${json.note ? ` — ${json.note}` : ''}`,
      );
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'CR分類に失敗しました');
    } finally {
      setClassifying((prev) => {
        const next = new Set(prev);
        next.delete(accountId);
        return next;
      });
    }
  }, []);

  // 過去取込（初回バックフィル）: /api/meta/backfill を next が無くなるまで月次で呼ぶ。
  // 配置×CVを壊さないための月次チャンク実行ルールをUI側から誰でも安全に実行できる形にしたもの
  const runBackfill = useCallback(async (accountId: string, label: string) => {
    if (backfill) {
      setNotice('別の過去取込が実行中です。完了後にもう一度「過去取込」を押してください');
      return;
    }
    setNotice(null);
    setBackfill({ accountId, done: 0, total: null, month: '準備中' });
    try {
      let cursor: string | undefined;
      let total: number | null = null;
      let done = 0;
      for (;;) {
        const res = await fetch('/api/meta/backfill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account: accountId, cursor }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error ?? '過去取込に失敗しました');
        if (json.totalMonths != null) total = json.totalMonths;
        if (json.processed) {
          done += 1;
          setBackfill({ accountId, done, total, month: json.processed.since.slice(0, 7) });
        }
        if (!json.next) break;
        cursor = json.next;
      }
      // 取込完了後、勝ちCRのvision分類も自動実行（勝ち分析再現ですぐ使えるようにする）
      setBackfill({ accountId, done, total, month: 'CR分類中' });
      let genesNote = '';
      try {
        const gr = await fetch('/api/meta/genes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account: accountId }),
        });
        const gj = await gr.json();
        genesNote = gj.ok
          ? `／勝ちCR分類 ${gj.classified ?? 0}件`
          : `（CR分類は失敗: ${gj.error ?? '不明'}。「CR分類」ボタンで再実行できます）`;
      } catch {
        genesNote = '（CR分類は失敗。「CR分類」ボタンで再実行できます）';
      }
      setNotice(`過去取込完了: 「${label}」 ${done}ヶ月分を取り込みました${genesNote}`);
      setError(null);
      await loadRegistered();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '過去取込に失敗しました';
      setError(`${msg}（「${label}」。もう一度「過去取込」を押すと最初から再実行されます。取り込み済みの月は上書きされるだけなので安全です）`);
    } finally {
      setBackfill(null);
    }
  }, [backfill, loadRegistered]);

  const handleAdd = useCallback(async (row: AvailableRow) => {
    const ok = await post({ action: 'add', accountId: row.accountId, client: row.name, accountName: row.name });
    if (ok) {
      setAvailable((prev) => prev?.map((a) => a.accountId === row.accountId ? { ...a, registered: true } : a) ?? null);
      setNotice(`「${row.name}」を登録しました。表示名は一覧から変更できます`);
      await loadRegistered();
      // 登録直後に過去データの取り込みを自動開始（別の取込が実行中なら手動で後追い）
      runBackfill(row.accountId, row.name);
    }
  }, [post, loadRegistered, runBackfill]);

  const handleRemove = useCallback(async (row: RegisteredRow) => {
    if (!window.confirm(`「${row.client}」を登録解除しますか？\n（同期済みデータは残ります）`)) return;
    const ok = await post({ action: 'remove', accountId: row.accountId });
    if (ok) {
      setAvailable((prev) => prev?.map((a) => a.accountId === row.accountId ? { ...a, registered: false } : a) ?? null);
      await loadRegistered();
    }
  }, [post, loadRegistered]);

  const handleToggle = useCallback(async (row: RegisteredRow) => {
    const ok = await post({ action: 'update', accountId: row.accountId, enabled: !row.enabled });
    if (ok) await loadRegistered();
  }, [post, loadRegistered]);

  const saveClientName = useCallback(async (accountId: string) => {
    const name = editingName.trim();
    setEditingId(null);
    if (!name) return;
    const ok = await post({ action: 'update', accountId, client: name });
    if (ok) await loadRegistered();
  }, [editingName, post, loadRegistered]);

  const handleSync = useCallback(async (accountIds: string[] | null) => {
    const key = accountIds ? accountIds : ['*'];
    setSyncing((prev) => new Set([...prev, ...key]));
    setNotice(null);
    try {
      const res = await fetch('/api/meta/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(accountIds ? { accounts: accountIds } : {}),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? '同期に失敗しました');
      const total = (json.accounts as { adCount: number }[]).reduce((s, a) => s + a.adCount, 0);
      setNotice(`同期完了: ${json.accounts.length}アカウント / 広告${total.toLocaleString('ja-JP')}件`);
      setError(null);
      await loadRegistered();
    } catch (e) {
      setError(e instanceof Error ? e.message : '同期に失敗しました');
    } finally {
      setSyncing((prev) => {
        const next = new Set(prev);
        for (const k of key) next.delete(k);
        return next;
      });
    }
  }, [loadRegistered]);

  const filteredAvailable = useMemo(() => {
    if (!available) return [];
    const q = query.trim().toLowerCase();
    if (!q) return available;
    return available.filter((a) =>
      a.name.toLowerCase().includes(q) ||
      a.accountId.toLowerCase().includes(q) ||
      (a.businessName ?? '').toLowerCase().includes(q),
    );
  }, [available, query]);

  const enabledCount = registered.filter((a) => a.enabled).length;
  const syncingAll = syncing.has('*');

  return (
    <div className="space-y-4">
      {/* ヘッダー */}
      <div className="flex flex-wrap items-center gap-2 bg-white rounded-xl border border-gray-200 p-3">
        <div>
          <h2 className="text-sm font-bold text-gray-800">アカウント管理</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            登録 {registered.length} 件（同期対象 {enabledCount} 件）— 分析対象にする広告アカウントをここで厳選する
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => handleSync(null)}
            disabled={syncingAll || enabledCount === 0}
            className="py-1.5 px-3 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
          >
            {syncingAll ? '同期中…' : '全て同期'}
          </button>
          <button
            onClick={openPicker}
            className="py-1.5 px-3 rounded-lg text-xs font-medium border border-gray-200 bg-white text-gray-700 hover:border-gray-300"
          >
            ＋ アカウントを追加
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 text-red-600 text-xs rounded-xl px-4 py-2.5">{error}</div>
      )}
      {notice && (
        <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 text-xs rounded-xl px-4 py-2.5">{notice}</div>
      )}

      {/* 登録済み一覧 */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-400 text-sm">読み込み中...</div>
        ) : registered.length === 0 ? (
          <div className="p-12 text-center text-gray-400 text-sm">
            登録済みアカウントがありません。<br />
            「＋ アカウントを追加」からMetaの広告アカウントを選んで登録してください。
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 bg-gray-50/60 border-b border-gray-100">
                  <th className="text-left font-medium px-4 py-2.5">クライアント名（表示名）</th>
                  <th className="text-left font-medium px-3 py-2.5">Metaアカウント名</th>
                  <th className="text-left font-medium px-3 py-2.5">アカウントID</th>
                  <th className="text-left font-medium px-3 py-2.5">最終同期</th>
                  <th className="text-right font-medium px-3 py-2.5">広告数</th>
                  <th className="text-center font-medium px-3 py-2.5">同期対象</th>
                  <th className="text-right font-medium px-4 py-2.5">操作</th>
                </tr>
              </thead>
              <tbody>
                {registered.map((row) => {
                  const isSyncing = syncing.has(row.accountId) || syncingAll;
                  return (
                    <tr key={row.accountId} className={`border-b border-gray-50 ${row.enabled ? '' : 'opacity-50'}`}>
                      <td className="px-4 py-2.5">
                        {editingId === row.accountId ? (
                          <input
                            autoFocus
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onBlur={() => saveClientName(row.accountId)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveClientName(row.accountId);
                              if (e.key === 'Escape') setEditingId(null);
                            }}
                            className="border border-blue-300 rounded px-2 py-1 text-xs w-40 outline-none"
                          />
                        ) : (
                          <button
                            onClick={() => { setEditingId(row.accountId); setEditingName(row.client); }}
                            className="font-medium text-gray-800 hover:text-blue-600 text-left"
                            title="クリックで表示名を編集"
                          >
                            {row.client} <span className="text-gray-300">✎</span>
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-gray-500">{row.accountName ?? '—'}</td>
                      <td className="px-3 py-2.5 text-gray-400 font-mono">{row.accountId}</td>
                      <td className="px-3 py-2.5 text-gray-500">{fmtDate(row.lastSyncedAt)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-500">
                        {row.adCount != null ? row.adCount.toLocaleString('ja-JP') : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <button
                          onClick={() => handleToggle(row)}
                          className={`inline-flex h-5 w-9 items-center rounded-full transition-colors ${row.enabled ? 'bg-blue-600' : 'bg-gray-200'}`}
                          title={row.enabled ? '同期対象から外す' : '同期対象に戻す'}
                        >
                          <span className={`h-4 w-4 rounded-full bg-white shadow transform transition-transform ${row.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                        </button>
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <button
                          onClick={() => runBackfill(row.accountId, row.client)}
                          disabled={isSyncing || backfill != null || !row.enabled}
                          className={`py-1 px-2.5 rounded-md text-xs font-medium border disabled:opacity-40 mr-1.5 ${
                            backfill?.accountId === row.accountId
                              ? 'border-indigo-300 text-indigo-600 bg-indigo-50 !opacity-100'
                              : 'border-gray-200 text-gray-600 hover:border-indigo-300 hover:text-indigo-600'
                          }`}
                          title="配信開始からの全期間を月ごとに取り込む（登録後に1回実行。失敗時は再実行すればよい）"
                        >
                          {backfill?.accountId === row.accountId
                            ? `取込中 ${backfill.month}${backfill.total ? `（${backfill.done}/${backfill.total}）` : ''}`
                            : '過去取込'}
                        </button>
                        <button
                          onClick={() => handleSync([row.accountId])}
                          disabled={isSyncing || !row.enabled}
                          className="py-1 px-2.5 rounded-md text-xs font-medium border border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-600 disabled:opacity-40 mr-1.5"
                        >
                          {isSyncing ? '同期中…' : '同期'}
                        </button>
                        <button
                          onClick={() => runGenes(row.accountId, row.client)}
                          disabled={isSyncing || classifying.has(row.accountId) || !row.enabled}
                          className="py-1 px-2.5 rounded-md text-xs font-medium border border-gray-200 text-gray-600 hover:border-amber-400 hover:text-amber-600 disabled:opacity-40 mr-1.5"
                          title="勝ち/負けCRの画像をAIが分析し「勝ち分析再現」のピッカーに反映する（同期・過去取込でも自動実行される）"
                        >
                          {classifying.has(row.accountId) ? '分類中…' : 'CR分類'}
                        </button>
                        <button
                          onClick={() => setSettingsTarget(row)}
                          className="py-1 px-2.5 rounded-md text-xs font-medium border border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-600 mr-1.5"
                          title="報酬単価・ROAS基準などクライアント別の評価設定"
                        >
                          評価設定
                        </button>
                        <button
                          onClick={() => setBriefTarget(row)}
                          className={`py-1 px-2.5 rounded-md text-xs font-medium border mr-1.5 ${
                            row.brief?.trim()
                              ? 'border-gray-200 text-gray-600 hover:border-violet-300 hover:text-violet-600'
                              : 'border-amber-200 text-amber-600 bg-amber-50/60 hover:border-amber-400'
                          }`}
                          title="勝ち分析再現（別プロジェクト流用）で流用先に選んだとき初期投入されるブランド説明・配色"
                        >
                          {row.brief?.trim() ? 'ブリーフ' : 'ブリーフ未設定'}
                        </button>
                        <button
                          onClick={() => handleRemove(row)}
                          className="py-1 px-2.5 rounded-md text-xs font-medium text-gray-400 hover:text-red-500"
                        >
                          削除
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 追加候補（Metaの全アカウント） */}
      {showPicker && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100 flex flex-wrap items-center gap-2">
            <h3 className="text-xs font-bold text-gray-700">Metaの広告アカウント一覧</h3>
            {available && (
              <span className="text-[11px] text-gray-400">
                {filteredAvailable.length} / {available.length} 件
              </span>
            )}
            <div className="ml-auto flex items-center gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="アカウント名・ID・ビジネス名で検索"
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs w-64 outline-none focus:border-blue-400"
              />
              <button
                onClick={loadAvailable}
                disabled={loadingAvailable}
                className="py-1.5 px-3 rounded-lg text-xs font-medium border border-gray-200 text-gray-600 hover:border-gray-300 disabled:opacity-40"
              >
                再取得
              </button>
              <button
                onClick={() => setShowPicker(false)}
                className="py-1.5 px-2 rounded-lg text-xs text-gray-400 hover:text-gray-600"
              >
                閉じる
              </button>
            </div>
          </div>

          {loadingAvailable ? (
            <div className="p-12 text-center text-gray-400 text-sm">Metaから取得中...</div>
          ) : availableError ? (
            <div className="p-8 text-center text-sm">
              <p className="text-red-500">{availableError}</p>
              <button onClick={loadAvailable} className="mt-3 py-1.5 px-3 rounded-lg text-xs font-medium border border-gray-200 text-gray-600 hover:border-gray-300">
                再試行
              </button>
            </div>
          ) : filteredAvailable.length === 0 ? (
            <div className="p-12 text-center text-gray-400 text-sm">該当するアカウントがありません</div>
          ) : (
            <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-gray-400 bg-gray-50/60 border-b border-gray-100">
                    <th className="text-left font-medium px-4 py-2.5">アカウント名</th>
                    <th className="text-left font-medium px-3 py-2.5">ビジネス</th>
                    <th className="text-left font-medium px-3 py-2.5">アカウントID</th>
                    <th className="text-center font-medium px-3 py-2.5">状態</th>
                    <th className="text-right font-medium px-3 py-2.5">累計消化（目安）</th>
                    <th className="text-right font-medium px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAvailable.map((row) => {
                    const st = statusLabel(row.accountStatus);
                    return (
                      <tr key={row.accountId} className="border-b border-gray-50 hover:bg-gray-50/60">
                        <td className="px-4 py-2 font-medium text-gray-700">{row.name}</td>
                        <td className="px-3 py-2 text-gray-500">{row.businessName ?? '—'}</td>
                        <td className="px-3 py-2 text-gray-400 font-mono">{row.accountId}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-medium ${st.className}`}>{st.label}</span>
                        </td>
                        <td className="px-3 py-2 text-right text-gray-500">{fmtSpent(row.amountSpent, row.currency)}</td>
                        <td className="px-4 py-2 text-right">
                          {row.registered ? (
                            <span className="text-[11px] text-gray-300">登録済み</span>
                          ) : (
                            <button
                              onClick={() => handleAdd(row)}
                              className="py-1 px-2.5 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-700"
                            >
                              追加
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 評価設定モーダル */}
      {settingsTarget && (
        <ScoringSettingsEditor
          accountId={settingsTarget.accountId}
          clientName={settingsTarget.client}
          onClose={() => setSettingsTarget(null)}
        />
      )}

      {/* ブリーフ編集モーダル */}
      {briefTarget && (
        <BriefEditor
          row={briefTarget}
          onClose={() => setBriefTarget(null)}
          onSaved={async (client) => {
            setNotice(`「${client}」のブリーフを保存しました（勝ち分析再現の流用先で初期投入されます）`);
            await loadRegistered();
          }}
        />
      )}
    </div>
  );
}

/**
 * ブリーフ編集モーダル。勝ち分析再現（別プロジェクト流用）で流用先アカウントを選んだとき
 * 初期投入されるブランド説明（brief）とブランド配色（paletteHex）を編集する。
 */
function BriefEditor({ row, onClose, onSaved }: {
  row: RegisteredRow;
  onClose: () => void;
  onSaved: (client: string) => void | Promise<void>;
}) {
  const [brief, setBrief] = useState(row.brief ?? '');
  const [paletteText, setPaletteText] = useState((row.paletteHex ?? []).join(', '));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 入力中の配色をパース（#省略は補完）。不正なものは invalid に分けてプレビューで気づけるように
  const tokens = paletteText.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  const normalized = tokens.map((t) => (t.startsWith('#') ? t : `#${t}`));
  const valid = normalized.filter((h) => /^#[0-9a-fA-F]{6}$/.test(h));
  const invalid = normalized.filter((h) => !/^#[0-9a-fA-F]{6}$/.test(h));

  const save = async () => {
    if (invalid.length > 0) {
      setErr(`配色に不正な値があります: ${invalid.join(', ')}（#RRGGBB 形式で入力してください）`);
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch('/api/meta/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update', accountId: row.accountId, brief, paletteHex: valid }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? '保存に失敗しました');
      await onSaved(row.client);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div>
          <h3 className="text-sm font-bold text-gray-800">ブリーフ編集 — {row.client}</h3>
          <p className="text-[11px] text-gray-400 mt-0.5">
            「勝ち分析再現 → 別プロジェクト流用」で流用先にこのアカウントを選ぶと、以下がブランド説明・配色の初期値として使われます（画面上で毎回編集も可能）
          </p>
        </div>

        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">ブランドブリーフ</label>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={5}
            placeholder="例: 薬膳・漢方をベースにした女性向けの食・健康ブランド。温かみがあり、和テイストで季節感を大切にする。ターゲットは美容・健康に関心のある30〜50代女性。権威性とベネフィットが刺さる。"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-800 outline-none focus:border-violet-400"
          />
          <p className="text-[10px] text-gray-400 mt-0.5">商材・ターゲット・トーン・何が刺さるか、を1〜3文で。空にすると未設定に戻ります</p>
        </div>

        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">
            ブランド配色 <span className="text-gray-300 font-normal">(任意・#RRGGBB をカンマ区切り)</span>
          </label>
          <input
            value={paletteText}
            onChange={(e) => setPaletteText(e.target.value)}
            placeholder="例: #A8472E, #E0A458, #7B8B5A, #F4E9D8"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono text-gray-800 outline-none focus:border-violet-400"
          />
          {valid.length > 0 && (
            <div className="flex items-center gap-1.5 mt-1.5">
              {valid.map((h, i) => (
                <span key={`${h}-${i}`} className="inline-flex items-center gap-1 text-[10px] text-gray-500">
                  <span className="w-4 h-4 rounded border border-gray-200 inline-block" style={{ backgroundColor: h }} />
                  {h}
                </span>
              ))}
            </div>
          )}
          {invalid.length > 0 && (
            <p className="text-[10px] text-amber-600 mt-1">不正な値: {invalid.join(', ')}</p>
          )}
        </div>

        {err && <p className="text-xs text-red-500">{err}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="py-1.5 px-3 rounded-lg text-xs text-gray-500 hover:text-gray-700">キャンセル</button>
          <button
            onClick={save}
            disabled={saving}
            className="py-1.5 px-4 rounded-lg text-xs font-bold text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-50"
          >{saving ? '保存中…' : '保存'}</button>
        </div>
      </div>
    </div>
  );
}
