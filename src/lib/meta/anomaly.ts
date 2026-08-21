import { CONVERSION_PRIORITY, type ConversionGroup } from './analyze';
import { cpaLimits, correctCv, type ScoringSettings } from '../scoring';

/**
 * 異常検知: 直近の完了日（=判定対象日）を、その前7日間のベースライン（中央値）と比較し、
 * 「昨日おかしかったこと」をアラートとして返す。
 *
 * 設計方針:
 *  - DB不要。呼び出し側が Meta API の日次インサイト（直近2週間程度）を渡す
 *  - 閾値は絶対額の決め打ちではなく、アカウントの評価設定（報酬単価×ROAS基準から
 *    逆算した★継続ラインCPA = keepLimit）を「意味のある金額」の単位として使う
 *  - Metaはアトリビューション期間内（最大7日）にCVが遡って増えるため、
 *    CV系アラートには計測遅れの可能性がある（UI側で注記する）
 */

export interface DailyAdRow {
  adId: string;
  /** YYYY-MM-DD */
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  actions: { action_type: string; value: number }[];
}

export type AnomalyType =
  | 'spend_spike'   // 消化急増
  | 'spend_stop'    // 消化急減・配信停止疑い
  | 'cv_zero_spend' // 消化しているのにCVゼロ
  | 'cpa_spike'     // CPA急騰
  | 'ctr_drop';     // CTR急落（クリエイティブ疲弊シグナル）

export interface AnomalyAlert {
  type: AnomalyType;
  level: 'warn' | 'critical';
  scope: 'account' | 'ad';
  adId?: string;
  adName?: string;
  message: string;
  /** 判定対象日の値と、比較したベースライン値（中央値）。UIでの根拠表示用 */
  current: number;
  baseline: number | null;
}

export interface AnomalyReport {
  /** 判定対象日（データが足りない場合は null） */
  targetDate: string | null;
  /** ベースラインに使った日付（判定対象日より前・最大7日） */
  baselineDates: string[];
  /** CVの集計に採用した主CV群のラベル（CVが1件もなければ null） */
  conversionLabel: string | null;
  alerts: AnomalyAlert[];
}

interface DayTotal {
  spend: number;
  impressions: number;
  clicks: number;
  cv: number;
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const n = sorted.length;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

function medianOf(values: number[]): number | null {
  return median(values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b));
}

function yen(n: number): string {
  return `${Math.round(n).toLocaleString('ja-JP')}円`;
}

function pct(cur: number, base: number): string {
  return `${Math.round((cur / base) * 100)}%`;
}

/** rows 全体で使う主CV群を決める（CONVERSION_PRIORITY の最上位で存在するもの）。 */
function pickConversionGroup(rows: DailyAdRow[]): ConversionGroup | null {
  for (const g of CONVERSION_PRIORITY) {
    for (const r of rows) {
      for (const a of r.actions) {
        if (a.value > 0 && g.matchTypes.includes(a.action_type)) return g;
      }
    }
  }
  return null;
}

function cvOf(row: DailyAdRow, group: ConversionGroup | null): number {
  if (!group) return 0;
  let cv = 0;
  for (const a of row.actions) {
    if (group.matchTypes.includes(a.action_type) && a.value > cv) cv = a.value;
  }
  return cv;
}

export function detectAnomalies(
  rows: DailyAdRow[],
  opts: {
    settings: ScoringSettings;
    /** adId → 広告名（アラート表示用。無ければIDで表示） */
    adNames?: Map<string, string>;
    /** 「今日」（YYYY-MM-DD）。今日の行は集計途中なので判定から除外する */
    today: string;
    /** ad単位アラートの最大件数（既定8） */
    maxAdAlerts?: number;
  },
): AnomalyReport {
  const { settings, adNames, today } = opts;
  const maxAdAlerts = opts.maxAdAlerts ?? 8;
  const keepLimit = cpaLimits(settings).keep; // ★継続ラインのCPA上限 = 「意味のある金額」の単位
  const group = pickConversionGroup(rows);

  // 日付ごとに存在確認（今日=部分データは除外）
  const dates = [...new Set(rows.map((r) => r.date))].filter((d) => d < today).sort();
  const targetDate = dates[dates.length - 1] ?? null;
  const baselineDates = targetDate ? dates.slice(0, -1).slice(-7) : [];
  const empty: AnomalyReport = {
    targetDate,
    baselineDates,
    conversionLabel: group?.label ?? null,
    alerts: [],
  };
  // ベースラインが3日未満だと中央値が不安定なので判定しない
  if (!targetDate || baselineDates.length < 3) return empty;

  // 日別×広告別の集計
  const dayTotals = new Map<string, DayTotal>();
  const adDay = new Map<string, Map<string, DayTotal>>(); // adId → date → total
  for (const r of rows) {
    if (r.date > targetDate) continue;
    const cv = correctCv(cvOf(r, group), settings);
    const acc = dayTotals.get(r.date) ?? { spend: 0, impressions: 0, clicks: 0, cv: 0 };
    acc.spend += r.spend; acc.impressions += r.impressions; acc.clicks += r.clicks; acc.cv += cv;
    dayTotals.set(r.date, acc);
    const perAd = adDay.get(r.adId) ?? new Map<string, DayTotal>();
    const cell = perAd.get(r.date) ?? { spend: 0, impressions: 0, clicks: 0, cv: 0 };
    cell.spend += r.spend; cell.impressions += r.impressions; cell.clicks += r.clicks; cell.cv += cv;
    perAd.set(r.date, cell);
    adDay.set(r.adId, perAd);
  }

  const alerts: AnomalyAlert[] = [];
  const zero: DayTotal = { spend: 0, impressions: 0, clicks: 0, cv: 0 };
  const cur = dayTotals.get(targetDate) ?? zero;
  const base = (pickMetric: (t: DayTotal) => number): number | null =>
    medianOf(baselineDates.map((d) => pickMetric(dayTotals.get(d) ?? zero)));

  // ---- アカウント全体 ----
  const baseSpend = base((t) => t.spend);
  if (baseSpend != null && baseSpend >= keepLimit / 2) {
    if (cur.spend >= baseSpend * 1.5 && cur.spend - baseSpend >= keepLimit) {
      const critical = cur.spend >= baseSpend * 2;
      alerts.push({
        type: 'spend_spike', level: critical ? 'critical' : 'warn', scope: 'account',
        message: `消化が急増: ${yen(cur.spend)}（直近7日中央値 ${yen(baseSpend)} の ${pct(cur.spend, baseSpend)}）。予算設定・自動ルールの変化を確認`,
        current: cur.spend, baseline: baseSpend,
      });
    }
    if (cur.spend <= baseSpend * 0.2) {
      alerts.push({
        type: 'spend_stop', level: cur.spend === 0 ? 'critical' : 'warn', scope: 'account',
        message: cur.spend === 0
          ? `消化ゼロ: 配信が止まっている疑い（直近7日中央値 ${yen(baseSpend)}）。支払い・アカウント状態・広告ステータスを確認`
          : `消化が急減: ${yen(cur.spend)}（直近7日中央値 ${yen(baseSpend)} の ${pct(cur.spend, baseSpend)}）`,
        current: cur.spend, baseline: baseSpend,
      });
    }
  }

  const baseCv = base((t) => t.cv);
  if (group && baseCv != null && baseCv >= 1 && cur.cv === 0 && cur.spend >= keepLimit) {
    alerts.push({
      type: 'cv_zero_spend', level: cur.spend >= keepLimit * 2 ? 'critical' : 'warn', scope: 'account',
      message: `${yen(cur.spend)} 消化して${group.label}ゼロ（直近7日中央値 ${baseCv.toFixed(1)}件/日）※計測遅れの可能性あり`,
      current: cur.cv, baseline: baseCv,
    });
  }

  const baseCpaSeries = baselineDates
    .map((d) => dayTotals.get(d) ?? zero)
    .filter((t) => t.cv > 0)
    .map((t) => t.spend / t.cv);
  const baseCpa = medianOf(baseCpaSeries);
  if (baseCpa != null && baseCpaSeries.length >= 3 && cur.cv > 0) {
    const curCpa = cur.spend / cur.cv;
    if (curCpa >= baseCpa * 1.8 && cur.spend >= keepLimit) {
      alerts.push({
        type: 'cpa_spike', level: curCpa >= baseCpa * 2.5 ? 'critical' : 'warn', scope: 'account',
        message: `${group?.label ?? 'CV'}単価が急騰: ${yen(curCpa)}（直近7日中央値 ${yen(baseCpa)} の ${pct(curCpa, baseCpa)}）※計測遅れの可能性あり`,
        current: curCpa, baseline: baseCpa,
      });
    }
  }

  const baseCtr = medianOf(
    baselineDates
      .map((d) => dayTotals.get(d) ?? zero)
      .filter((t) => t.impressions >= 1000)
      .map((t) => (t.clicks / t.impressions) * 100),
  );
  if (baseCtr != null && baseCtr > 0 && cur.impressions >= 1000) {
    const curCtr = (cur.clicks / cur.impressions) * 100;
    if (curCtr <= baseCtr * 0.5) {
      alerts.push({
        type: 'ctr_drop', level: 'warn', scope: 'account',
        message: `CTRが急落: ${curCtr.toFixed(2)}%（直近7日中央値 ${baseCtr.toFixed(2)}%）。クリエイティブ疲弊・配信面の変化を確認`,
        current: curCtr, baseline: baseCtr,
      });
    }
  }

  // ---- 広告単位（ノイズを避けるため、判定対象日にまとまった消化がある広告のみ） ----
  const adAlerts: AnomalyAlert[] = [];
  for (const [adId, days] of adDay) {
    const c = days.get(targetDate);
    if (!c) continue;
    const name = adNames?.get(adId) ?? adId;
    const adBaseSpend = medianOf(baselineDates.map((d) => days.get(d)?.spend ?? 0));

    if (group && c.cv === 0 && c.spend >= keepLimit * 1.5) {
      adAlerts.push({
        type: 'cv_zero_spend', level: c.spend >= keepLimit * 3 ? 'critical' : 'warn', scope: 'ad',
        adId, adName: name,
        message: `「${name}」が ${yen(c.spend)} 消化して${group.label}ゼロ ※計測遅れの可能性あり`,
        current: c.cv, baseline: null,
      });
      continue; // 同一広告の重複アラートを避ける（CVゼロが最優先）
    }
    if (adBaseSpend != null && adBaseSpend >= keepLimit / 2 && c.spend >= adBaseSpend * 2 && c.spend >= keepLimit) {
      adAlerts.push({
        type: 'spend_spike', level: 'warn', scope: 'ad',
        adId, adName: name,
        message: `「${name}」の消化が急増: ${yen(c.spend)}（直近7日中央値 ${yen(adBaseSpend)} の ${pct(c.spend, adBaseSpend)}）`,
        current: c.spend, baseline: adBaseSpend,
      });
    }
  }
  adAlerts.sort((a, b) =>
    (a.level === b.level ? b.current - a.current : a.level === 'critical' ? -1 : 1));
  alerts.push(...adAlerts.slice(0, maxAdAlerts));

  alerts.sort((a, b) => (a.level === b.level ? 0 : a.level === 'critical' ? -1 : 1));
  return { targetDate, baselineDates, conversionLabel: group?.label ?? null, alerts };
}
