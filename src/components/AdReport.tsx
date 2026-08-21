'use client';

import { useEffect, useMemo, useState } from 'react';
import AnomalyAlerts from './AnomalyAlerts';

interface CreativeRow {
  adId: string; name: string; creativeId: string | null;
  campaignId: string | null; adsetId: string | null;
  spend: number; impressions: number; clicks: number; ctr: number; cpc: number; cpm: number;
  cv: number; cpa: number | null; cvr: number;
  conversionLabel: string | null;
  verdict: 'winner' | 'loser' | 'insufficient'; cpaRatio: number | null;
  active?: boolean; effectiveStatus?: string | null;
  isVideo: boolean; imageUrl?: string; videoId?: string | null;
}
interface Summary {
  spend: number; impressions: number; clicks: number; cpm: number; ctr: number; cpc: number;
  cv: number; cpa: number | null; cvr: number; conversionLabels: string[]; adCount: number; withCvCount: number;
}
interface BreakdownAgg { key: string; spend: number; impressions: number; clicks: number; cv: number }
interface HierNode { id: string; name: string; spend: number; impressions: number; clicks: number; cv: number; cpa: number | null; adCount: number; children?: HierNode[] }
interface WinningSummary {
  winnerCount: number; loserCount: number;
  topWinners: { name: string; cpa: number | null; cpaRatio: number | null; conversionLabel: string | null; isVideo: boolean; imageUrl?: string }[];
  bestMedia: string | null;
  videoWinRate: number | null; imageWinRate: number | null; videoTotal: number; imageTotal: number;
}
interface TrendPoint { date: string; spend: number; impressions: number; clicks: number; cpm: number; ctr: number; cpc: number; cv: number; cvr: number; cpa: number | null }
// AI分析に渡す評価済みデータ（優先順位タブ /api/meta/priority・勝ちセグメントタブ /api/meta/segments と同じもの）
interface PriorityApiRow { integratedName: string; spend: number; purchases: number; cpa: number | null; cpaRank: string; spendRank: string; verdict: string; adCount: number }
interface SegmentApiRow { segment: string; spend: number; cv: number; cpa: number | null; verdict: string | null; spendRankLabel: string }
interface SegmentApiDim { dimension: string; label: string; cvAvailable: boolean; conversionLabel: string | null; rows: SegmentApiRow[] }
interface CampaignOpt { id: string; name: string }
interface AdsetOpt { id: string; name: string; campaignId: string | null }
interface ReportData {
  ok: boolean; error?: string;
  accounts: { accountId: string; client: string }[];
  account: { accountId: string; client: string; accountName: string; currency: string };
  range: { datePreset?: string; since?: string; until?: string; label: string };
  campaignOptions?: CampaignOpt[]; adsetOptions?: AdsetOpt[];
  cvDeviationPct?: number;
  summary: Summary;
  media: BreakdownAgg[]; placement: BreakdownAgg[]; age: BreakdownAgg[]; gender: BreakdownAgg[]; hierarchy: HierNode[]; winningSummary: WinningSummary;
  trend: TrendPoint[]; deltas: Record<string, number | null> | null;
  creatives: CreativeRow[];
}

type SortKey = 'cpa' | 'cv' | 'spend' | 'ctr' | 'impressions';
type VerdictFilter = 'all' | 'winner' | 'loser';
type View = 'gallery' | 'table';

// CPAは分析側で小数1桁精度のまま来るが、表示は円の整数に統一（「¥582.3」を出さない）
const yen = (n: number | null) => (n == null ? '—' : '¥' + Math.round(n).toLocaleString('ja-JP'));
const num = (n: number) => n.toLocaleString('ja-JP');
const pct = (n: number) => n.toFixed(n >= 10 ? 0 : 1) + '%';

const PRESETS: { v: string; label: string }[] = [
  { v: 'today', label: '今日' },
  { v: 'yesterday', label: '昨日' },
  { v: 'last_7d', label: '過去7日' },
  { v: 'last_14d', label: '過去14日' },
  { v: 'last_30d', label: '過去30日' },
  { v: 'this_month', label: '今月' },
  { v: 'last_month', label: '先月' },
  { v: 'maximum', label: '全期間' },
];

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'cpa', label: 'CPA安い順' }, { key: 'cv', label: 'CV多い順' },
  { key: 'spend', label: '広告費多い順' }, { key: 'ctr', label: 'CTR高い順' }, { key: 'impressions', label: '表示多い順' },
];

/** 媒体・配置の色（ブランド寄せ）。 */
const PLATFORM_COLOR: Record<string, string> = {
  instagram: '#E1306C', facebook: '#1877F2', threads: '#111827', messenger: '#00B2FF',
  audience_network: '#14B8A6', whatsapp: '#25D366', unknown: '#9CA3AF',
};
const DONUT_PALETTE = ['#6366F1', '#06B6D4', '#F59E0B', '#EC4899', '#10B981', '#8B5CF6', '#EF4444', '#64748B', '#84CC16', '#F97316'];

/**
 * 内訳グラフ（媒体/配置/性別/年齢）の表示指標。
 * 加算系（sum）は割合が意味を持つのでドーナツ、効率系（ratio）は横棒グラフで表示する。
 */
type BreakdownMetricKey = 'spend' | 'cv' | 'cpa' | 'cpm' | 'ctr' | 'cpc' | 'impressions' | 'clicks';
const BREAKDOWN_METRICS: { key: BreakdownMetricKey; label: string; kind: 'sum' | 'ratio' }[] = [
  { key: 'spend', label: '広告費', kind: 'sum' },
  { key: 'cv', label: 'CV', kind: 'sum' },
  { key: 'cpa', label: 'CPA', kind: 'ratio' },
  { key: 'cpm', label: 'CPM', kind: 'ratio' },
  { key: 'ctr', label: 'CTR', kind: 'ratio' },
  { key: 'cpc', label: 'CPC', kind: 'ratio' },
  { key: 'impressions', label: '表示回数', kind: 'sum' },
  { key: 'clicks', label: 'クリック', kind: 'sum' },
];

/** 集計行から指標値を算出。分母0は null（＝「—」表示） */
function breakdownMetricOf(it: BreakdownAgg, key: BreakdownMetricKey): number | null {
  switch (key) {
    case 'spend': return it.spend;
    case 'cv': return it.cv;
    case 'impressions': return it.impressions;
    case 'clicks': return it.clicks;
    case 'cpa': return it.cv > 0 ? it.spend / it.cv : null;
    case 'cpm': return it.impressions > 0 ? (it.spend / it.impressions) * 1000 : null;
    case 'ctr': return it.impressions > 0 ? (it.clicks / it.impressions) * 100 : null;
    case 'cpc': return it.clicks > 0 ? it.spend / it.clicks : null;
  }
}

function fmtBreakdownMetric(key: BreakdownMetricKey, v: number | null): string {
  if (v == null) return '—';
  if (key === 'ctr') return `${v.toFixed(2)}%`;
  if (key === 'cv' || key === 'impressions' || key === 'clicks') return Math.round(v).toLocaleString('ja-JP');
  return `¥${Math.round(v).toLocaleString('ja-JP')}`;
}

/** ドーナツ中央用の短縮表記（表示回数などの桁あふれ対策） */
function fmtCenter(key: BreakdownMetricKey, v: number): string {
  const compact = v >= 100000 ? `${(v / 10000).toLocaleString('ja-JP', { maximumFractionDigits: 1 })}万` : v.toLocaleString('ja-JP');
  return key === 'spend' ? `¥${compact}` : compact;
}

/** 複数行の生値を合算（効率系の「全体」「他N件」を分母合算で正しく出すため） */
function sumBreakdown(items: BreakdownAgg[]): BreakdownAgg {
  return items.reduce(
    (a, it) => ({ key: a.key, spend: a.spend + it.spend, impressions: a.impressions + it.impressions, clicks: a.clicks + it.clicks, cv: a.cv + it.cv }),
    { key: '_sum', spend: 0, impressions: 0, clicks: 0, cv: 0 },
  );
}

function cpaHeat(ratio: number | null): { text: string; bg: string; label: string } {
  if (ratio == null) return { text: 'text-gray-400', bg: 'bg-gray-100', label: '—' };
  if (ratio <= 0.7) return { text: 'text-emerald-700', bg: 'bg-emerald-100', label: `${ratio}x` };
  if (ratio <= 1.0) return { text: 'text-green-700', bg: 'bg-green-50', label: `${ratio}x` };
  if (ratio <= 1.3) return { text: 'text-amber-700', bg: 'bg-amber-50', label: `${ratio}x` };
  return { text: 'text-rose-700', bg: 'bg-rose-50', label: `${ratio}x` };
}
const VERDICT_BADGE: Record<CreativeRow['verdict'], { label: string; cls: string }> = {
  winner: { label: '勝ち', cls: 'bg-emerald-500 text-white' },
  loser: { label: '負け', cls: 'bg-rose-500 text-white' },
  insufficient: { label: '判定外', cls: 'bg-gray-400/90 text-white' },
};

export default function AdReport({ initialAccount }: { initialAccount?: string | null }) {
  const [selected, setSelected] = useState<string | undefined>(initialAccount ?? undefined);
  // 期間: preset または custom(since/until)
  const [preset, setPreset] = useState<string>('last_30d');
  const [custom, setCustom] = useState<{ since: string; until: string } | null>(null);
  // キャンペーン/広告セット絞り込み（空＝全て）。選択肢は直近の取得結果を保持（再取得中も消えないように）
  const [selCampaigns, setSelCampaigns] = useState<string[]>([]);
  const [selAdsets, setSelAdsets] = useState<string[]>([]);
  const [filterOpts, setFilterOpts] = useState<{ campaigns: CampaignOpt[]; adsets: AdsetOpt[] }>({ campaigns: [], adsets: [] });
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('cpa');
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>('all');
  const [view, setView] = useState<View>('gallery');
  const [bdMetric, setBdMetric] = useState<BreakdownMetricKey>('spend');
  const PAGE = 10;
  const [visible, setVisible] = useState(PAGE);
  const [modal, setModal] = useState<CreativeRow | null>(null);
  // AI分析・改善案
  const [analysis, setAnalysis] = useState<{ situation: string; actions: { title: string; detail: string }[] } | null>(null);
  // 質問チャットが分析時と同じデータを再送するために保持（分析実行時のスナップショット）
  const [analysisPayload, setAnalysisPayload] = useState<Record<string, unknown> | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const loading = !data && !error;

  // ホーム（表紙）で選び直したアカウントを反映。同一値なら query 不変で再取得は走らない
  useEffect(() => { if (initialAccount) setSelected(initialAccount); }, [initialAccount]);

  // 絞り込みセレクタの選択肢を最新の取得結果から保持
  useEffect(() => {
    if (data) setFilterOpts({ campaigns: data.campaignOptions ?? [], adsets: data.adsetOptions ?? [] });
  }, [data]);

  // クエリ文字列（期間＋アカウント＋絞り込み）。これが変わったら再取得。
  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (selected) p.set('account', selected);
    if (custom) { p.set('since', custom.since); p.set('until', custom.until); }
    else p.set('preset', preset);
    if (selCampaigns.length) p.set('campaigns', selCampaigns.join(','));
    if (selAdsets.length) p.set('adsets', selAdsets.join(','));
    return p.toString();
  }, [selected, preset, custom, selCampaigns, selAdsets]);

  // 同じ期間ボタンの再クリック（query不変）でも再取得できるよう、明示的な再取得カウンタを併用
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/meta/report?${query}`)
      .then((r) => r.json())
      .then((d: ReportData) => { if (cancelled) return; if (!d.ok) setError(d.error ?? '取得に失敗しました'); else setData(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : '通信エラー'); });
    return () => { cancelled = true; };
  }, [query, tick]);

  const reload = (mut: () => void) => {
    setData(null); setError(null); setVisible(PAGE); setAnalysis(null); setAnalysisError(null);
    setAnalysisPayload(null); // 旧期間のデータで質問チャットが回答しないようリセット
    setModal(null); // 期間/アカウント切替後に旧データのモーダルを残さない
    mut();
    setTick((t) => t + 1);
  };

  // AI分析・質問チャット共通のデータペイロードを構築（優先順位・勝ちセグメントの取得込み）
  const buildPayload = async (): Promise<Record<string, unknown> | null> => {
    if (!data) return null;
    const withCpa = data.creatives.filter((c) => c.cpa != null);
    const topCreatives = withCpa.filter((c) => c.verdict === 'winner').sort((a, b) => a.cpa! - b.cpa!).slice(0, 5)
      .map((c) => ({ name: c.name, cpa: c.cpa, verdict: c.verdict, active: c.active }));
    const worstCreatives = [...withCpa].sort((a, b) => b.cpa! - a.cpa!).slice(0, 5)
      .map((c) => ({ name: c.name, cpa: c.cpa, spend: c.spend, verdict: c.verdict, active: c.active }));

    // 優先順位タブ・勝ちセグメントタブと同じ評価済みデータを同じ期間で取得してAIに渡す。
    // preset期間は since/until を trend の実日付で解決（全期間はパラメータなし＝スナップショット/全蓄積）。
    const isMax = data.range.datePreset === 'maximum';
    const since = data.range.since ?? data.trend[0]?.date;
    const until = data.range.until ?? data.trend[data.trend.length - 1]?.date;
    const rq = new URLSearchParams({ account: data.account.accountId });
    if (!isMax && since && until) { rq.set('since', since); rq.set('until', until); }
    // 絞り込みは優先順位・勝ちセグメントにも同条件で適用（AIに渡すデータを表示と一致させる）
    if (selCampaigns.length) rq.set('campaigns', selCampaigns.join(','));
    if (selAdsets.length) rq.set('adsets', selAdsets.join(','));
    const canFetchEval = isMax || (since && until);
    const [prio, seg] = canFetchEval
      ? await Promise.all([
          fetch(`/api/meta/priority?${rq}`).then((r) => r.json()).catch(() => null),
          fetch(`/api/meta/segments?${rq}`).then((r) => r.json()).catch(() => null),
        ])
      : [null, null];
    let priority = null;
    if (prio?.ok) {
      const rows: PriorityApiRow[] = prio.rows ?? [];
      const verdictCounts: Record<string, number> = {};
      for (const r of rows) verdictCounts[r.verdict] = (verdictCounts[r.verdict] ?? 0) + 1;
      priority = {
        settings: prio.settings, conversionLabel: prio.conversionLabel,
        verdictCounts, totalRows: rows.length,
        rows: rows.slice(0, 30).map((r) => ({
          name: r.integratedName, spend: Math.round(r.spend), purchases: r.purchases,
          cpa: r.cpa == null ? null : Math.round(r.cpa),
          cpaRank: r.cpaRank, spendRank: r.spendRank, verdict: r.verdict, adCount: r.adCount,
        })),
      };
    }
    let segments = null;
    if (seg?.ok) {
      const dims: SegmentApiDim[] = seg.dimensions ?? [];
      segments = {
        dimensions: dims.map((d) => ({
          label: d.label, cvAvailable: d.cvAvailable, conversionLabel: d.conversionLabel,
          rows: d.rows.slice(0, 12).map((r) => ({
            segment: r.segment, spend: r.spend, cv: r.cv,
            cpa: r.cpa == null ? null : Math.round(r.cpa),
            verdict: r.verdict, spendRankLabel: r.spendRankLabel,
          })),
        })),
        winners: (seg.winners ?? []).slice(0, 10),
      };
    }

    // 絞り込み中はAIにもその前提を伝える（「アカウント全体の数値」と誤読させない）
    const filterNames = [
      ...selCampaigns.map((id) => filterOpts.campaigns.find((c) => c.id === id)?.name ?? id),
      ...selAdsets.map((id) => filterOpts.adsets.find((a) => a.id === id)?.name ?? id),
    ];
    const rangeLabel = filterNames.length
      ? `${data.range.label}（絞り込み: ${filterNames.slice(0, 5).join(' / ')}${filterNames.length > 5 ? ` 他${filterNames.length - 5}件` : ''}）`
      : data.range.label;

    return {
      client: data.account.client, rangeLabel,
      summary: data.summary, deltas: data.deltas, media: data.media, placement: data.placement,
      age: data.age, gender: data.gender,
      winningSummary: data.winningSummary, topCreatives, worstCreatives,
      priority, segments,
      // クリエイティブ×配置クロス用（サーバー側でDB集計）。全期間はnull＝蓄積分すべて
      account: data.account.accountId,
      since: isMax ? null : since ?? null,
      until: isMax ? null : until ?? null,
      // クロス集計にも同じ絞り込みを適用
      campaigns: selCampaigns.length ? selCampaigns : null,
      adsets: selAdsets.length ? selAdsets : null,
    };
  };

  const runAnalysis = async () => {
    if (!data) return;
    setAnalyzing(true); setAnalysisError(null);
    try {
      const payload = await buildPayload();
      if (!payload) return;
      setAnalysisPayload(payload);
      const res = await fetch('/api/meta/report-insights', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (!d.ok) { setAnalysisError(d.error ?? '生成に失敗しました'); return; }
      const actions: { title: string; detail: string }[] = Array.isArray(d.actions) && d.actions.length > 0
        ? d.actions
        : (d.suggestions ?? []).map((s: string) => ({ title: s, detail: '' }));
      setAnalysis({ situation: d.situation ?? '', actions });
    } catch (e) {
      setAnalysisError(e instanceof Error ? e.message : '通信エラー');
    } finally {
      setAnalyzing(false);
    }
  };

  // 改善アクションへの質問チャット（分析時のペイロード＋分析結果＋履歴をステートレスに送る）
  const askAction = async (messages: { role: 'user' | 'assistant'; content: string }[], focusIndex: number): Promise<string> => {
    const res = await fetch('/api/meta/insights-chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(analysisPayload ?? {}), analysis, focusIndex, messages }),
    });
    const d = await res.json();
    if (!d.ok) throw new Error(d.error ?? '回答の生成に失敗しました');
    return d.reply as string;
  };

  // レポート全体への質問チャット（常設・分析未実行でも使える）。
  // ペイロードは初回質問時に構築して analysisPayload にキャッシュ（分析実行時と共用）。
  const askReport = async (messages: { role: 'user' | 'assistant'; content: string }[]): Promise<string> => {
    let payload = analysisPayload;
    if (!payload) {
      payload = await buildPayload();
      if (!payload) throw new Error('レポートデータの読み込みが完了していません');
      setAnalysisPayload(payload);
    }
    const res = await fetch('/api/meta/insights-chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, analysis, messages }),
    });
    const d = await res.json();
    if (!d.ok) throw new Error(d.error ?? '回答の生成に失敗しました');
    return d.reply as string;
  };

  const accountId = selected ?? data?.account.accountId;

  // クリエイティブ詳細モーダルの内訳表示用（AI分析と同じ期間解決: 全期間=null＝蓄積分すべて）
  const breakdownQuery = useMemo(() => {
    if (!data) return null;
    const isMax = data.range.datePreset === 'maximum';
    const since = data.range.since ?? data.trend[0]?.date;
    const until = data.range.until ?? data.trend[data.trend.length - 1]?.date;
    return {
      account: data.account.accountId,
      since: isMax ? null : since ?? null,
      until: isMax ? null : until ?? null,
    };
  }, [data]);

  const rows = useMemo(() => {
    if (!data) return [];
    let r = data.creatives;
    if (verdictFilter !== 'all') r = r.filter((c) => c.verdict === verdictFilter);
    return [...r].sort((a, b) => {
      switch (sort) {
        case 'cpa': return (a.cpa ?? Infinity) - (b.cpa ?? Infinity);
        case 'cv': return b.cv - a.cv;
        case 'spend': return b.spend - a.spend;
        case 'ctr': return b.ctr - a.ctr;
        case 'impressions': return b.impressions - a.impressions;
      }
    });
  }, [data, sort, verdictFilter]);

  // 絞り込みでバーの基準が変わらないよう、スケールは全クリエイティブ基準
  const maxSpend = useMemo(() => Math.max(1, ...(data?.creatives ?? []).map((r) => r.spend)), [data]);
  const counts = useMemo(() => {
    const c = data?.creatives ?? [];
    return { all: c.length, winner: c.filter((x) => x.verdict === 'winner').length, loser: c.filter((x) => x.verdict === 'loser').length };
  }, [data]);

  return (
    <div className="space-y-5" id="ad-report-root">
      {/* ヘッダー行 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">📊</span>
          <h2 className="text-lg font-bold text-gray-900">広告レポート</h2>
          <span className="text-[11px] text-gray-400">クリエイティブ別 成果分析</span>
        </div>
        <div className="ml-auto flex items-center gap-2 no-print">
          <select
            value={accountId ?? ''}
            onChange={(e) => reload(() => { setSelected(e.target.value); setSelCampaigns([]); setSelAdsets([]); setFilterOpts({ campaigns: [], adsets: [] }); })}
            className="py-1.5 px-2 rounded-lg text-xs font-medium border border-gray-200 bg-white text-gray-700 hover:border-gray-300 focus:border-blue-400 outline-none"
          >
            {(data?.accounts ?? []).map((a) => <option key={a.accountId} value={a.accountId}>{a.client}</option>)}
          </select>
          <button
            onClick={() => window.print()}
            disabled={!data}
            className="py-1.5 px-3 rounded-lg text-xs font-bold text-white bg-gray-800 hover:bg-gray-700 disabled:opacity-40 transition-colors"
            title="表示中の内容をPDF出力（ブラウザの印刷→PDFで保存）"
          >PDF出力</button>
        </div>
      </div>

      {/* 期間セレクタ */}
      <div className="flex flex-wrap items-center gap-2 bg-white rounded-xl border border-gray-200 p-2 no-print">
        <span className="text-[10px] text-gray-400 px-1">期間</span>
        {PRESETS.map((p) => (
          <button
            key={p.v}
            onClick={() => reload(() => { setCustom(null); setPreset(p.v); })}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
              !custom && preset === p.v ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >{p.label}</button>
        ))}
        <div className="w-px h-5 bg-gray-200 mx-1" />
        <CustomRange active={!!custom} value={custom} onApply={(r) => reload(() => setCustom(r))} />
        {data && <span className="text-[10px] text-gray-400 ml-1">表示期間: {data.range.label}</span>}
      </div>

      {/* キャンペーン/広告セット絞り込み（複数選択・選択なし＝全て） */}
      {(filterOpts.campaigns.length > 0 || filterOpts.adsets.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 bg-white rounded-xl border border-gray-200 p-2 no-print">
          <span className="text-[10px] text-gray-400 px-1">絞り込み</span>
          <MultiSelect
            label="キャンペーン"
            options={filterOpts.campaigns}
            selected={selCampaigns}
            onApply={(ids) => reload(() => {
              setSelCampaigns(ids);
              // キャンペーンを絞ったら、対象外の広告セット選択は外す
              if (ids.length) setSelAdsets((prev) => prev.filter((aid) => {
                const a = filterOpts.adsets.find((x) => x.id === aid);
                return a?.campaignId != null && ids.includes(a.campaignId);
              }));
            })}
          />
          <MultiSelect
            label="広告セット"
            options={selCampaigns.length
              ? filterOpts.adsets.filter((a) => a.campaignId != null && selCampaigns.includes(a.campaignId))
              : filterOpts.adsets}
            selected={selAdsets}
            onApply={(ids) => reload(() => setSelAdsets(ids))}
          />
          {(selCampaigns.length > 0 || selAdsets.length > 0) ? (
            <>
              <button
                onClick={() => reload(() => { setSelCampaigns([]); setSelAdsets([]); })}
                className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-gray-100 text-gray-500 hover:bg-gray-200 transition-all"
              >すべて解除</button>
              <span className="text-[10px] text-blue-600">サマリ・グラフ・AI分析すべてに絞り込みが反映されます</span>
            </>
          ) : (
            <span className="text-[10px] text-gray-400">複数のローンチが並行しているとき、関連するものだけ表示できます</span>
          )}
        </div>
      )}

      {/* 異常検知（直近完了日 vs 過去7日中央値。期間セレクタとは独立） */}
      <AnomalyAlerts accountId={accountId ?? null} />

      {loading && (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 flex items-center justify-center min-h-[300px]">
          <div className="text-center"><Spinner /><p className="text-sm text-gray-400 mt-3">Metaから期間データを取得中...</p></div>
        </div>
      )}
      {error && !loading && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-700 text-sm">
          {error}
          {/token|OAuth|session|expired/i.test(error) && (
            <p className="text-[11px] text-rose-400 mt-1">※ META_ACCESS_TOKEN が失効している可能性があります。システムユーザーから再発行してください。</p>
          )}
        </div>
      )}

      {data && !loading && (
        <>
          {/* 勝ちパターン要約バナー */}
          <WinningBanner w={data.winningSummary} rangeLabel={data.range.label} />

          {/* レポート全体へのAI質問（常設）。アカウント・期間・絞り込みが変わったら会話をリセット */}
          <ReportChat key={`${data.account.accountId}:${data.range.label}:${selCampaigns.join('.')}:${selAdsets.join('.')}`} rangeLabel={data.range.label} onAsk={askReport} />

          {/* AI分析・改善案 */}
          <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-white p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[11px] font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full">🤖 AI分析・改善案</span>
              <span className="text-[11px] text-gray-400">{data.range.label} の状況と次の打ち手</span>
              <button
                onClick={runAnalysis}
                disabled={analyzing}
                className="ml-auto px-3 py-1.5 rounded-lg text-[11px] font-bold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition-colors no-print"
              >
                {analyzing ? '分析中...' : analysis ? '再分析' : 'AIで分析する'}
              </button>
            </div>
            {analysisError && <p className="text-xs text-rose-500">{analysisError}</p>}
            {!analysis && !analyzing && !analysisError && (
              <p className="text-xs text-gray-400 py-3">「AIで分析する」を押すと、この期間の状況説明（前期比込み）と具体的な改善アクションを生成します。</p>
            )}
            {analyzing && <div className="py-4 flex items-center gap-2 text-xs text-gray-500"><Spinner /><span>運用データを読み解いています...</span></div>}
            {analysis && (
              <div className="space-y-3">
                <div className="bg-white rounded-xl border border-gray-100 p-3">
                  <p className="text-[11px] font-semibold text-indigo-600 mb-1">📊 状況</p>
                  <p className="text-[13px] text-gray-700 leading-relaxed whitespace-pre-wrap">{analysis.situation}</p>
                </div>
                {analysis.actions.length > 0 && (
                  <div className="bg-white rounded-xl border border-gray-100 p-3">
                    <p className="text-[11px] font-semibold text-emerald-600 mb-1.5">✅ 改善アクション（優先度順）</p>
                    <ul className="space-y-1.5">
                      {analysis.actions.map((a, i) => <ActionItem key={i} index={i} action={a} onAsk={askAction} />)}
                    </ul>
                  </div>
                )}
                <p className="text-[10px] text-gray-400">※ AIによる示唆です。最終判断は運用者が行ってください。数値は表示中の期間データに基づきます。</p>
              </div>
            )}
          </div>

          {/* KPIサマリ（前期比＋日次推移グラフ付き） */}
          <div className="grid gap-4 lg:grid-cols-3">
            <KpiCard title="広告費 / 表示回数 / CPM" accent="blue"
              items={[
                { k: '広告費', v: yen(data.summary.spend), d: data.deltas?.spend, mk: 'spend' },
                { k: '表示回数', v: num(data.summary.impressions), d: data.deltas?.impressions, mk: 'impressions' },
                { k: 'CPM', v: yen(data.summary.cpm), d: data.deltas?.cpm, mk: 'cpm' },
              ]}
              chart={<LineChart trend={data.trend} a={{ key: 'spend', label: '広告費', color: '#3B82F6' }} b={{ key: 'impressions', label: '表示回数', color: '#22D3EE' }} />}
            />
            <KpiCard title="クリック率 / クリック数 / CPC" accent="cyan"
              items={[
                { k: 'CTR', v: pct(data.summary.ctr), d: data.deltas?.ctr, mk: 'ctr' },
                { k: 'クリック数', v: num(data.summary.clicks), d: data.deltas?.clicks, mk: 'clicks' },
                { k: 'CPC', v: yen(data.summary.cpc), d: data.deltas?.cpc, mk: 'cpc' },
              ]}
              chart={<LineChart trend={data.trend} a={{ key: 'clicks', label: 'クリック数', color: '#6366F1' }} b={{ key: 'ctr', label: 'CTR', color: '#22D3EE' }} />}
            />
            <KpiCard title="CVR / コンバージョン / CPA" accent="emerald"
              items={[
                { k: 'CVR', v: pct(data.summary.cvr), d: data.deltas?.cvr, mk: 'cvr' },
                { k: 'CV', v: num(data.summary.cv), d: data.deltas?.cv, mk: 'cv' },
                { k: 'CPA', v: yen(data.summary.cpa), d: data.deltas?.cpa, mk: 'cpa' },
              ]}
              chart={<LineChart trend={data.trend} a={{ key: 'cv', label: 'CV', color: '#10B981' }} b={{ key: 'cvr', label: 'CVR', color: '#22D3EE' }} />}
            />
          </div>
          <p className="text-[11px] text-gray-400 -mt-2">
            配信 {data.summary.adCount} 広告（うちCVあり {data.summary.withCvCount}）／ 主CV種別: {data.summary.conversionLabels.join(' ・ ') || '—'}
            <span className="text-gray-300 ml-1">※ CPAは消化÷主CV。勝ち負けは同一CV種別の中央値比で判定。</span>
            {(data.cvDeviationPct ?? 0) !== 0 && (
              <span className="ml-1.5 font-medium text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-2 py-0.5" title="評価設定のCV乖離率でCV・CPA・CVRを実CV換算しています">
                CV乖離補正 {data.cvDeviationPct}%（実CV換算）
              </span>
            )}
          </p>

          {/* 内訳グラフの指標切替（媒体/配置/性別/年齢の4カード共通） */}
          <div className="flex flex-wrap items-center gap-1.5 -mb-2">
            <span className="text-xs text-gray-400 px-1">内訳グラフの指標</span>
            {BREAKDOWN_METRICS.map((m) => (
              <button key={m.key} onClick={() => setBdMetric(m.key)}
                className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-all ${bdMetric === m.key ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >{m.label}</button>
            ))}
          </div>

          {/* 媒体・配置 内訳グラフ */}
          <div className="grid gap-4 md:grid-cols-2">
            <DonutCard dim="媒体別" sub="publisher platform" items={data.media} metric={bdMetric} colorByKey />
            <DonutCard dim="配置別" sub="platform position" items={data.placement} metric={bdMetric} />
          </div>

          {/* 性別・年齢別 内訳グラフ */}
          <div className="grid gap-4 md:grid-cols-2">
            <DonutCard dim="性別" sub="gender" items={data.gender} metric={bdMetric}
              labelMap={{ male: '男性', female: '女性', unknown: '不明' }} />
            <DonutCard dim="年齢別" sub="age" items={data.age} metric={bdMetric} limit={8}
              labelMap={{ unknown: '不明', Unknown: '不明' }} />
          </div>

          {/* キャンペーン → 広告セット 階層 */}
          <HierarchyTable nodes={data.hierarchy} />

          {/* ツールバー */}
          <div className="flex flex-wrap items-center gap-2 bg-white rounded-xl border border-gray-200 p-2 no-print">
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-gray-400 px-1">並べ替え</span>
              {SORTS.map((s) => (
                <button key={s.key} onClick={() => { setSort(s.key); setVisible(PAGE); }}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${sort === s.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                >{s.label}</button>
              ))}
            </div>
            <div className="w-px h-5 bg-gray-200 mx-1" />
            <div className="flex items-center gap-1">
              {([{ v: 'all', label: `すべて ${counts.all}` }, { v: 'winner', label: `勝ち ${counts.winner}` }, { v: 'loser', label: `負け ${counts.loser}` }] as const).map((f) => (
                <button key={f.v} onClick={() => { setVerdictFilter(f.v); setVisible(PAGE); }}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${verdictFilter === f.v ? (f.v === 'winner' ? 'bg-emerald-500 text-white' : f.v === 'loser' ? 'bg-rose-500 text-white' : 'bg-gray-700 text-white') : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                >{f.label}</button>
              ))}
            </div>
            <div className="ml-auto inline-flex rounded-md border border-gray-200 p-0.5">
              {([{ v: 'gallery', label: 'ギャラリー' }, { v: 'table', label: 'テーブル' }] as const).map((vw) => (
                <button key={vw.v} onClick={() => setView(vw.v)}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium transition-all ${view === vw.v ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-700'}`}
                >{vw.label}</button>
              ))}
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-gray-400 text-sm">
              この期間に配信されたクリエイティブがありません。期間を広げ{(selCampaigns.length > 0 || selAdsets.length > 0) ? 'るか、絞り込みを解除し' : ''}てみてください。
            </div>
          ) : (
            <>
              {view === 'gallery' ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {rows.slice(0, visible).map((c) => <GalleryCard key={c.adId} c={c} maxSpend={maxSpend} onOpen={() => setModal(c)} />)}
                </div>
              ) : (
                <ReportTable rows={rows.slice(0, visible)} maxSpend={maxSpend} onOpen={setModal} />
              )}
              {visible < rows.length && (
                <div className="flex flex-col items-center gap-2 pt-2 no-print">
                  <button onClick={() => setVisible((v) => v + PAGE)} className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-500 active:scale-[0.98] transition-all shadow-sm">
                    もっと見る（残り {rows.length - visible} 件）
                  </button>
                  <button onClick={() => setVisible(rows.length)} className="text-[11px] text-gray-400 hover:text-gray-600 transition-colors">すべて表示（{rows.length}件）</button>
                </div>
              )}
              <p className="text-center text-[11px] text-gray-400">{Math.min(visible, rows.length)} / {rows.length} 件を表示中</p>
            </>
          )}
        </>
      )}

      {modal && <CreativeModal c={modal} bq={breakdownQuery} onClose={() => setModal(null)} />}
    </div>
  );
}

/**
 * チェックボックス式の複数選択ドロップダウン（キャンペーン/広告セット絞り込み用）。
 * チェックのたびに再取得しないよう、パネルを閉じた（or 適用を押した）時点で変更があれば onApply を1回呼ぶ。
 */
function MultiSelect({ label, options, selected, onApply }: {
  label: string;
  options: { id: string; name: string }[];
  selected: string[];
  onApply: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(selected);

  const openPanel = () => { setDraft(selected); setOpen(true); };
  const commit = () => {
    setOpen(false);
    const changed = draft.length !== selected.length || draft.some((id) => !selected.includes(id));
    if (changed) onApply(draft);
  };
  const toggle = (id: string) => setDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));
  const active = selected.length > 0;

  return (
    <div className="relative">
      <button
        onClick={() => (open ? commit() : openPanel())}
        className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${active ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
      >{label}: {active ? `${selected.length}件選択` : 'すべて'} ▾</button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={commit} />
          <div className="absolute left-0 top-full z-40 mt-1 w-80 bg-white border border-gray-200 rounded-xl shadow-lg p-2">
            <div className="flex items-center justify-between px-1 pb-1.5 border-b border-gray-100 mb-1.5">
              <span className="text-[10px] text-gray-400">複数選択できます（選択なし＝すべて表示）</span>
              <button onClick={() => setDraft([])} className="text-[10px] text-blue-600 hover:underline shrink-0">選択解除</button>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {options.length === 0 && <p className="text-[11px] text-gray-400 px-1 py-2">選択肢がありません</p>}
              {options.map((o) => (
                <label key={o.id} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-gray-50 cursor-pointer">
                  <input type="checkbox" checked={draft.includes(o.id)} onChange={() => toggle(o.id)} className="accent-blue-600 shrink-0" />
                  <span className="text-[11px] text-gray-700 truncate" title={o.name}>{o.name}</span>
                </label>
              ))}
            </div>
            <div className="pt-1.5 mt-1 border-t border-gray-100 flex justify-end">
              <button onClick={commit} className="px-3 py-1 rounded-md text-[11px] font-bold text-white bg-blue-600 hover:bg-blue-500">適用</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** レポート全体へのAI質問チャット（常設）。分析未実行でも表示中の期間データに基づいて回答する。 */
function ReportChat({ rangeLabel, onAsk }: {
  rangeLabel: string;
  onAsk: (messages: { role: 'user' | 'assistant'; content: string }[]) => Promise<string>;
}) {
  const [msgs, setMsgs] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const send = async () => {
    const q = input.trim();
    if (!q || sending) return;
    const next = [...msgs, { role: 'user' as const, content: q }];
    setMsgs(next);
    setInput('');
    setSending(true);
    setChatError(null);
    try {
      const reply = await onAsk(next);
      setMsgs([...next, { role: 'assistant' as const, content: reply }]);
    } catch (e) {
      setChatError(e instanceof Error ? e.message : '通信エラー');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 via-white to-white p-4 no-print">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] font-bold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">💬 AIに質問</span>
        <span className="text-[11px] text-gray-400">{rangeLabel} のレポート全体について質問できます（分析の実行は不要）</span>
        {msgs.length > 0 && (
          <button
            onClick={() => { setMsgs([]); setChatError(null); }}
            className="ml-auto text-[10px] text-gray-400 hover:text-gray-600 transition-colors"
          >会話をクリア</button>
        )}
      </div>
      {msgs.length > 0 && (
        <div className="space-y-2 mb-2 max-h-80 overflow-y-auto">
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] px-3 py-2 rounded-lg text-[12px] leading-relaxed whitespace-pre-wrap ${
                m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-700'
              }`}>{m.content}</div>
            </div>
          ))}
        </div>
      )}
      {sending && <p className="text-[11px] text-gray-400 mb-1.5">回答を作成中…</p>}
      {chatError && <p className="text-[11px] text-red-500 mb-1.5">{chatError}（もう一度送信してください）</p>}
      <div className="flex gap-1.5">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) send(); }}
          placeholder="例: 「CPAが悪化している要因は？」「どの配置に予算を寄せるべき？」"
          disabled={sending}
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-[12px] text-gray-800 bg-white outline-none focus:border-blue-400 disabled:opacity-50"
        />
        <button
          onClick={send}
          disabled={sending || !input.trim()}
          className="shrink-0 px-4 py-2 rounded-lg text-[12px] font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
        >送信</button>
      </div>
      <p className="text-[10px] text-gray-400 mt-1.5">※ 回答は表示中の期間・アカウントの実データに基づきます。AIによる示唆のため最終判断は運用者が行ってください。</p>
    </div>
  );
}

/** AI分析の改善アクション1件。詳細は「詳細」ボタンで開閉（印刷時は常に表示）。💬で打ち手への質問チャット */
function ActionItem({ index, action, onAsk }: {
  index: number;
  action: { title: string; detail: string };
  onAsk?: (messages: { role: 'user' | 'assistant'; content: string }[], focusIndex: number) => Promise<string>;
}) {
  const [open, setOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [msgs, setMsgs] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const send = async () => {
    const q = input.trim();
    if (!q || sending || !onAsk) return;
    const next = [...msgs, { role: 'user' as const, content: q }];
    setMsgs(next);
    setInput('');
    setSending(true);
    setChatError(null);
    try {
      const reply = await onAsk(next, index);
      setMsgs([...next, { role: 'assistant' as const, content: reply }]);
    } catch (e) {
      setChatError(e instanceof Error ? e.message : '通信エラー');
    } finally {
      setSending(false);
    }
  };

  return (
    <li className="text-[13px] text-gray-700 leading-relaxed">
      <div className="flex gap-2 items-start">
        <span className="shrink-0 w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold flex items-center justify-center mt-0.5">{index + 1}</span>
        <span className="flex-1">{action.title}</span>
        {onAsk && (
          <button
            onClick={() => setChatOpen((v) => !v)}
            className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-md border transition-colors no-print ${chatOpen ? 'border-blue-300 text-blue-600 bg-blue-50' : 'border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600'}`}
            title="この打ち手について根拠や実行方法をAIに質問する"
          >💬 質問</button>
        )}
        {action.detail && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-md border border-gray-200 text-gray-500 hover:border-emerald-300 hover:text-emerald-600 transition-colors no-print"
          >{open ? '閉じる' : '詳細'}</button>
        )}
      </div>
      {action.detail && (
        <div className={`${open ? '' : 'hidden'} print:block ml-6 mt-1 mb-1 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100 text-[12px] text-gray-600 whitespace-pre-wrap`}>
          {action.detail}
        </div>
      )}
      {chatOpen && onAsk && (
        <div className="ml-6 mt-1.5 mb-2 rounded-lg border border-blue-100 bg-blue-50/40 p-2.5 space-y-2 no-print">
          {msgs.length === 0 && (
            <p className="text-[11px] text-gray-400">
              この打ち手について質問できます（例: 「除外の根拠になった数値は？」「予算はいくら移すべき？」）。回答は表示中の期間データに基づきます。
            </p>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] px-2.5 py-1.5 rounded-lg text-[12px] leading-relaxed whitespace-pre-wrap ${
                m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-700'
              }`}>{m.content}</div>
            </div>
          ))}
          {sending && <p className="text-[11px] text-gray-400">回答を作成中…</p>}
          {chatError && <p className="text-[11px] text-red-500">{chatError}（もう一度送信してください）</p>}
          <div className="flex gap-1.5">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) send(); }}
              placeholder="この打ち手について質問…"
              disabled={sending}
              className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px] text-gray-800 bg-white outline-none focus:border-blue-400 disabled:opacity-50"
            />
            <button
              onClick={send}
              disabled={sending || !input.trim()}
              className="shrink-0 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
            >送信</button>
          </div>
        </div>
      )}
    </li>
  );
}

/** クリックしたクリエイティブを拡大表示。動画は再生ソースを遅延取得して再生。 */
interface AdText { primaryTexts: string[]; headlines: string[]; descriptions: string[]; cta?: string; link?: string }
interface BreakdownRow { segment: string; spend: number; impressions: number; clicks: number; ctr: number; cv: number; cpa: number | null }
interface BreakdownDim { dimension: string; label: string; cvAvailable: boolean; conversionLabel: string | null; rows: BreakdownRow[] }
interface BreakdownQuery { account: string; since: string | null; until: string | null }
function CreativeModal({ c, bq, onClose }: { c: CreativeRow; bq: BreakdownQuery | null; onClose: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [permalink, setPermalink] = useState<string | null>(null);
  const [vidError, setVidError] = useState<string | null>(null);
  const [text, setText] = useState<AdText | null>(null);
  const [textError, setTextError] = useState<string | null>(null);
  const [bd, setBd] = useState<BreakdownDim[] | null>(null);
  const [bdError, setBdError] = useState<string | null>(null);
  const isVideo = c.isVideo && !!c.videoId;
  const vidLoading = isVideo && !src && !vidError;
  const textLoading = !!c.creativeId && !text && !textError;

  useEffect(() => {
    if (!c.videoId) return;
    let cancelled = false;
    fetch(`/api/meta/video?videoId=${encodeURIComponent(c.videoId)}`)
      .then((r) => r.json())
      .then((d) => { if (cancelled) return; if (d.ok && d.source) { setSrc(d.source); setPermalink(d.permalink ?? null); } else { setVidError(d.error ?? '再生できませんでした'); setPermalink(d.permalink ?? null); } })
      .catch((e) => { if (!cancelled) setVidError(e instanceof Error ? e.message : '通信エラー'); });
    return () => { cancelled = true; };
  }, [c.videoId]);

  // 広告テキストを取得
  useEffect(() => {
    if (!c.creativeId) return;
    let cancelled = false;
    fetch(`/api/meta/creative-text?creativeId=${encodeURIComponent(c.creativeId)}`)
      .then((r) => r.json())
      .then((d) => { if (cancelled) return; if (d.ok) setText({ primaryTexts: d.primaryTexts ?? [], headlines: d.headlines ?? [], descriptions: d.descriptions ?? [], cta: d.cta, link: d.link }); else setTextError(d.error ?? '取得失敗'); })
      .catch((e) => { if (!cancelled) setTextError(e instanceof Error ? e.message : '通信エラー'); });
    return () => { cancelled = true; };
  }, [c.creativeId]);

  // 表示先の内訳（性別・年齢・配置）を取得
  useEffect(() => {
    if (!bq) return;
    let cancelled = false;
    const p = new URLSearchParams({ account: bq.account, adId: c.adId });
    if (bq.since && bq.until) { p.set('since', bq.since); p.set('until', bq.until); }
    fetch(`/api/meta/creative-breakdown?${p}`)
      .then((r) => r.json())
      .then((d) => { if (cancelled) return; if (d.ok) setBd(d.dimensions ?? []); else setBdError(d.error ?? '取得失敗'); })
      .catch((e) => { if (!cancelled) setBdError(e instanceof Error ? e.message : '通信エラー'); });
    return () => { cancelled = true; };
  }, [c.adId, bq]);

  // Escで閉じる
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const heat = cpaHeat(c.cpaRatio);
  const badge = VERDICT_BADGE[c.verdict];
  const fbPermalink = permalink ? (permalink.startsWith('http') ? permalink : `https://www.facebook.com${permalink}`) : null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 no-print" onClick={onClose}>
      <div className="bg-white rounded-2xl overflow-hidden max-w-3xl w-full max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
          {c.isVideo && <span className="text-[10px] font-bold text-white bg-black/60 px-1.5 py-0.5 rounded">動画</span>}
          {c.active === false && <span className="text-[10px] font-bold text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded-full">⏸ 停止中</span>}
          {c.active === true && <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full">● 配信中</span>}
          <span className="text-sm font-medium text-gray-700 truncate flex-1" title={c.name}>{c.name}</span>
          <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-700 flex items-center justify-center text-lg">×</button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* メディア */}
          <div className="bg-gray-900 flex items-center justify-center min-h-[280px] max-h-[60vh]">
            {isVideo ? (
              vidLoading ? (
                <div className="text-center py-16"><Spinner /><p className="text-xs text-gray-300 mt-3">動画を読み込み中...</p></div>
              ) : src ? (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video src={src} poster={c.imageUrl} controls autoPlay className="max-h-[60vh] w-auto" />
              ) : (
                <div className="text-center py-16 px-6">
                  {c.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.imageUrl} alt={c.name} className="max-h-[34vh] mx-auto rounded mb-3 opacity-80" />
                  )}
                  <p className="text-xs text-rose-300">{vidError}</p>
                  {fbPermalink && <a href={fbPermalink} target="_blank" rel="noreferrer" className="text-xs text-blue-300 underline mt-1 inline-block">Facebookで開く</a>}
                </div>
              )
            ) : c.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.imageUrl} alt={c.name} className="max-h-[60vh] w-auto" />
            ) : (
              <div className="text-gray-500 py-16">画像がありません</div>
            )}
          </div>

          {/* 指標 */}
          <div className="p-4 space-y-3">
            <div className={`flex items-end justify-between rounded-xl px-4 py-3 ${heat.bg}`}>
              <div>
                <div className="text-[10px] text-gray-400 mb-0.5">CPA（{c.conversionLabel ?? 'CVなし'}）</div>
                <div className={`text-2xl font-extrabold leading-none tabular-nums ${heat.text}`}>{yen(c.cpa)}</div>
              </div>
              {c.cpaRatio != null && <span className={`text-xs font-bold ${heat.text}`}>中央値比 {heat.label}</span>}
            </div>
            <div className="grid grid-cols-4 gap-3 text-center">
              <Metric k="広告費" v={yen(c.spend)} /><Metric k="表示" v={num(c.impressions)} />
              <Metric k="CPM" v={yen(c.cpm)} /><Metric k="CTR" v={pct(c.ctr)} />
              <Metric k="クリック" v={num(c.clicks)} /><Metric k="CPC" v={yen(c.cpc)} />
              <Metric k="CV" v={num(c.cv)} /><Metric k="CVR" v={pct(c.cvr)} />
            </div>
            {fbPermalink && src && (
              <a href={fbPermalink} target="_blank" rel="noreferrer" className="text-[11px] text-blue-500 hover:underline inline-block">Facebookで元の投稿を開く ↗</a>
            )}

            {/* 広告テキスト（Advantage+はテキスト違いを複数表示） */}
            <div className="pt-2 border-t border-gray-100">
              <p className="text-[11px] font-semibold text-gray-600 mb-2">広告テキスト</p>
              {textLoading && <p className="text-xs text-gray-400">読み込み中...</p>}
              {textError && <p className="text-xs text-rose-400">{textError}</p>}
              {text && (
                <div className="space-y-3">
                  {text.headlines.length > 0 && (
                    <AdTextBlock label="見出し" count={text.headlines.length} items={text.headlines} strong />
                  )}
                  {text.primaryTexts.length > 0 && (
                    <AdTextBlock label="本文" count={text.primaryTexts.length} items={text.primaryTexts} />
                  )}
                  {text.descriptions.length > 0 && (
                    <AdTextBlock label="説明" count={text.descriptions.length} items={text.descriptions} />
                  )}
                  {text.cta && <div className="text-[11px] text-gray-500">CTA: <span className="font-bold text-gray-800">{text.cta}</span></div>}
                  {text.headlines.length === 0 && text.primaryTexts.length === 0 && text.descriptions.length === 0 && (
                    <p className="text-xs text-gray-400">この広告のテキストは取得できませんでした。</p>
                  )}
                </div>
              )}
            </div>

            {/* 表示先の内訳（性別・年齢・配置） */}
            <div className="pt-2 border-t border-gray-100">
              <p className="text-[11px] font-semibold text-gray-600 mb-2">表示先の内訳（性別・年齢・配置）</p>
              {bq == null && <p className="text-xs text-gray-400">内訳データがありません。</p>}
              {bq != null && !bd && !bdError && <p className="text-xs text-gray-400">読み込み中...</p>}
              {bdError && <p className="text-xs text-rose-400">{bdError}</p>}
              {bd && bd.length === 0 && <p className="text-xs text-gray-400">この期間の内訳データがまだ蓄積されていません。</p>}
              {bd && bd.length > 0 && (
                <div className="space-y-4">
                  {bd.map((dim) => <BreakdownTable key={dim.dimension} dim={dim} />)}
                  <p className="text-[10px] text-gray-400">※ 日次蓄積データからの集計のため、上部の合計値とわずかな差が出ることがあります。</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const GENDER_JA: Record<string, string> = { male: '男性', female: '女性', unknown: '不明' };

/** クリエイティブ詳細モーダル内の内訳テーブル（1次元分）。 */
function BreakdownTable({ dim }: { dim: BreakdownDim }) {
  const total = dim.rows.reduce((s, r) => s + r.spend, 0);
  // CVが取れている中でCPA最良のセグメントをハイライト
  const bestCpa = Math.min(...dim.rows.filter((r) => r.cpa != null).map((r) => r.cpa!));
  const segName = (s: string) => {
    if (dim.dimension === 'gender') return GENDER_JA[s] ?? s;
    // 'age_gender' は '65+・female' 形式。性別部分だけ和訳する
    if (dim.dimension === 'age_gender' && s.includes('・')) {
      const [age, gender] = s.split('・');
      return `${age}・${GENDER_JA[gender] ?? gender}`;
    }
    return s;
  };
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[11px] font-bold text-gray-700">{dim.label}</span>
        <span className="text-[10px] text-gray-400">{dim.cvAvailable ? `CV: ${dim.conversionLabel}` : 'この期間はCVデータなし'}</span>
      </div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-gray-400 text-left">
            <th className="font-normal py-0.5 w-[36%]">セグメント</th>
            <th className="font-normal text-right">広告費</th>
            <th className="font-normal text-right w-12">CV</th>
            <th className="font-normal text-right w-20">CPA</th>
            <th className="font-normal text-right w-14">CTR</th>
          </tr>
        </thead>
        <tbody>
          {dim.rows.map((r) => {
            const share = total > 0 ? (r.spend / total) * 100 : 0;
            const isBest = dim.cvAvailable && r.cpa != null && r.cpa === bestCpa && dim.rows.length > 1;
            const noCv = dim.cvAvailable && r.cv === 0 && share >= 10;
            return (
              <tr key={r.segment} className="border-t border-gray-50">
                <td className="py-1 pr-2">
                  <div className="text-gray-700 truncate" title={r.segment}>{segName(r.segment)}{isBest && <span className="ml-1 text-[9px] font-bold text-emerald-600">CPA最良</span>}</div>
                  <div className="h-1 rounded-full bg-gray-100 mt-0.5"><div className="h-1 rounded-full bg-blue-400" style={{ width: `${Math.max(share, 1)}%` }} /></div>
                </td>
                <td className="text-right tabular-nums text-gray-700">{yen(r.spend)}<span className="text-gray-300 ml-1">{Math.round(share)}%</span></td>
                <td className="text-right tabular-nums text-gray-700">{dim.cvAvailable ? r.cv : '—'}</td>
                <td className={`text-right tabular-nums font-medium ${isBest ? 'text-emerald-600' : noCv ? 'text-rose-500' : 'text-gray-700'}`}>{dim.cvAvailable ? (r.cpa != null ? yen(r.cpa) : r.cv === 0 ? 'CV0' : '—') : '—'}</td>
                <td className="text-right tabular-nums text-gray-500">{pct(r.ctr)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CustomRange({ active, value, onApply }: { active: boolean; value: { since: string; until: string } | null; onApply: (r: { since: string; until: string }) => void }) {
  const [since, setSince] = useState(value?.since ?? '');
  const [until, setUntil] = useState(value?.until ?? '');
  return (
    <div className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 ${active ? 'bg-blue-50 ring-1 ring-blue-300' : ''}`}>
      <span className="text-[10px] text-gray-400">カスタム</span>
      <input type="date" value={since} onChange={(e) => setSince(e.target.value)} className="text-[11px] border border-gray-200 rounded px-1 py-0.5 text-gray-700" />
      <span className="text-gray-300 text-[10px]">〜</span>
      <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="text-[11px] border border-gray-200 rounded px-1 py-0.5 text-gray-700" />
      <button
        onClick={() => { if (since && until) onApply({ since, until }); }}
        disabled={!since || !until}
        className="text-[11px] font-medium px-2 py-0.5 rounded bg-blue-600 text-white disabled:opacity-40 hover:bg-blue-500"
      >適用</button>
    </div>
  );
}

function WinningBanner({ w, rangeLabel }: { w: WinningSummary; rangeLabel: string }) {
  const fmt = (n: number | null) => (n == null ? '—' : '¥' + n.toLocaleString('ja-JP'));
  return (
    <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-rose-50 p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[11px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">🏆 この期間の勝ち筋</span>
        <span className="text-[11px] text-gray-400">{rangeLabel}</span>
        <span className="ml-auto text-[11px] text-gray-500">勝ち <b className="text-emerald-600">{w.winnerCount}</b> ／ 負け <b className="text-rose-600">{w.loserCount}</b></span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {/* 上位勝ちCR */}
        <div className="flex gap-2">
          {w.topWinners.length === 0 ? (
            <p className="text-xs text-gray-400 py-4">この期間の勝ちクリエイティブはまだありません。</p>
          ) : w.topWinners.map((t, i) => (
            <div key={i} className="flex-1 min-w-0 bg-white rounded-xl border border-amber-100 p-2 flex flex-col items-center text-center">
              <div className="w-full aspect-square rounded-lg bg-gray-100 overflow-hidden mb-1">
                {t.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.imageUrl} alt={t.name} className="w-full h-full object-cover" loading="lazy" />
                ) : <div className="w-full h-full flex items-center justify-center text-gray-300 text-xl">🖼️</div>}
              </div>
              <p className="text-[9px] text-gray-500 truncate w-full" title={t.name}>{t.name}</p>
              <p className="text-sm font-extrabold text-emerald-700 leading-none mt-0.5">{fmt(t.cpa)}</p>
            </div>
          ))}
        </div>
        {/* インサイト */}
        <div className="flex flex-col justify-center gap-1.5 text-xs text-gray-600">
          {w.bestMedia && <p>📣 最も予算が乗っている媒体は <b className="text-gray-800">{w.bestMedia}</b></p>}
          {(w.imageWinRate != null || w.videoWinRate != null) && (
            <p>🎞 勝率: 静止画 <b className="text-gray-800">{w.imageWinRate ?? '—'}%</b>（{w.imageTotal}件）／ 動画 <b className="text-gray-800">{w.videoWinRate ?? '—'}%</b>（{w.videoTotal}件）</p>
          )}
          <p className="text-[10px] text-gray-400 leading-snug">※ 勝ち=同一CV種別の中央値より安いCPA。期間を変えると勝ち筋も変わります。</p>
        </div>
      </div>
    </div>
  );
}

function DonutCard({ dim, sub, items, metric, colorByKey, limit = 6, labelMap }: { dim: string; sub: string; items: BreakdownAgg[]; metric: BreakdownMetricKey; colorByKey?: boolean; limit?: number; labelMap?: Record<string, string> }) {
  const def = BREAKDOWN_METRICS.find((m) => m.key === metric)!;
  const labelOf = (k: string) => labelMap?.[k] ?? k;
  const color = (key: string, i: number) => colorByKey ? (PLATFORM_COLOR[key] ?? DONUT_PALETTE[i % DONUT_PALETTE.length]) : DONUT_PALETTE[i % DONUT_PALETTE.length];
  const values = items.map((it) => breakdownMetricOf(it, metric));
  // 全体値・「他N件」は分母を合算してから算出（効率系を単純平均にしない）
  const overall = breakdownMetricOf(sumBreakdown(items), metric);
  const rest = items.length > limit ? breakdownMetricOf(sumBreakdown(items.slice(limit)), metric) : null;

  const header = (
    <div className="flex items-baseline gap-2 mb-3">
      <h3 className="text-sm font-semibold text-gray-700">{dim} {def.label}</h3>
      <span className="text-[10px] text-gray-300">{sub}</span>
    </div>
  );

  // ---- 効率系（CPA/CPM/CTR/CPC）: 割合の円が意味を持たないため横棒で比較 ----
  if (def.kind === 'ratio') {
    const nums = values.filter((v): v is number => v != null);
    const max = nums.length ? Math.max(...nums) : 0;
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
        {header}
        {nums.length === 0 ? (
          <p className="text-xs text-gray-400 py-8 text-center">この期間は{def.label}を算出できるデータがありません。</p>
        ) : (
          <div className="space-y-1.5">
            <p className="text-[11px] text-gray-400 mb-2">全体 <b className="text-gray-800 text-sm">{fmtBreakdownMetric(metric, overall)}</b><span className="text-gray-300 ml-2">並びは広告費順</span></p>
            {items.slice(0, limit).map((it, i) => {
              const v = values[i];
              return (
                <div key={it.key} className="flex items-center gap-1.5 text-[11px]">
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: color(it.key, i) }} />
                  <span className="text-gray-600 truncate w-28 shrink-0" title={labelOf(it.key)}>{labelOf(it.key)}</span>
                  <div className="flex-1 h-3 bg-gray-50 rounded-sm overflow-hidden">
                    {v != null && max > 0 && (
                      <div className="h-full rounded-sm" style={{ width: `${Math.max((v / max) * 100, 2)}%`, backgroundColor: color(it.key, i) }} />
                    )}
                  </div>
                  <span className={`tabular-nums w-20 text-right ${v == null ? 'text-gray-300' : 'text-gray-700'}`}>
                    {v == null ? (metric === 'cpa' ? 'CV0' : '—') : fmtBreakdownMetric(metric, v)}
                  </span>
                </div>
              );
            })}
            {items.length > limit && (
              <div className="text-[10px] text-gray-400 pl-4">他{items.length - limit}件 {fmtBreakdownMetric(metric, rest)}</div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ---- 加算系（広告費/CV/表示回数/クリック）: 従来どおりドーナツ ----
  const sums = values.map((v) => v ?? 0);
  const total = sums.reduce((s, v) => s + v, 0);
  const R = 54, C = 2 * Math.PI * R;
  // セグメントを事前計算（描画中に変数を再代入しない・非破壊のprefix-sum）
  const dashes = sums.map((v) => (total > 0 ? (v / total) * C : 0));
  const segments = items.map((it, i) => ({
    key: it.key,
    stroke: color(it.key, i),
    dash: dashes[i],
    offset: -dashes.slice(0, i).reduce((s, d) => s + d, 0),
  }));
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
      {header}
      {total === 0 ? (
        <p className="text-xs text-gray-400 py-8 text-center">この期間は{def.label}のデータがありません。</p>
      ) : (
        <div className="flex items-center gap-4">
          <svg width="140" height="140" viewBox="0 0 140 140" className="shrink-0">
            <g transform="translate(70,70) rotate(-90)">
              <circle r={R} cx="0" cy="0" fill="none" stroke="#F1F5F9" strokeWidth="18" />
              {segments.map((s) => (
                <circle key={s.key} r={R} cx="0" cy="0" fill="none" stroke={s.stroke} strokeWidth="18"
                  strokeDasharray={`${s.dash} ${C - s.dash}`} strokeDashoffset={s.offset} />
              ))}
            </g>
            <text x="70" y="66" textAnchor="middle" className="fill-gray-400" style={{ fontSize: 9 }}>合計</text>
            <text x="70" y="80" textAnchor="middle" className="fill-gray-800 font-bold" style={{ fontSize: 13 }}>{fmtCenter(metric, total)}</text>
          </svg>
          <div className="flex-1 min-w-0 space-y-1">
            {items.slice(0, limit).map((it, i) => (
              <div key={it.key} className="flex items-center gap-1.5 text-[11px]">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: color(it.key, i) }} />
                <span className="text-gray-600 truncate flex-1" title={labelOf(it.key)}>{labelOf(it.key)}</span>
                <span className="text-gray-400 tabular-nums">{Math.round((sums[i] / total) * 100)}%</span>
                <span className="text-gray-700 tabular-nums w-16 text-right">{fmtBreakdownMetric(metric, sums[i])}</span>
              </div>
            ))}
            {items.length > limit && (
              // ドーナツには全セグメントが描かれるため、凡例に出ていない分があることを明示する
              <div className="text-[10px] text-gray-400 pl-4">
                他{items.length - limit}件 {fmtBreakdownMetric(metric, items.slice(limit).reduce((s, it) => s + (breakdownMetricOf(it, metric) ?? 0), 0))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function HierarchyTable({ nodes }: { nodes: HierNode[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (nodes.length === 0) return null;
  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-700">キャンペーン → 広告セット</h3>
        <span className="text-[10px] text-gray-300">クリックで広告セットを展開</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-gray-400 bg-gray-50/60 border-b border-gray-100">
              <th className="text-left font-medium px-3 py-2">名称</th>
              <th className="text-right font-medium px-2 py-2">広告数</th>
              <th className="text-right font-medium px-2 py-2">広告費</th>
              <th className="text-right font-medium px-2 py-2">表示</th>
              <th className="text-right font-medium px-2 py-2">CPM</th>
              <th className="text-right font-medium px-2 py-2">クリック</th>
              <th className="text-right font-medium px-2 py-2">CV</th>
              <th className="text-right font-medium px-3 py-2">CPA</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((c) => {
              const isOpen = open[c.id];
              return (
                <RowGroup key={c.id} camp={c} isOpen={!!isOpen} onToggle={() => setOpen((o) => ({ ...o, [c.id]: !o[c.id] }))} />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** CPM = 広告費 ÷ 表示回数 × 1000（表示0は—） */
const hierCpm = (n: HierNode) => (n.impressions > 0 ? yen((n.spend / n.impressions) * 1000) : '—');

function RowGroup({ camp, isOpen, onToggle }: { camp: HierNode; isOpen: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="border-b border-gray-50 hover:bg-gray-50/60 cursor-pointer" onClick={onToggle}>
        <td className="px-3 py-2 font-medium text-gray-800">
          <span className="inline-block w-3 text-gray-400">{camp.children?.length ? (isOpen ? '▾' : '▸') : ''}</span>
          {camp.name}
        </td>
        <td className="px-2 py-2 text-right tabular-nums text-gray-500">{camp.adCount}</td>
        <td className="px-2 py-2 text-right tabular-nums text-gray-800">{yen(camp.spend)}</td>
        <td className="px-2 py-2 text-right tabular-nums text-gray-600">{num(camp.impressions)}</td>
        <td className="px-2 py-2 text-right tabular-nums text-gray-600">{hierCpm(camp)}</td>
        <td className="px-2 py-2 text-right tabular-nums text-gray-600">{num(camp.clicks)}</td>
        <td className="px-2 py-2 text-right tabular-nums font-semibold text-gray-800">{num(camp.cv)}</td>
        <td className="px-3 py-2 text-right tabular-nums font-bold text-gray-900">{yen(camp.cpa)}</td>
      </tr>
      {isOpen && camp.children?.map((a) => (
        <tr key={a.id} className="border-b border-gray-50 bg-gray-50/40">
          <td className="px-3 py-1.5 pl-8 text-gray-600">{a.name}</td>
          <td className="px-2 py-1.5 text-right tabular-nums text-gray-400">{a.adCount}</td>
          <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">{yen(a.spend)}</td>
          <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{num(a.impressions)}</td>
          <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{hierCpm(a)}</td>
          <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{num(a.clicks)}</td>
          <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">{num(a.cv)}</td>
          <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{yen(a.cpa)}</td>
        </tr>
      ))}
    </>
  );
}

/** コスト効率系（下がるほど良い）。前期比の色を反転する。 */
const LOWER_BETTER = new Set(['cpm', 'cpc', 'cpa']);
function DeltaBadge({ d, mk }: { d: number | null | undefined; mk: string }) {
  if (d == null) return null;
  const good = LOWER_BETTER.has(mk) ? d < 0 : d > 0;
  const neutral = d === 0;
  const cls = neutral ? 'text-gray-400' : good ? 'text-emerald-600' : 'text-rose-500';
  const arrow = d > 0 ? '▲' : d < 0 ? '▼' : '';
  return <span className={`text-[9px] font-bold ${cls} tabular-nums`}>{arrow}{Math.abs(d)}%</span>;
}

function KpiCard({ title, accent, items, chart }: {
  title: string; accent: 'blue' | 'cyan' | 'emerald';
  items: { k: string; v: string; d?: number | null; mk: string }[];
  chart?: React.ReactNode;
}) {
  const ring = { blue: 'border-blue-100', cyan: 'border-cyan-100', emerald: 'border-emerald-100' }[accent];
  const dot = { blue: 'bg-blue-500', cyan: 'bg-cyan-500', emerald: 'bg-emerald-500' }[accent];
  return (
    <div className={`bg-white rounded-2xl border ${ring} p-4 shadow-sm`}>
      <div className="flex items-center gap-1.5 mb-3"><span className={`w-1.5 h-1.5 rounded-full ${dot}`} /><h3 className="text-xs font-semibold text-gray-500">{title}</h3></div>
      <div className="grid grid-cols-3 gap-2">
        {items.map((it) => (
          <div key={it.k} className="rounded-xl bg-gray-50 px-2 py-2.5 text-center">
            <div className="text-[10px] text-gray-400 mb-0.5">{it.k}</div>
            <div className="text-base font-bold text-gray-900 leading-tight tabular-nums">{it.v}</div>
            <div className="h-3 mt-0.5"><DeltaBadge d={it.d} mk={it.mk} /></div>
          </div>
        ))}
      </div>
      {chart && <div className="mt-3 pt-2 border-t border-gray-50">{chart}</div>}
    </div>
  );
}

/** 2系列の日次折れ線（各系列を自分のmin/maxで正規化して重ねる・ゼロ依存SVG）。 */
function LineChart({ trend, a, b }: {
  trend: TrendPoint[];
  a: { key: keyof TrendPoint; label: string; color: string };
  b: { key: keyof TrendPoint; label: string; color: string };
}) {
  if (trend.length < 2) return <p className="text-[10px] text-gray-300 text-center py-3">推移データが不足しています</p>;
  const W = 300, H = 64, padX = 4, padY = 8;
  const xs = trend.map((_, i) => padX + (i / (trend.length - 1)) * (W - padX * 2));
  const line = (key: keyof TrendPoint, color: string) => {
    const vals = trend.map((t) => Number(t[key]) || 0);
    const min = Math.min(...vals), max = Math.max(...vals);
    const span = max - min || 1;
    const pts = vals.map((v, i) => `${xs[i].toFixed(1)},${(H - padY - ((v - min) / span) * (H - padY * 2)).toFixed(1)}`);
    return <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />;
  };
  const fmtDate = (s: string) => { const [, m, d] = s.split('-'); return `${Number(m)}/${Number(d)}`; };
  return (
    <div>
      <div className="flex items-center gap-3 mb-1">
        <Legend color={a.color} label={a.label} /><Legend color={b.color} label={b.label} />
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 64 }} preserveAspectRatio="none">
        {line(a.key, a.color)}
        {line(b.key, b.color)}
      </svg>
      <div className="flex justify-between text-[9px] text-gray-400 mt-0.5 px-1">
        <span>{fmtDate(trend[0].date)}</span>
        {trend.length > 6 && <span>{fmtDate(trend[Math.floor(trend.length / 2)].date)}</span>}
        <span>{fmtDate(trend[trend.length - 1].date)}</span>
      </div>
    </div>
  );
}
function Legend({ color, label }: { color: string; label: string }) {
  return <span className="flex items-center gap-1 text-[9px] text-gray-500"><span className="w-2.5 h-0.5 rounded" style={{ backgroundColor: color }} />{label}</span>;
}

function GalleryCard({ c, maxSpend, onOpen }: { c: CreativeRow; maxSpend: number; onOpen: () => void }) {
  const heat = cpaHeat(c.cpaRatio);
  const badge = VERDICT_BADGE[c.verdict];
  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden flex flex-col shadow-sm hover:shadow-md transition-shadow">
      <button onClick={onOpen} className="relative aspect-square bg-gray-100 group block w-full text-left" title="クリックで拡大／動画再生">
        {c.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.imageUrl} alt={c.name} className="w-full h-full object-cover" loading="lazy" />
        ) : <div className="absolute inset-0 flex items-center justify-center text-gray-300 text-3xl">🖼️</div>}
        <span className={`absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
        {c.isVideo && <span className="absolute top-2 right-2 text-[10px] font-bold text-white bg-black/60 px-1.5 py-0.5 rounded">動画</span>}
        {c.active === false && <span className="absolute bottom-2 left-2 text-[9px] font-bold text-gray-600 bg-white/90 px-1.5 py-0.5 rounded-full">⏸ 停止中</span>}
        {c.active === true && <span className="absolute bottom-2 left-2 text-[9px] font-bold text-emerald-700 bg-white/90 px-1.5 py-0.5 rounded-full">● 配信中</span>}
        {/* 再生/拡大オーバーレイ */}
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/25 transition-colors">
          <span className="opacity-0 group-hover:opacity-100 transition-opacity w-11 h-11 rounded-full bg-white/90 flex items-center justify-center text-gray-800 text-lg shadow">
            {c.isVideo ? '▶' : '⤢'}
          </span>
        </span>
      </button>
      <div className="p-3 flex-1 flex flex-col gap-2">
        <p className="text-[11px] text-gray-600 leading-snug line-clamp-2 min-h-[2.2em]" title={c.name}>{c.name}</p>
        <div className={`flex items-end justify-between rounded-xl px-3 py-2 ${heat.bg}`}>
          <div>
            <div className="text-[9px] text-gray-400 leading-none mb-0.5">CPA（{c.conversionLabel ?? 'CVなし'}）</div>
            <div className={`text-xl font-extrabold leading-none tabular-nums ${heat.text}`}>{yen(c.cpa)}</div>
          </div>
          {c.cpaRatio != null && <span className={`text-[10px] font-bold ${heat.text}`} title="同一CV種別の中央値比（1未満=安い=良い）">中央値 {heat.label}</span>}
        </div>
        <div className="grid grid-cols-3 gap-x-2 gap-y-1.5 text-center">
          <Metric k="CV" v={num(c.cv)} /><Metric k="CVR" v={pct(c.cvr)} /><Metric k="CTR" v={pct(c.ctr)} />
          <Metric k="広告費" v={yen(c.spend)} /><Metric k="CPC" v={yen(c.cpc)} /><Metric k="表示" v={num(c.impressions)} />
        </div>
        <div className="mt-auto pt-1">
          <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full bg-blue-400 rounded-full" style={{ width: `${Math.max(3, (c.spend / maxSpend) * 100)}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function AdTextBlock({ label, count, items, strong }: { label: string; count: number; items: string[]; strong?: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[10px] font-semibold text-gray-500">{label}</span>
        {count > 1 && <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-full">{count}パターン</span>}
      </div>
      <div className="space-y-1.5">
        {items.map((t, i) => (
          <div key={i} className="flex gap-2">
            {count > 1 && <span className="shrink-0 text-[10px] text-gray-400 mt-0.5 w-4 text-right">{String.fromCharCode(65 + i)}</span>}
            <p className={`flex-1 text-[12px] leading-relaxed whitespace-pre-wrap rounded-lg bg-gray-50 px-2.5 py-1.5 ${strong ? 'font-bold text-gray-800' : 'text-gray-700'}`}>{t}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Metric({ k, v }: { k: string; v: string }) {
  return <div><div className="text-[9px] text-gray-400 leading-none">{k}</div><div className="text-[12px] font-semibold text-gray-800 tabular-nums leading-tight mt-0.5">{v}</div></div>;
}

function ReportTable({ rows, maxSpend, onOpen }: { rows: CreativeRow[]; maxSpend: number; onOpen: (c: CreativeRow) => void }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-gray-400 border-b border-gray-100 bg-gray-50/60">
              <th className="text-left font-medium px-3 py-2">クリエイティブ</th>
              <th className="text-right font-medium px-2 py-2">広告費</th><th className="text-right font-medium px-2 py-2">表示</th>
              <th className="text-right font-medium px-2 py-2">CPM</th><th className="text-right font-medium px-2 py-2">CTR</th>
              <th className="text-right font-medium px-2 py-2">クリック</th><th className="text-right font-medium px-2 py-2">CPC</th>
              <th className="text-right font-medium px-2 py-2">CVR</th><th className="text-right font-medium px-2 py-2">CV</th>
              <th className="text-right font-medium px-2 py-2">CPA</th><th className="text-center font-medium px-2 py-2">判定</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const heat = cpaHeat(c.cpaRatio); const badge = VERDICT_BADGE[c.verdict];
              return (
                <tr key={c.adId} className="border-b border-gray-50 hover:bg-blue-50/40 cursor-pointer" onClick={() => onOpen(c)}>
                  <td className="px-3 py-2 max-w-[240px]">
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 rounded-md bg-gray-100 overflow-hidden shrink-0 relative">
                        {c.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.imageUrl} alt={c.name} className="w-full h-full object-cover" loading="lazy" />
                        ) : <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs">🖼️</div>}
                        {c.isVideo && <span className="absolute inset-0 flex items-center justify-center text-white text-[10px] bg-black/30">▶</span>}
                      </div>
                      <span className="text-gray-700 truncate" title={c.name}>{c.name}{c.isVideo && <span className="text-gray-400 ml-1">[動画]</span>}</span>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    <div className="text-gray-800">{yen(c.spend)}</div>
                    <div className="h-1 mt-0.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-full bg-blue-300" style={{ width: `${Math.max(3, (c.spend / maxSpend) * 100)}%` }} /></div>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-600">{num(c.impressions)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-600">{yen(c.cpm)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-600">{pct(c.ctr)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-600">{num(c.clicks)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-600">{yen(c.cpc)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-600">{pct(c.cvr)}</td>
                  <td className="px-2 py-2 text-right tabular-nums font-semibold text-gray-800">{num(c.cv)}</td>
                  <td className={`px-2 py-2 text-right tabular-nums font-bold ${heat.text}`}><span className={`inline-block px-1.5 py-0.5 rounded ${heat.bg}`}>{yen(c.cpa)}</span></td>
                  <td className="px-2 py-2 text-center"><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin w-8 h-8 mx-auto text-blue-500" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}
