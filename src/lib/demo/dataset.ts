/**
 * デモモード用の架空データセット（化粧品ブランド「LUMINA（サンプル）」の美容液）。
 *
 * - 全て架空。実在のクライアント・アカウント・実績とは一切関係ない
 * - 乱数はシード固定（広告ID×日付でハッシュ）なので、いつ・誰が起動しても同じ数字になる
 * - 期間は「今日」を基準に相対で持つ（常に直近のデータに見える）
 * - 集計の整合性: 広告合計 = 年齢×性別セルの合計 = 配置セルの合計（別々に丸めず、セルから合計を作る）
 *
 * graph.ts（偽Graph API）と seed（DB投入）はこのモジュールだけを見る。
 */
import type { CreativeTraits } from '../genes';

export const DEMO_ACCOUNT_ID = 'act_0000000000000001';
export const DEMO_ACCOUNT_NAME = 'LUMINA（サンプル）';
export const DEMO_CLIENT_NAME = 'サンプルコスメ';
export const DEMO_CURRENCY = 'JPY';
/** 何日分の実績を持つか（今日を含む） */
export const DEMO_HISTORY_DAYS = 120;

// ---------------------------------------------------------------------------
// 決定的乱数
// ---------------------------------------------------------------------------

function hashStr(s: string): number {
  // FNV-1a 32bit
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32。seed文字列から [0,1) の擬似乱数列を作る */
function rng(seed: string): () => number {
  let a = hashStr(seed);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** min〜max の一様乱数 */
const between = (r: () => number, min: number, max: number) => min + (max - min) * r();

/**
 * 合計 total を weights の比率で整数に配分する（最大剰余法。必ず合計が一致する）。
 */
function splitInt(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const floors = raw.map(Math.floor);
  let rest = total - floors.reduce((s, v) => s + v, 0);
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; rest > 0 && k < order.length; k++, rest--) floors[order[k].i] += 1;
  return floors;
}

// ---------------------------------------------------------------------------
// 日付（アカウントのタイムゾーン = Asia/Tokyo）
// ---------------------------------------------------------------------------

/** 今日（JST）の YYYY-MM-DD */
export function demoToday(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 3600_000);
  return jst.toISOString().slice(0, 10);
}

export function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string): number {
  return Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / 86400_000);
}

/** YYYY-MM-DD → YYYYMMDD（広告名の日付接頭辞） */
const ymdCompact = (ymd: string) => ymd.replaceAll('-', '');

// ---------------------------------------------------------------------------
// マスタ: キャンペーン / 広告セット / クリエイティブ / 広告
// ---------------------------------------------------------------------------

export interface DemoCampaign { id: string; name: string }
export interface DemoAdset { id: string; name: string; campaignId: string }

/** 成果ティア（CVRの強さ）。S=勝ち筆頭 / A=勝ち / B=平均 / C=負け */
export type DemoTier = 'S' | 'A' | 'B' | 'C';

export interface DemoCreative {
  id: string;
  /** 画像ファイル名（public/demo/creatives/ 配下） */
  file: string;
  /** 名寄せ後の素材名（広告名 = YYYYMMDD_素材名） */
  material: string;
  isVideo: boolean;
  tier: DemoTier;
  /** CTR（%）の基準値。ビジュアルの引きの強さ */
  ctrPct: number;
  traits: CreativeTraits;
  /** 広告テキスト（creative-text 用） */
  text: { headline: string; primary: string; description: string };
}

export interface DemoAd {
  id: string;
  name: string;
  campaignId: string;
  adsetId: string;
  creativeId: string;
  status: 'ACTIVE' | 'PAUSED';
  effectiveStatus: 'ACTIVE' | 'PAUSED';
  /** 配信開始日（YYYY-MM-DD） */
  start: string;
  /** 配信終了日（含む）。null なら配信中 */
  end: string | null;
  /** 1日あたりの基準消化額（円） */
  dailySpend: number;
}

export const DEMO_CAMPAIGNS: DemoCampaign[] = [
  { id: '120000000000000101', name: '【購入】LUMINA美容液_ブロード配信' },
  { id: '120000000000000102', name: '【購入】LUMINA美容液_リターゲティング' },
  { id: '120000000000000103', name: '【購入】LUMINA美容液_類似オーディエンス' },
];

export const DEMO_ADSETS: DemoAdset[] = [
  { id: '120000000000000201', name: 'ブロード_女性25-54', campaignId: '120000000000000101' },
  { id: '120000000000000202', name: 'ブロード_Advantage+オーディエンス', campaignId: '120000000000000101' },
  { id: '120000000000000203', name: 'RT_サイト訪問30日', campaignId: '120000000000000102' },
  { id: '120000000000000204', name: 'LAL1%_購入者', campaignId: '120000000000000103' },
  { id: '120000000000000205', name: 'LAL3%_購入者', campaignId: '120000000000000103' },
];

const T = (t: Omit<CreativeTraits, 'schemaVersion'>): CreativeTraits => ({ schemaVersion: 1, ...t });

export const DEMO_CREATIVES: DemoCreative[] = [
  {
    id: '120000000000000301', file: 'cr01.jpg', material: '口コミ_30代体験談', isVideo: false, tier: 'S', ctrPct: 1.9,
    traits: T({ hooks: ['testimonial', 'before_after'], impression: 'friendly', visualFocus: 'person_face', palette: 'soft', composition: 'headline_top', textAmount: 'accent', hasCta: true, language: 'ja' }),
    text: { headline: '「朝の肌が違う」30代の声', primary: '乾燥・くすみが気になり始めた30代へ。LUMINA美容液を28日間使った方の92%が「ハリを実感」。まずは初回限定価格でお試しください。', description: '初回限定 50%OFF・送料無料' },
  },
  {
    id: '120000000000000302', file: 'cr02.jpg', material: '実績_満足度98%', isVideo: false, tier: 'A', ctrPct: 1.4,
    traits: T({ hooks: ['results'], impression: 'trust', visualFocus: 'product_shot', palette: 'soft', composition: 'center_hero', textAmount: 'accent', hasCta: true, language: 'ja' }),
    text: { headline: '満足度98%※の美容液', primary: '累計販売50万本突破。ナイアシンアミド配合の高保湿美容液 LUMINA。※2026年自社調査 n=1,203', description: '今なら初回50%OFF' },
  },
  {
    id: '120000000000000303', file: 'cr03.jpg', material: '限定_初回半額', isVideo: false, tier: 'A', ctrPct: 2.1,
    traits: T({ hooks: ['discount', 'limited'], impression: 'elegant', visualFocus: 'product_shot', palette: 'warm', composition: 'split_lr', textAmount: 'accent', hasCta: true, language: 'ja' }),
    text: { headline: '初回半額は今月まで', primary: '【期間限定】LUMINA美容液が初回50%OFF。定期縛りなし・いつでも解約OK。', description: '送料無料・返金保証つき' },
  },
  {
    id: '120000000000000304', file: 'cr04.jpg', material: '悩み共感_乾燥小じわ', isVideo: false, tier: 'B', ctrPct: 1.6,
    traits: T({ hooks: ['empathy'], impression: 'friendly', visualFocus: 'person_face', palette: 'soft', composition: 'headline_top', textAmount: 'accent', hasCta: false, language: 'ja' }),
    text: { headline: '目元の乾燥小じわ、あきらめていませんか', primary: 'マスク生活で増えた乾燥小じわ。LUMINA美容液は角層まで潤いを届けて、ふっくらしたハリ肌へ。', description: '初回限定価格でお試し' },
  },
  {
    id: '120000000000000305', file: 'cr05.jpg', material: '成分_ナイアシンアミド解説', isVideo: false, tier: 'C', ctrPct: 0.9,
    traits: T({ hooks: ['know_how'], impression: 'trust', visualFocus: 'text_design', palette: 'cool', composition: 'multi_block', textAmount: 'heavy', hasCta: false, language: 'ja' }),
    text: { headline: 'ナイアシンアミドとは？', primary: '美容成分ナイアシンアミドの働きを解説。LUMINA美容液は有効成分を高濃度で配合しました。', description: '成分表を見る' },
  },
  {
    id: '120000000000000306', file: 'cr06.jpg', material: '商品カット_高級感', isVideo: false, tier: 'C', ctrPct: 0.8,
    traits: T({ hooks: ['results'], impression: 'elegant', visualFocus: 'product_shot', palette: 'high_contrast', composition: 'center_hero', textAmount: 'none', hasCta: false, language: 'ja' }),
    text: { headline: 'LUMINA 美容液', primary: '上質なうるおいを、毎日の肌に。', description: '公式サイト' },
  },
  {
    id: '120000000000000307', file: 'cr07.jpg', material: '比較_他社との違い', isVideo: false, tier: 'B', ctrPct: 1.5,
    traits: T({ hooks: ['results', 'know_how'], impression: 'trust', visualFocus: 'comparison', palette: 'high_contrast', composition: 'split_lr', textAmount: 'heavy', hasCta: true, language: 'ja' }),
    text: { headline: '一般的な美容液との違い', primary: '保湿成分の量・浸透設計・価格。LUMINA美容液が選ばれる3つの理由。', description: '比較表を見る' },
  },
  {
    id: '120000000000000308', file: 'cr08.jpg', material: '意外性_夜だけケア', isVideo: false, tier: 'S', ctrPct: 2.3,
    traits: T({ hooks: ['surprise', 'know_how'], impression: 'lively', visualFocus: 'person_scene', palette: 'warm', composition: 'full_photo', textAmount: 'accent', hasCta: true, language: 'ja' }),
    text: { headline: '実は「夜1回」で十分でした', primary: '忙しい毎日でも続く、夜だけの1ステップケア。LUMINA美容液は寝ている間にじっくり浸透。', description: '初回50%OFFで試す' },
  },
  {
    id: '120000000000000309', file: 'cr09.jpg', material: '口コミ_40代', isVideo: false, tier: 'B', ctrPct: 1.5,
    traits: T({ hooks: ['testimonial'], impression: 'friendly', visualFocus: 'person_face', palette: 'warm', composition: 'headline_top', textAmount: 'accent', hasCta: true, language: 'ja' }),
    text: { headline: '「40代でも遅くなかった」', primary: '年齢とともに気になるハリ不足。LUMINA美容液を使い始めた40代の方の声を集めました。', description: '体験談を読む' },
  },
  {
    id: '120000000000000310', file: 'cr10.jpg', material: '割引_定期便20%OFF', isVideo: false, tier: 'C', ctrPct: 1.2,
    traits: T({ hooks: ['discount'], impression: 'lively', visualFocus: 'product_shot', palette: 'colorful', composition: 'multi_block', textAmount: 'heavy', hasCta: true, language: 'ja' }),
    text: { headline: '定期便ならずっと20%OFF', primary: 'LUMINA美容液の定期便が新登場。毎回20%OFF・送料無料・お届け周期は自由に変更できます。', description: '定期便を申し込む' },
  },
  {
    id: '120000000000000311', file: 'cr11.jpg', material: 'ビフォーアフター_28日', isVideo: false, tier: 'S', ctrPct: 2.0,
    traits: T({ hooks: ['before_after', 'results'], impression: 'trust', visualFocus: 'comparison', palette: 'high_contrast', composition: 'split_lr', textAmount: 'accent', hasCta: true, language: 'ja' }),
    text: { headline: '28日後の肌を見てください', primary: '使用前と28日後の比較※。LUMINA美容液で角層のうるおいを満たし、キメの整った肌へ。※個人の感想です', description: '初回限定価格はこちら' },
  },
  {
    id: '120000000000000312', file: 'cr12.jpg', material: 'イラスト漫画_悩み', isVideo: false, tier: 'B', ctrPct: 1.7,
    traits: T({ hooks: ['empathy', 'know_how'], impression: 'friendly', visualFocus: 'illustration', palette: 'soft', composition: 'multi_block', textAmount: 'heavy', hasCta: false, language: 'ja' }),
    text: { headline: '「何を塗っても乾く」の正体', primary: '保湿しても乾くのは、角層のうるおいを抱え込む力が落ちているから。漫画でわかるLUMINA美容液。', description: '続きを読む' },
  },
  {
    id: '120000000000000313', file: 'cr13.jpg', material: '動画_使用シーン15秒', isVideo: true, tier: 'S', ctrPct: 2.2,
    traits: T({ hooks: ['know_how', 'empathy'], impression: 'friendly', visualFocus: 'person_scene', palette: 'soft', composition: 'full_photo', textAmount: 'accent', hasCta: true, language: 'ja' }),
    text: { headline: '朝晩1プッシュの新習慣', primary: 'テクスチャーはとろみのある美容液。伸びがよく、べたつかない。15秒でわかる使い方。', description: '初回50%OFF' },
  },
  {
    id: '120000000000000314', file: 'cr14.jpg', material: '動画_口コミインタビュー', isVideo: true, tier: 'A', ctrPct: 1.8,
    traits: T({ hooks: ['testimonial'], impression: 'trust', visualFocus: 'person_face', palette: 'soft', composition: 'center_hero', textAmount: 'accent', hasCta: true, language: 'ja' }),
    text: { headline: '愛用者インタビュー', primary: 'LUMINA美容液を1年使い続けている方に、正直な感想を聞きました。', description: 'インタビューを見る' },
  },
  {
    id: '120000000000000315', file: 'cr15.jpg', material: '動画_成分解説', isVideo: true, tier: 'C', ctrPct: 1.0,
    traits: T({ hooks: ['know_how'], impression: 'trust', visualFocus: 'text_design', palette: 'cool', composition: 'multi_block', textAmount: 'heavy', hasCta: false, language: 'ja' }),
    text: { headline: '研究員が語る処方のこだわり', primary: 'LUMINA美容液の処方設計を、開発担当が60秒で解説します。', description: '詳しく見る' },
  },
  {
    id: '120000000000000316', file: 'cr16.jpg', material: '動画_ビフォーアフター', isVideo: true, tier: 'A', ctrPct: 1.9,
    traits: T({ hooks: ['before_after'], impression: 'trust', visualFocus: 'comparison', palette: 'high_contrast', composition: 'split_lr', textAmount: 'accent', hasCta: true, language: 'ja' }),
    text: { headline: 'うるおいの差、見えますか', primary: '使用前後の肌の様子を動画で。LUMINA美容液の保湿力をご覧ください。※個人の感想です', description: '初回限定価格はこちら' },
  },
];

const creativeById = new Map(DEMO_CREATIVES.map((c) => [c.id, c]));
export const demoCreative = (id: string) => creativeById.get(id);

/**
 * 広告の定義（相対日付）。startAgo/endAgo は「今日から何日前」。
 * 名寄せ（YYYYMMDD_素材名）が効くよう、同じ素材を別セットで使い回す広告も入れてある。
 */
interface AdSpec { creative: number; adset: number; startAgo: number; endAgo: number | null; dailySpend: number; /** 同一素材の横展開マーク（表示には使わない） */ suffix?: string }
const AD_SPECS: AdSpec[] = [
  // ---- 初期ローンチ（〜110日前）。一部は成果不振で停止済み ----
  { creative: 1, adset: 1, startAgo: 112, endAgo: null, dailySpend: 26000 },
  { creative: 2, adset: 1, startAgo: 112, endAgo: null, dailySpend: 14000 },
  { creative: 5, adset: 1, startAgo: 112, endAgo: 61, dailySpend: 9000 },
  { creative: 6, adset: 1, startAgo: 112, endAgo: 75, dailySpend: 8000 },
  { creative: 4, adset: 2, startAgo: 105, endAgo: null, dailySpend: 12000 },
  { creative: 3, adset: 3, startAgo: 105, endAgo: null, dailySpend: 15000 },
  { creative: 13, adset: 2, startAgo: 98, endAgo: null, dailySpend: 22000 },
  { creative: 10, adset: 3, startAgo: 98, endAgo: 40, dailySpend: 7000 },
  // ---- 2ヶ月前の追加テスト ----
  { creative: 7, adset: 2, startAgo: 66, endAgo: null, dailySpend: 9000 },
  { creative: 8, adset: 2, startAgo: 66, endAgo: null, dailySpend: 24000 },
  { creative: 9, adset: 4, startAgo: 60, endAgo: null, dailySpend: 8000 },
  { creative: 11, adset: 4, startAgo: 60, endAgo: null, dailySpend: 20000 },
  { creative: 14, adset: 4, startAgo: 55, endAgo: null, dailySpend: 11000 },
  { creative: 15, adset: 5, startAgo: 55, endAgo: 22, dailySpend: 6000 },
  { creative: 12, adset: 5, startAgo: 48, endAgo: null, dailySpend: 7000 },
  { creative: 16, adset: 5, startAgo: 48, endAgo: null, dailySpend: 12000 },
  // ---- 勝ちCRの横展開（同じ素材を別セットへ＝名寄せで統合される） ----
  { creative: 1, adset: 4, startAgo: 34, endAgo: null, dailySpend: 16000, suffix: 'B' },
  { creative: 8, adset: 4, startAgo: 34, endAgo: null, dailySpend: 15000, suffix: 'B' },
  { creative: 11, adset: 2, startAgo: 27, endAgo: null, dailySpend: 13000, suffix: 'B' },
  { creative: 13, adset: 3, startAgo: 27, endAgo: null, dailySpend: 12000, suffix: 'B' },
  // ---- 直近の新規テスト（データ不足＝判定不可になる想定） ----
  { creative: 3, adset: 5, startAgo: 6, endAgo: null, dailySpend: 5000, suffix: 'B' },
  { creative: 9, adset: 2, startAgo: 4, endAgo: null, dailySpend: 4000, suffix: 'B' },
];

let adsCache: { today: string; ads: DemoAd[] } | null = null;

/** 広告一覧（今日を基準に日付を解決。日付が変わったら作り直す） */
export function demoAds(): DemoAd[] {
  const today = demoToday();
  if (adsCache && adsCache.today === today) return adsCache.ads;
  const ads: DemoAd[] = AD_SPECS.map((s, i) => {
    const cr = DEMO_CREATIVES[s.creative - 1];
    const adset = DEMO_ADSETS[s.adset - 1];
    const start = addDays(today, -s.startAgo);
    const end = s.endAgo == null ? null : addDays(today, -s.endAgo);
    // suffix は広告IDの区別用のみ。広告名は同じ素材名にして名寄せ（YYYYMMDD_素材名 → 素材名）で統合されるようにする
    const material = cr.material;
    const status = end ? 'PAUSED' : 'ACTIVE';
    return {
      id: `120000000000000${String(401 + i).padStart(3, '0')}`,
      name: `${ymdCompact(start)}_${material}`,
      campaignId: adset.campaignId,
      adsetId: adset.id,
      creativeId: cr.id,
      status,
      effectiveStatus: status,
      start,
      end,
      dailySpend: s.dailySpend,
    };
  });
  adsCache = { today, ads };
  return ads;
}

// ---------------------------------------------------------------------------
// 実績生成（広告×日 → 年齢×性別セル / 配置セル）
// ---------------------------------------------------------------------------

export const AGES = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'] as const;
export const GENDERS = ['female', 'male', 'unknown'] as const;

/** 年齢×性別の配信比率（女性35-54が主戦場） */
const AG_WEIGHT: Record<string, number> = {
  '18-24・female': 0.04, '25-34・female': 0.13, '35-44・female': 0.24, '45-54・female': 0.23, '55-64・female': 0.12, '65+・female': 0.05,
  '18-24・male': 0.01, '25-34・male': 0.03, '35-44・male': 0.04, '45-54・male': 0.04, '55-64・male': 0.02, '65+・male': 0.01,
  '18-24・unknown': 0.005, '25-34・unknown': 0.01, '35-44・unknown': 0.01, '45-54・unknown': 0.01, '55-64・unknown': 0.005, '65+・unknown': 0.005,
};
/** 年齢×性別のCVR倍率（45-54女性が勝ちセグメント。男性・若年は弱い） */
const AG_CVR: Record<string, number> = {
  '18-24・female': 0.5, '25-34・female': 0.85, '35-44・female': 1.15, '45-54・female': 1.4, '55-64・female': 1.2, '65+・female': 0.9,
  '18-24・male': 0.2, '25-34・male': 0.35, '35-44・male': 0.45, '45-54・male': 0.5, '55-64・male': 0.45, '65+・male': 0.3,
  '18-24・unknown': 0.4, '25-34・unknown': 0.6, '35-44・unknown': 0.7, '45-54・unknown': 0.7, '55-64・unknown': 0.6, '65+・unknown': 0.5,
};

export interface DemoPlacement { platform: string; position: string; weight: number; cvr: number }
export const PLACEMENTS: DemoPlacement[] = [
  { platform: 'instagram', position: 'feed', weight: 0.30, cvr: 1.25 },
  { platform: 'instagram', position: 'instagram_stories', weight: 0.20, cvr: 1.1 },
  { platform: 'instagram', position: 'instagram_reels', weight: 0.15, cvr: 0.9 },
  { platform: 'facebook', position: 'feed', weight: 0.18, cvr: 1.0 },
  { platform: 'facebook', position: 'facebook_reels', weight: 0.05, cvr: 0.6 },
  { platform: 'instagram', position: 'instagram_explore', weight: 0.04, cvr: 0.7 },
  { platform: 'audience_network', position: 'an_classic', weight: 0.05, cvr: 0.25 },
  { platform: 'messenger', position: 'messenger_inbox', weight: 0.03, cvr: 0.4 },
];

const TIER_CVR: Record<DemoTier, number> = { S: 1.15, A: 0.85, B: 0.55, C: 0.28 }; // クリック→購入（%）。既定の報酬単価1万円で S=★★★ 〜 C=損切り に散る

/** 1セル分の実績 */
export interface DemoCell { spend: number; impressions: number; clicks: number; cv: number }

export interface DemoAdDay {
  adId: string;
  date: string;
  total: DemoCell;
  /** key: 'age・gender' */
  ageGender: Record<string, DemoCell>;
  /** key: 'platform/position' */
  placement: Record<string, DemoCell>;
}

const dayCache = new Map<string, DemoAdDay | null>();

/** 広告×日の実績。配信期間外は null */
export function demoAdDay(ad: DemoAd, date: string): DemoAdDay | null {
  const key = `${ad.id}|${date}`;
  const hit = dayCache.get(key);
  if (hit !== undefined) return hit;

  const today = demoToday();
  const dayIdx = diffDays(ad.start, date);
  const inRange = dayIdx >= 0 && date <= today && (ad.end == null || date <= ad.end);
  if (!inRange) { dayCache.set(key, null); return null; }

  const cr = demoCreative(ad.creativeId)!;
  const r = rng(`${ad.id}:${date}`);

  // 消化額: 基準 × 曜日（週末やや強い）× 立ち上がり（3日でフル）× ノイズ × 今日は途中集計
  const dow = new Date(date + 'T00:00:00Z').getUTCDay();
  const dowFactor = dow === 0 || dow === 6 ? 1.12 : dow === 3 ? 0.95 : 1.0;
  const ramp = Math.min(1, (dayIdx + 1) / 3);
  const partial = date === today ? 0.45 : 1;
  const spend = Math.round(ad.dailySpend * dowFactor * ramp * between(r, 0.78, 1.22) * partial);

  const cpm = between(r, 880, 1180);
  const impressions = Math.round((spend / cpm) * 1000);
  const ctr = (cr.ctrPct / 100) * between(r, 0.85, 1.15);
  const cvrBase = (TIER_CVR[cr.tier] / 100) * between(r, 0.8, 1.2);

  // ---- 年齢×性別セル（ここから合計を作る） ----
  const agKeys = Object.keys(AG_WEIGHT);
  const agW = agKeys.map((k) => AG_WEIGHT[k] * between(r, 0.85, 1.15));
  const agImp = splitInt(impressions, agW);
  const agSpend = splitInt(spend, agW);
  const ageGender: Record<string, DemoCell> = {};
  let tClicks = 0, tCv = 0;
  agKeys.forEach((k, i) => {
    const c = Math.round(agImp[i] * ctr * between(r, 0.8, 1.2));
    const expectCv = c * cvrBase * AG_CVR[k];
    // 期待値を確率的に丸める（小さいセルは0か1になる）
    const cv = Math.floor(expectCv) + (r() < expectCv - Math.floor(expectCv) ? 1 : 0);
    ageGender[k] = { spend: agSpend[i], impressions: agImp[i], clicks: c, cv };
    tClicks += c; tCv += cv;
  });
  const total: DemoCell = { spend, impressions, clicks: tClicks, cv: tCv };

  // ---- 配置セル（同じ合計を別の比率で配分） ----
  const plKeys = PLACEMENTS.map((p) => `${p.platform}/${p.position}`);
  const plW = PLACEMENTS.map((p) => p.weight * between(r, 0.85, 1.15));
  const plImp = splitInt(impressions, plW);
  const plSpend = splitInt(spend, plW);
  const plClicks = splitInt(tClicks, plW.map((w, i) => w * between(r, 0.9, 1.1) * (PLACEMENTS[i].cvr > 1 ? 1.05 : 0.95)));
  // CVは件数が少ないので比率配分だと弱い配置が常に0になる → 1件ずつ重み付き抽選で配る（合計は必ず一致）
  const cvW = plW.map((w, i) => w * PLACEMENTS[i].cvr);
  const cvWSum = cvW.reduce((a, b) => a + b, 0);
  const plCv = PLACEMENTS.map(() => 0);
  for (let n = 0; n < tCv; n++) {
    let x = r() * cvWSum;
    let idx = 0;
    while (idx < cvW.length - 1 && x >= cvW[idx]) { x -= cvW[idx]; idx++; }
    plCv[idx] += 1;
  }
  const placement: Record<string, DemoCell> = {};
  plKeys.forEach((k, i) => {
    placement[k] = { spend: plSpend[i], impressions: plImp[i], clicks: plClicks[i], cv: plCv[i] };
  });

  const out: DemoAdDay = { adId: ad.id, date, total, ageGender, placement };
  dayCache.set(key, out);
  return out;
}

/** 期間内の全 広告×日 を列挙 */
export function demoAdDays(since: string, until: string, adIds?: Set<string>): DemoAdDay[] {
  const out: DemoAdDay[] = [];
  for (const ad of demoAds()) {
    if (adIds && !adIds.has(ad.id)) continue;
    const from = since > ad.start ? since : ad.start;
    const to = ad.end && ad.end < until ? ad.end : until;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const row = demoAdDay(ad, d);
      if (row) out.push(row);
    }
  }
  return out;
}

/** データが存在する最古の日付 */
export function demoEarliestDate(): string {
  return demoAds().reduce((m, a) => (a.start < m ? a.start : m), demoToday());
}

/** CreativeTraits キャッシュ用（vision分類の代わりに投入する） */
export function demoGeneRecords(): { creativeId: string; genes: CreativeTraits; isVideo: boolean; imageUrl: string }[] {
  return DEMO_CREATIVES.map((c) => ({
    creativeId: c.id,
    genes: c.traits,
    isVideo: c.isVideo,
    imageUrl: demoImageUrl(c),
  }));
}

/** クリエイティブ画像のURL（アプリ配信の public/demo/creatives/）。 */
export function demoImageUrl(c: DemoCreative): string {
  return `/demo/creatives/${c.file}`;
}
