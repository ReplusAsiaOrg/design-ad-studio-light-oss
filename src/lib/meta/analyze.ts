import type { StoredAd, AccountSnapshot } from './store';

/**
 * Phase 1b: CPA正規化。
 *
 * Metaの actions には複数のCV種別が混在する（登録/リード/購入/エンゲージ…）。
 * キャンペーンが最適化している「主CV」を1つ選び、CPA = 消化 ÷ 主CV で自前計算する。
 *   - cost_per_action_type をそのまま使わず自前計算するのは、重複種別での値ブレを避け
 *     「同一CV種別どうしで比較」（runbookの鉄則）を担保するため。
 *   - 主CVは下記の優先順位（より下流＝価値の高いCVを優先）で、その広告に存在する最上位を採用。
 */

export interface ConversionGroup {
  key: 'purchase' | 'registration' | 'lead';
  label: string;
  /** この群とみなす Meta action_type（重複は最大値を採用） */
  matchTypes: string[];
}

export const CONVERSION_PRIORITY: ConversionGroup[] = [
  {
    key: 'purchase',
    label: '購入',
    matchTypes: ['offsite_conversion.fb_pixel_purchase', 'purchase', 'omni_purchase'],
  },
  {
    key: 'registration',
    label: '登録完了',
    matchTypes: [
      'offsite_complete_registration_add_meta_leads',
      'offsite_conversion.fb_pixel_complete_registration',
      'complete_registration',
      'omni_complete_registration',
    ],
  },
  {
    key: 'lead',
    label: 'リード',
    matchTypes: [
      'onsite_web_lead',
      'lead',
      'offsite_conversion.fb_pixel_lead',
      'offsite_lead_add_20_s_calls',
    ],
  },
];

export interface AnalyzedAd extends StoredAd {
  /** 採用した主CV群（無ければ null＝CVなし広告） */
  conversionKey: ConversionGroup['key'] | null;
  conversionLabel: string | null;
  cv: number;
  /** 消化 ÷ CV（CV>0のときのみ。それ以外 null） */
  cpa: number | null;
}

function pickPrimaryConversion(ad: StoredAd): { group: ConversionGroup; cv: number } | null {
  const byType = new Map(ad.actions.map((a) => [a.action_type, a.value]));
  for (const group of CONVERSION_PRIORITY) {
    let cv = 0;
    for (const t of group.matchTypes) {
      const v = byType.get(t);
      if (v && v > cv) cv = v; // 重複種別は最大値
    }
    if (cv > 0) return { group, cv };
  }
  return null;
}

export function analyzeAd(ad: StoredAd): AnalyzedAd {
  const primary = pickPrimaryConversion(ad);
  const cv = primary?.cv ?? 0;
  const cpa = cv > 0 ? Math.round((ad.spend / cv) * 10) / 10 : null;
  return {
    ...ad,
    conversionKey: primary?.group.key ?? null,
    conversionLabel: primary?.group.label ?? null,
    cv,
    cpa,
  };
}

export interface CpaRankGroup {
  client: string;
  accountId: string;
  conversionKey: ConversionGroup['key'];
  conversionLabel: string;
  ads: AnalyzedAd[];
}

/**
 * スナップショットを「同一CV種別」ごとにグループ化し、各群をCPA昇順で並べる。
 * CVなし広告（エンゲージのみ等）は除外。
 */
export function rankByCpa(snap: AccountSnapshot, minSpend = 0): CpaRankGroup[] {
  const analyzed = snap.ads.map(analyzeAd).filter((a) => a.cpa !== null && a.spend >= minSpend);
  const groups = new Map<string, CpaRankGroup>();
  for (const a of analyzed) {
    const key = a.conversionKey!;
    if (!groups.has(key)) {
      groups.set(key, {
        client: snap.client,
        accountId: snap.accountId,
        conversionKey: key,
        conversionLabel: a.conversionLabel!,
        ads: [],
      });
    }
    groups.get(key)!.ads.push(a);
  }
  for (const g of groups.values()) g.ads.sort((x, y) => (x.cpa ?? Infinity) - (y.cpa ?? Infinity));
  // 件数の多い群から
  return [...groups.values()].sort((a, b) => b.ads.length - a.ads.length);
}
