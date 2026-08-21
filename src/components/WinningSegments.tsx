'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

interface SegmentRowDto {
  segment: string;
  spend: number;
  impressions: number;
  clicks: number;
  cv: number;
  cpa: number | null;
  verdict: string | null;
  spendRank: string;
  spendRankLabel: string;
}

interface DimensionDto {
  dimension: string;
  label: string;
  cvAvailable: boolean;
  conversionLabel: string | null;
  rows: SegmentRowDto[];
}

interface SegmentsDto {
  ok: boolean;
  error?: string;
  account: string;
  accounts: { accountId: string; client: string }[];
  range: { label: string; since: string | null; until: string | null; dataMin: string | null; dataMax: string | null };
  settings: {
    payoutPerCv: number;
    cpaLimits: { excellent: number; good: number; keep: number; improve: number };
    spendRankBreakdown: { a: number; b: number; c: number };
    starSpendMin: { s3: number; s2: number };
    brandPrefixes: string[];
    cvDeviationPct?: number;
  };
  dimensions: DimensionDto[];
  /** 入稿判断層（年齢×性別・配置） */
  winners: WinnerDto[];
  /** スクリーニング層（年齢単独・性別単独）。掛け合わせ未蓄積のときは空 */
  screening?: WinnerDto[];
  /** 年齢×性別の掛け合わせデータが蓄積済みか（false = 再取込前の後方互換モード） */
  crossAvailable?: boolean;
}

type WinnerDto = { dimension: string; dimensionLabel: string; segment: string; verdict: string; cpa: number | null; spend: number; cv: number };

const yen = (n: number | null) => (n == null ? '—' : '¥' + Math.round(n).toLocaleString('ja-JP'));
const num = (n: number) => n.toLocaleString('ja-JP');

const VERDICT_STYLE: Record<string, string> = {
  '★★★': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  '★★': 'bg-blue-50 text-blue-700 border-blue-200',
  '★継続': 'bg-sky-50 text-sky-600 border-sky-100',
  '停止推奨': 'bg-red-50 text-red-600 border-red-200',
  '判定不可': 'bg-gray-50 text-gray-400 border-gray-200',
};

/** Metaのセグメントキー → 日本語表示 */
const SEGMENT_JA: Record<string, string> = {
  male: '男性', female: '女性', unknown: '不明',
};

/** 'female' 等の単独値に加え、'65+・female' 形式（年齢×性別）の後半も和訳する */
const segLabel = (s: string) => {
  if (SEGMENT_JA[s]) return SEGMENT_JA[s];
  if (s.includes('・')) {
    const [age, gender] = s.split('・');
    return `${SEGMENT_JA[age] ?? age}・${SEGMENT_JA[gender] ?? gender}`;
  }
  return s;
};

/** 今日の日付（ローカル）を YYYY-MM-DD で */
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 入稿用名称: YYYYMMDD_[接頭辞_]素材名（src/lib/scoring.ts buildAdName と同形式） */
function composeAdName(date: string, prefix: string, material: string): string {
  const ymd = date.replaceAll('-', '');
  const p = prefix.trim();
  const m = material.trim();
  if (!/^\d{8}$/.test(ymd) || !m) return '';
  return p ? `${ymd}_${p}_${m}` : `${ymd}_${m}`;
}

export default function WinningSegments({ initialAccount }: { initialAccount?: string | null }) {
  const [data, setData] = useState<SegmentsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [useRange, setUseRange] = useState(false);

  // 入稿用名称ジェネレーター
  const [nameDate, setNameDate] = useState(todayStr());
  const [namePrefix, setNamePrefix] = useState('');
  const [nameMaterial, setNameMaterial] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async (acct: string | null, s?: string, u?: string) => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      if (acct) p.set('account', acct);
      if (s && u) { p.set('since', s); p.set('until', u); }
      const res = await fetch(`/api/meta/segments?${p.toString()}`);
      const json: SegmentsDto = await res.json();
      if (!json.ok) throw new Error(json.error ?? '勝ちセグメントの取得に失敗しました');
      setData(json);
      setAccount(json.account);
      // 接頭辞の初期値は設定の brandPrefixes 先頭（未入力のときだけ反映）
      setNamePrefix((prev) => prev || (json.settings.brandPrefixes[0] ?? ''));
    } catch (e) {
      setError(e instanceof Error ? e.message : '勝ちセグメントの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  // ホーム（表紙）で選んだアカウントがあればそれで初期表示
  useEffect(() => { load(initialAccount ?? null); }, [load, initialAccount]);

  const adName = useMemo(
    () => composeAdName(nameDate, namePrefix, nameMaterial),
    [nameDate, namePrefix, nameMaterial],
  );

  const copyAdName = useCallback(async () => {
    if (!adName) return;
    await navigator.clipboard.writeText(adName);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [adName]);

  const hasData = (data?.dimensions.length ?? 0) > 0;

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

        {data && (
          <span className="ml-auto text-[11px] text-gray-400">
            {data.range.label}
            ・CPA上限 ¥{Math.round(data.settings.cpaLimits.excellent).toLocaleString('ja-JP')}/★★★
            ・★消化下限 {yen(data.settings.starSpendMin.s3)}
          </span>
        )}
        {data && (data.settings.cvDeviationPct ?? 0) !== 0 && (
          <span className="text-[11px] font-medium text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-2 py-0.5" title="評価設定のCV乖離率でCV・CPAを実CV換算しています">
            CV乖離補正 {data.settings.cvDeviationPct}%（実CV換算）
          </span>
        )}
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-gray-400 text-sm">読み込み中...</div>
      ) : error ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
          <p className="text-red-500 text-sm">{error}</p>
        </div>
      ) : data && (
        <>
          {/* 勝ちセグメント サマリー（入稿判断層 / スクリーニング層の2段） */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
            <div>
              <h3 className="text-sm font-bold text-gray-800">入稿ターゲティング候補（★★★ / ★★）</h3>
              <p className="text-[11px] text-gray-500 mb-2">
                {data.crossAvailable
                  ? '絞り込んで入稿する単位。年齢×性別・配置の掛け合わせで判定しています。'
                  : '絞り込んで入稿する単位。このアカウントは年齢×性別が未取込のため、年齢・性別（単独軸）と配置で判定しています。「アカウント管理」タブの過去取込をやり直すと掛け合わせ判定に切り替わります。'}
              </p>
              {data.winners.length === 0 ? (
                <p className="text-xs text-gray-400">
                  {hasData
                    ? '★★★/★★のセグメントはありません（判定基準・消化下限は評価設定で調整できます）'
                    : '内訳データがありません。「アカウント管理」タブから同期すると性年齢・配置の内訳が蓄積されます'}
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {data.winners.map((w) => (
                    <span
                      key={`${w.dimension}:${w.segment}`}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${VERDICT_STYLE[w.verdict]}`}
                    >
                      <span>{w.verdict}</span>
                      <span>{w.dimensionLabel}: {segLabel(w.segment)}</span>
                      <span className="opacity-70">CPA {yen(w.cpa)} / {num(w.cv)}CV</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
            {(data.screening?.length ?? 0) > 0 && (
              <div className="pt-3 border-t border-gray-100">
                <h3 className="text-xs font-bold text-gray-600">スクリーニング（参考・年齢単独 / 性別単独）</h3>
                <p className="text-[11px] text-gray-500 mb-2">
                  当たりを付けるための合計値です。<span className="font-medium">ここだけで絞り込みを決めないでください</span>。
                  単独軸が★でも、内側に負けセグメントを抱えていることがあります（例:「65+」全体は★★でも「65+・女性」は基準超え）。
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {data.screening!.map((w) => (
                    <span
                      key={`${w.dimension}:${w.segment}`}
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] border border-gray-200 bg-gray-50 text-gray-600"
                    >
                      <span>{w.verdict}</span>
                      <span>{w.dimensionLabel}: {segLabel(w.segment)}</span>
                      <span className="opacity-70">CPA {yen(w.cpa)} / {num(w.cv)}CV</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 次元別テーブル */}
          <div className="grid gap-4 lg:grid-cols-2">
            {data.dimensions.map((d) => (
              <div key={d.dimension} className={`bg-white rounded-2xl border border-gray-200 overflow-hidden ${d.dimension === 'placement' || d.dimension === 'age_gender' ? 'lg:col-span-2' : ''}`}>
                <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2">
                  <h3 className="text-xs font-bold text-gray-700">{d.label}別</h3>
                  {d.cvAvailable ? (
                    <span className="text-[11px] text-gray-400">CV=「{d.conversionLabel}」</span>
                  ) : (
                    <span className="text-[11px] text-amber-600">CVデータなし（配置はMeta API制約でCVが取れない場合があります）→ 判定なし・消化/クリックのみ</span>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-400 bg-gray-50/60 border-b border-gray-100">
                        <th className="text-left font-medium px-4 py-2">セグメント</th>
                        <th className="text-center font-medium px-3 py-2">判定</th>
                        <th className="text-right font-medium px-3 py-2">CV</th>
                        <th className="text-right font-medium px-3 py-2">CPA</th>
                        <th className="text-right font-medium px-3 py-2">消化金額</th>
                        <th className="text-left font-medium px-3 py-2">消化ランク</th>
                        <th className="text-right font-medium px-3 py-2">クリック</th>
                        <th className="text-right font-medium px-4 py-2">表示</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.rows.map((r) => (
                        <tr key={r.segment} className="border-b border-gray-50 hover:bg-gray-50/60">
                          <td className="px-4 py-2 font-medium text-gray-800">{segLabel(r.segment)}</td>
                          <td className="px-3 py-2 text-center">
                            {r.verdict ? (
                              <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium border ${VERDICT_STYLE[r.verdict] ?? ''}`}>{r.verdict}</span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-700">{d.cvAvailable ? num(r.cv) : '—'}</td>
                          <td className="px-3 py-2 text-right font-medium text-gray-800">{d.cvAvailable ? yen(r.cpa) : '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-600">{yen(r.spend)}</td>
                          <td className="px-3 py-2 text-gray-500">{r.spendRankLabel}</td>
                          <td className="px-3 py-2 text-right text-gray-500">{num(r.clicks)}</td>
                          <td className="px-4 py-2 text-right text-gray-500">{num(r.impressions)}</td>
                        </tr>
                      ))}
                      {d.rows.length === 0 && (
                        <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">データなし</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
            {!hasData && (
              <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-200 p-12 text-center text-gray-400 text-sm">
                内訳データがまだありません。「アカウント管理」タブの同期で性年齢・配置の内訳が日次で蓄積されます。
              </div>
            )}
          </div>

          {/* 入稿用名称ジェネレーター */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <h3 className="text-sm font-bold text-gray-800">入稿用名称ジェネレーター</h3>
            <p className="text-[11px] text-gray-400 mt-0.5 mb-3">
              「YYYYMMDD_接頭辞_素材名」形式。この形式なら優先順位タブの名寄せ（統合名）に正しく合流します
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs text-gray-500">
                入稿日
                <input type="date" value={nameDate} onChange={(e) => setNameDate(e.target.value)} className="block mt-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 outline-none focus:border-blue-400" />
              </label>
              <label className="text-xs text-gray-500">
                ブランド接頭辞（任意）
                <input value={namePrefix} onChange={(e) => setNamePrefix(e.target.value)} placeholder="例: brandname" className="block mt-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs w-36 text-gray-700 outline-none focus:border-blue-400" />
              </label>
              <label className="text-xs text-gray-500 flex-1 min-w-[240px]">
                素材名（統合名）
                <input value={nameMaterial} onChange={(e) => setNameMaterial(e.target.value)} placeholder="例: 春訴求_悩み共感A" className="block mt-1 w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 outline-none focus:border-blue-400" />
              </label>
            </div>
            {adName && (
              <div className="mt-3 flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                <code className="text-sm text-gray-800 font-mono flex-1 truncate" title={adName}>{adName}</code>
                <button
                  onClick={copyAdName}
                  className="py-1 px-3 rounded-md text-xs font-medium bg-gray-800 text-white hover:bg-gray-700 shrink-0"
                >
                  {copied ? 'コピーしました ✓' : 'コピー'}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
