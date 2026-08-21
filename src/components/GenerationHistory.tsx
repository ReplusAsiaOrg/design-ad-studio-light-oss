'use client';

import { useCallback, useEffect, useState } from 'react';

interface Outcome {
  checkedAt: string;
  accountId: string;
  matchedAds: number;
  spend: number;
  cv: number;
  cpa: number | null;
  verdict: string;
}

interface HistoryItem {
  id: string;
  createdAt: string;
  engine: string;
  mode: string;
  mainText: string;
  subText?: string;
  aspectRatio?: string;
  status: 'pending' | 'generated' | 'adopted' | 'rejected';
  materialName?: string;
  adName?: string;
  outcome?: Outcome;
}

const VERDICT_COLORS: Record<string, string> = {
  '★★★優秀': 'bg-amber-100 text-amber-800 border-amber-300',
  '★★良好': 'bg-emerald-100 text-emerald-800 border-emerald-300',
  '★継続': 'bg-blue-100 text-blue-700 border-blue-200',
  '要改善': 'bg-orange-100 text-orange-700 border-orange-200',
  '損切り': 'bg-rose-100 text-rose-700 border-rose-200',
  '判定不可': 'bg-gray-100 text-gray-500 border-gray-200',
};

/**
 * 生成履歴タブ — 学習ループの操作画面。
 * 生成したバナーの一覧 → 採用（素材名を付けて入稿名発行）/ 不採用 → 「成果を更新」で
 * 入稿後の勝敗を名寄せ追跡し、実績が生成プロンプトに自動反映される。
 */
export default function GenerationHistory() {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adoptingId, setAdoptingId] = useState<string | null>(null);
  const [materialName, setMaterialName] = useState('');
  const [tracking, setTracking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/history')
      .then((r) => r.json())
      .then((j) => { if (j.ok) setItems(j.items); else setError(j.error); })
      .catch(() => setError('履歴の取得に失敗しました'));
  }, []);

  useEffect(() => { load(); }, [load]);

  const decide = async (id: string, decision: 'adopted' | 'rejected' | 'reset', name?: string) => {
    const res = await fetch('/api/history/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, decision, materialName: name }),
    });
    const j = await res.json();
    if (!j.ok) { setNotice(`エラー: ${j.error}`); return; }
    if (decision === 'adopted' && j.record?.adName) {
      setNotice(`入稿名を発行しました: ${j.record.adName}（この名前で入稿すると成果が自動追跡されます）`);
    }
    setAdoptingId(null);
    setMaterialName('');
    load();
  };

  const track = async () => {
    setTracking(true);
    setNotice(null);
    try {
      const res = await fetch('/api/history/track', { method: 'POST' });
      const j = await res.json();
      setNotice(j.ok
        ? `成果を更新しました（${j.accounts}アカウントと突き合わせ・${j.updated}件更新）`
        : `エラー: ${j.error}`);
      if (j.ok) load();
    } finally {
      setTracking(false);
    }
  };

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(() => setNotice(`コピーしました: ${text}`));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">📚</span>
          <h2 className="text-lg font-bold text-gray-900">生成履歴</h2>
          <span className="text-[11px] text-gray-400">採用→入稿名で自動追跡→次の生成に反映</span>
        </div>
        <button
          onClick={track}
          disabled={tracking}
          className="ml-auto py-1.5 px-3 rounded-lg text-xs font-bold text-white bg-gray-800 hover:bg-gray-700 disabled:opacity-40 transition-colors"
          title="採用済みバナーを同期データと名寄せして勝敗を取り込む"
        >{tracking ? '追跡中...' : '成果を更新'}</button>
      </div>

      <div className="text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
        使い方: 生成したバナーを入稿すると決めたら「採用」で素材名を付ける →
        発行された入稿名（<span className="font-mono">YYYYMMDD_素材名</span>）で Meta に入稿する →
        同期後に「成果を更新」を押すと勝敗が自動で紐づき、以後の「勝ち分析再現」の生成に実績が反映されます。
      </div>

      {notice && (
        <div className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">{notice}</div>
      )}
      {error && (
        <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>
      )}
      {items === null && !error && (
        <div className="text-sm text-gray-400 p-8 text-center">読み込み中...</div>
      )}
      {items?.length === 0 && (
        <div className="text-sm text-gray-400 bg-white border border-gray-200 rounded-2xl p-10 text-center">
          まだ履歴がありません。バナーを生成するとここに自動で記録されます。
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {(items ?? []).map((it) => (
          <div key={it.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/history/image?id=${it.id}`}
              alt={it.mainText || '生成バナー'}
              loading="lazy"
              className="w-full aspect-square object-contain bg-gray-50"
            />
            <div className="p-2.5 space-y-1.5 flex-1 flex flex-col">
              <div className="text-[11px] font-medium text-gray-800 line-clamp-2">{it.mainText || '(テキストなし)'}</div>
              <div className="text-[10px] text-gray-400">
                {new Date(it.createdAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                ・{it.engine}{it.aspectRatio ? `・${it.aspectRatio}` : ''}
              </div>

              {it.status === 'adopted' && (
                <div className="space-y-1">
                  <span className="inline-block text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">✓ 採用</span>
                  {it.adName && (
                    <button
                      onClick={() => copy(it.adName!)}
                      className="block w-full text-left text-[10px] font-mono text-gray-600 bg-gray-50 border border-gray-200 rounded px-1.5 py-1 hover:bg-gray-100 truncate"
                      title={`クリックでコピー: ${it.adName}`}
                    >{it.adName}</button>
                  )}
                  {it.outcome ? (
                    <div className={`text-[10px] border rounded px-1.5 py-1 ${VERDICT_COLORS[it.outcome.verdict] ?? 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                      <span className="font-bold">{it.outcome.verdict}</span>
                      {' '}CPA {it.outcome.cpa != null ? `${Math.round(it.outcome.cpa).toLocaleString('ja-JP')}円` : '—'}
                      ・消化 {it.outcome.spend.toLocaleString('ja-JP')}円・{it.outcome.matchedAds}本
                    </div>
                  ) : (
                    <div className="text-[10px] text-gray-400">成果未取得（入稿・同期後に「成果を更新」）</div>
                  )}
                </div>
              )}
              {it.status === 'rejected' && (
                <span className="inline-block w-fit text-[10px] text-gray-500 bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5">不採用</span>
              )}

              <div className="mt-auto pt-1">
                {it.status === 'generated' && adoptingId !== it.id && (
                  <div className="flex gap-1">
                    <button
                      onClick={() => { setAdoptingId(it.id); setMaterialName(it.mainText.slice(0, 20)); }}
                      className="flex-1 py-1 rounded-md text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-500 transition-colors"
                    >採用</button>
                    <button
                      onClick={() => decide(it.id, 'rejected')}
                      className="flex-1 py-1 rounded-md text-[11px] font-medium text-gray-500 bg-gray-100 hover:bg-gray-200 transition-colors"
                    >不採用</button>
                  </div>
                )}
                {adoptingId === it.id && (
                  <div className="space-y-1">
                    <input
                      value={materialName}
                      onChange={(e) => setMaterialName(e.target.value)}
                      placeholder="素材名（入稿名に使用）"
                      className="w-full text-[11px] border border-gray-300 rounded px-1.5 py-1 outline-none focus:border-blue-400"
                      autoFocus
                    />
                    <div className="flex gap-1">
                      <button
                        onClick={() => decide(it.id, 'adopted', materialName)}
                        disabled={!materialName.trim()}
                        className="flex-1 py-1 rounded-md text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40"
                      >入稿名を発行</button>
                      <button
                        onClick={() => { setAdoptingId(null); setMaterialName(''); }}
                        className="py-1 px-2 rounded-md text-[11px] text-gray-500 bg-gray-100 hover:bg-gray-200"
                      >取消</button>
                    </div>
                  </div>
                )}
                {(it.status === 'adopted' || it.status === 'rejected') && (
                  <button
                    onClick={() => decide(it.id, 'reset')}
                    className="text-[10px] text-gray-400 hover:text-gray-600 underline"
                  >判断を取り消す</button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
