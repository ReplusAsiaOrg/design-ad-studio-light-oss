'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

interface PriorityRowDto {
  integratedName: string;
  reach: number;
  purchases: number;
  spend: number;
  cpa: number | null;
  cvr: number | null;
  reachPerPurchase: number | null;
  cpaRank: string;
  spendRank: string;
  spendRankLabel: string;
  verdict: string;
  adCount: number;
}

interface PriorityDto {
  ok: boolean;
  error?: string;
  account: string;
  accounts: { accountId: string; client: string }[];
  range: { label: string; since: string | null; until: string | null };
  reachAvailable: boolean;
  conversionLabel: string | null;
  syncedAt: string | null;
  settings: { payoutPerCv: number; cpaLimits: { excellent: number; good: number; keep: number; improve: number }; cvDeviationPct?: number };
  rows: PriorityRowDto[];
}

const yen = (n: number | null) => (n == null ? '—' : '¥' + Math.round(n).toLocaleString('ja-JP'));
const num = (n: number) => n.toLocaleString('ja-JP');

const VERDICT_STYLE: Record<string, string> = {
  '★★★優秀': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  '★★良好': 'bg-blue-50 text-blue-700 border-blue-200',
  '★継続': 'bg-sky-50 text-sky-600 border-sky-100',
  '要改善': 'bg-amber-50 text-amber-700 border-amber-200',
  '損切り': 'bg-red-50 text-red-600 border-red-200',
  '判定不可': 'bg-gray-50 text-gray-400 border-gray-200',
};

const VERDICTS = ['★★★優秀', '★★良好', '★継続', '要改善', '損切り', '判定不可'];

export default function PriorityRanking({ initialAccount }: { initialAccount?: string | null }) {
  const [data, setData] = useState<PriorityDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  // 期間: null=全期間（リーチあり） / {since, until}=日次データから集計
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [useRange, setUseRange] = useState(false);
  const [verdictFilter, setVerdictFilter] = useState<string>('all');
  const [query, setQuery] = useState('');

  const load = useCallback(async (acct: string | null, s?: string, u?: string) => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      if (acct) p.set('account', acct);
      if (s && u) { p.set('since', s); p.set('until', u); }
      const res = await fetch(`/api/meta/priority?${p.toString()}`);
      const json: PriorityDto = await res.json();
      if (!json.ok) throw new Error(json.error ?? 'ランキングの取得に失敗しました');
      setData(json);
      setAccount(json.account);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ランキングの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  // ホーム（表紙）で選んだアカウントがあればそれで初期表示
  useEffect(() => { load(initialAccount ?? null); }, [load, initialAccount]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (verdictFilter !== 'all' && r.verdict !== verdictFilter) return false;
      if (q && !r.integratedName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, verdictFilter, query]);

  const verdictCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of data?.rows ?? []) m.set(r.verdict, (m.get(r.verdict) ?? 0) + 1);
    return m;
  }, [data]);

  const downloadCsv = useCallback(() => {
    if (!data) return;
    const header = ['優先順位', '統合名', '総合評価', '購入単価ランク', '消化金額ランク', 'CV数', 'CPA', '消化金額', 'リーチ', 'CVR(%)', '1件獲得リーチ数', '統合広告数'];
    const lines = [header.join(',')];
    data.rows.forEach((r, i) => {
      lines.push([
        i + 1,
        `"${r.integratedName.replaceAll('"', '""')}"`,
        r.verdict, r.cpaRank, r.spendRankLabel,
        r.purchases, r.cpa != null ? Math.round(r.cpa) : '',
        Math.round(r.spend), r.reach || '',
        r.cvr != null ? r.cvr.toFixed(3) : '',
        r.reachPerPurchase != null ? Math.round(r.reachPerPurchase) : '',
        r.adCount,
      ].join(','));
    });
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `priority_${data.account}_${data.range.label.replaceAll(' ', '')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [data]);

  return (
    <div className="space-y-4">
      {/* コントロールバー */}
      <div className="flex flex-wrap items-center gap-2 bg-white rounded-xl border border-gray-200 p-2">
        <select
          value={account ?? ''}
          onChange={(e) => { setAccount(e.target.value); load(e.target.value, useRange ? since : undefined, useRange ? until : undefined); }}
          className="py-1.5 px-2 rounded-lg text-xs font-medium border border-gray-200 bg-white text-gray-700 focus:border-blue-400 outline-none"
        >
          {(data?.accounts ?? []).map((a) => (
            <option key={a.accountId} value={a.accountId}>{a.client}</option>
          ))}
        </select>

        <div className="inline-flex rounded-md border border-gray-200 p-0.5">
          <button
            onClick={() => { setUseRange(false); load(account); }}
            className={`px-2.5 py-1 rounded text-xs font-medium ${!useRange ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-700'}`}
          >
            全期間
          </button>
          <button
            onClick={() => setUseRange(true)}
            className={`px-2.5 py-1 rounded text-xs font-medium ${useRange ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-700'}`}
          >
            期間指定
          </button>
        </div>
        {useRange && (
          <span className="inline-flex items-center gap-1">
            <input type="date" value={since} onChange={(e) => setSince(e.target.value)} className="text-[11px] border border-gray-200 rounded px-1 py-0.5 text-gray-700" />
            <span className="text-gray-300 text-xs">〜</span>
            <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="text-[11px] border border-gray-200 rounded px-1 py-0.5 text-gray-700" />
            <button
              onClick={() => since && until && load(account, since, until)}
              disabled={!since || !until}
              className="ml-1 py-1 px-2.5 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
            >
              適用
            </button>
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {data && (
            <span className="text-[11px] text-gray-400">
              {data.range.label}
              {data.conversionLabel && <>・CV=「{data.conversionLabel}」</>}
              ・CPA上限 ¥{Math.round(data.settings.cpaLimits.excellent).toLocaleString('ja-JP')}/★★★
            </span>
          )}
          {data && (data.settings.cvDeviationPct ?? 0) !== 0 && (
            <span className="text-[11px] font-medium text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-2 py-0.5" title="評価設定のCV乖離率でCV・CPAを実CV換算しています">
              CV乖離補正 {data.settings.cvDeviationPct}%（実CV換算）
            </span>
          )}
          <button onClick={downloadCsv} disabled={!data} className="py-1.5 px-3 rounded-lg text-xs font-medium border border-gray-200 text-gray-600 hover:border-gray-300 disabled:opacity-40">
            CSV
          </button>
        </div>
      </div>

      {/* 評価フィルタ */}
      {data && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setVerdictFilter('all')}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border ${verdictFilter === 'all' ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'}`}
          >
            すべて {data.rows.length}
          </button>
          {VERDICTS.map((v) => (
            <button
              key={v}
              onClick={() => setVerdictFilter(verdictFilter === v ? 'all' : v)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border ${verdictFilter === v ? 'ring-2 ring-blue-300' : ''} ${VERDICT_STYLE[v]}`}
            >
              {v} {verdictCounts.get(v) ?? 0}
            </button>
          ))}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="統合名で検索"
            className="ml-auto border border-gray-200 rounded-lg px-3 py-1.5 text-xs w-56 outline-none focus:border-blue-400"
          />
        </div>
      )}

      {/* 本体 */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-gray-400 text-sm">読み込み中...</div>
      ) : error ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
          <p className="text-red-500 text-sm">{error}</p>
        </div>
      ) : data && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          {!data.reachAvailable && (
            <p className="px-4 py-2 text-[11px] text-amber-700 bg-amber-50 border-b border-amber-100">
              期間指定ではリーチ系指標（リーチ・CVR・1件獲得リーチ数）は表示できません（日をまたぐリーチは合算不可のため）
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 bg-gray-50/60 border-b border-gray-100">
                  <th className="text-right font-medium px-3 py-2.5 w-10">#</th>
                  <th className="text-left font-medium px-3 py-2.5">統合名（クリエイティブ）</th>
                  <th className="text-center font-medium px-3 py-2.5">総合評価</th>
                  <th className="text-center font-medium px-3 py-2.5">単価</th>
                  <th className="text-left font-medium px-3 py-2.5">消化ランク</th>
                  <th className="text-right font-medium px-3 py-2.5">CV</th>
                  <th className="text-right font-medium px-3 py-2.5">CPA</th>
                  <th className="text-right font-medium px-3 py-2.5">消化金額</th>
                  <th className="text-right font-medium px-3 py-2.5">リーチ</th>
                  <th className="text-right font-medium px-3 py-2.5">CVR</th>
                  <th className="text-right font-medium px-3 py-2.5">1CV獲得リーチ</th>
                  <th className="text-right font-medium px-3 py-2.5">広告数</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const rank = data.rows.indexOf(r) + 1;
                  return (
                    <tr key={r.integratedName} className="border-b border-gray-50 hover:bg-gray-50/60">
                      <td className="px-3 py-2 text-right text-gray-300">{rank}</td>
                      <td className="px-3 py-2 font-medium text-gray-800 max-w-[360px] truncate" title={r.integratedName}>{r.integratedName}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium border ${VERDICT_STYLE[r.verdict] ?? ''}`}>{r.verdict}</span>
                      </td>
                      <td className="px-3 py-2 text-center font-bold text-gray-600">{r.cpaRank}</td>
                      <td className="px-3 py-2 text-gray-500">{r.spendRankLabel}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{num(r.purchases)}</td>
                      <td className="px-3 py-2 text-right font-medium text-gray-800">{yen(r.cpa)}</td>
                      <td className="px-3 py-2 text-right text-gray-600">{yen(r.spend)}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{data.reachAvailable && r.reach ? num(r.reach) : '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{data.reachAvailable && r.cvr != null ? `${r.cvr.toFixed(r.cvr >= 1 ? 1 : 2)}%` : '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{data.reachAvailable && r.reachPerPurchase != null ? num(Math.round(r.reachPerPurchase)) : '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-400">{r.adCount}</td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={12} className="px-4 py-10 text-center text-gray-400">該当なし</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
