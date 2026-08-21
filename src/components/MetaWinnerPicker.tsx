'use client';

import { useEffect, useState } from 'react';

interface WinnerCreative {
  creativeId: string;
  name: string;
  conversion: string;
  cv: number;
  cpa: number | null;
  cpaRatio: number | null;
  isVideo: boolean;
  imageUrl: string;
  genesText: string;
}

interface AccountWinners {
  client: string;
  accountId: string;
  winningHeadlines: string[];
  creatives: WinnerCreative[];
}

interface Props {
  /** 勝ちCRを選んだ時、data URL を親（WinningAnalyzer）に渡す。 */
  onPick: (dataUrl: string) => void;
  disabled?: boolean;
}

/**
 * Phase 3 出口接続UI: Meta実データの勝ちCRを一覧表示し、選ぶと
 * 「勝ち分析再現」タブの入力画像にそのまま流し込む。
 */
export default function MetaWinnerPicker({ onPick, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState<AccountWinners[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pickingId, setPickingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || accounts.length > 0 || loading) return;
    setLoading(true);
    fetch('/api/meta/winning-creatives')
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) {
          setError(d.error ?? '取得に失敗しました');
          return;
        }
        setAccounts((d.accounts as AccountWinners[]).filter((a) => a.creatives.length > 0));
      })
      .catch((e) => setError(e instanceof Error ? e.message : '通信エラー'))
      .finally(() => setLoading(false));
  }, [open, accounts.length, loading]);

  const pick = async (c: WinnerCreative) => {
    if (disabled || pickingId) return;
    setPickingId(c.creativeId);
    setError(null);
    try {
      const res = await fetch('/api/meta/creative-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: c.imageUrl }),
      });
      const d = await res.json();
      if (!d.ok) {
        setError(d.error ?? '画像の取り込みに失敗しました');
        return;
      }
      onPick(d.dataUrl as string);
    } catch (e) {
      setError(e instanceof Error ? e.message : '通信エラー');
    } finally {
      setPickingId(null);
    }
  };

  const active = accounts[activeIdx];

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <span className="text-xs font-semibold text-gray-600">
          📊 Metaの勝ちCRから選ぶ
          <span className="font-normal text-gray-400 ml-1">（実データ・CPA順）</span>
        </span>
        <span className="text-gray-400 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="p-3 space-y-3 bg-white">
          {loading && <p className="text-xs text-gray-400">読み込み中...</p>}
          {error && <p className="text-xs text-red-500">{error}</p>}

          {!loading && accounts.length === 0 && !error && (
            <p className="text-[11px] text-gray-400 leading-relaxed">
              勝ちCRがありません。先にデータ同期（/api/meta/sync）と
              vision分類（/api/meta/genes）を実行してください。
            </p>
          )}

          {accounts.length > 0 && (
            <>
              {/* アカウント切替（増えてもボタン化しないようプルダウン） */}
              {accounts.length > 1 && (
                <select
                  value={activeIdx}
                  onChange={(e) => setActiveIdx(Number(e.target.value))}
                  className="w-full py-1.5 px-2 rounded-md text-[11px] font-medium border border-gray-200 bg-white text-gray-700 hover:border-gray-300 focus:border-amber-400 outline-none transition-colors"
                >
                  {accounts.map((a, i) => (
                    <option key={a.accountId} value={i}>
                      {a.client}（{a.creatives.length}件）
                    </option>
                  ))}
                </select>
              )}

              {/* 勝ちパターン要約 */}
              {active?.winningHeadlines.length > 0 && (
                <div className="bg-amber-50 border border-amber-100 rounded-md p-2 space-y-0.5">
                  {active.winningHeadlines.slice(0, 3).map((h, i) => (
                    <p key={i} className="text-[10px] text-amber-800 leading-snug">
                      {h}
                    </p>
                  ))}
                </div>
              )}

              {/* CR一覧 */}
              <div className="grid grid-cols-3 gap-2 max-h-72 overflow-y-auto">
                {active?.creatives.map((c) => (
                  <button
                    key={c.creativeId}
                    onClick={() => pick(c)}
                    disabled={disabled || !!pickingId}
                    className="group relative rounded-md overflow-hidden border border-gray-200 hover:border-amber-400 transition-all disabled:opacity-50 text-left"
                    title={`${c.name}\n${c.genesText}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={c.imageUrl} alt={c.name} className="w-full aspect-square object-cover bg-gray-50" />
                    {pickingId === c.creativeId && (
                      <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                        <span className="text-[10px] text-amber-600 font-medium">取込中...</span>
                      </div>
                    )}
                    <div className="absolute top-1 left-1 flex gap-1">
                      <span className="text-[9px] font-bold text-white bg-amber-500/90 px-1 rounded">
                        ¥{c.cpa}
                      </span>
                      {c.isVideo && (
                        <span className="text-[9px] font-bold text-white bg-black/60 px-1 rounded">動画</span>
                      )}
                    </div>
                    <div className="px-1 py-0.5 bg-white">
                      <p className="text-[9px] text-gray-600 truncate">{c.name}</p>
                    </div>
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-gray-400">
                クリックで分析対象に取り込み → 「勝ちパターンを分析」へ。¥はCPA（{active?.creatives[0]?.conversion}単価）。
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
