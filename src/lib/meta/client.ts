/**
 * Meta Graph API クライアント（ライト版）
 *
 *   - Graph API v25.0 を直接叩く（PoYo等の中継なし）
 *   - access_token は環境変数 META_ACCESS_TOKEN（.env.local／1Password管理）
 *   - paging.next を辿って全件取得
 *
 * 用途: 対象アカウントの広告(ad)単位インサイトとクリエイティブ実体を取得し、
 *       ローカルに保存 → 勝ちパターン分析の土台にする。
 */

import { isDemoMode } from '../demo/mode';
import { demoGraphGet, demoGraphGetAll, DemoGraphError } from '../demo/graph';

const GRAPH_VERSION = 'v25.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export class MetaGraphError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: number,
    public readonly type?: string,
  ) {
    super(message);
    this.name = 'MetaGraphError';
  }
}

function getToken(): string {
  const t = process.env.META_ACCESS_TOKEN;
  if (!t) throw new MetaGraphError('META_ACCESS_TOKEN is not set', 0);
  return t;
}

/** デモモードの迂回（偽Graph APIの例外を MetaGraphError に揃える） */
async function demoGet<T>(path: string, params: Record<string, string>): Promise<T> {
  try {
    return await demoGraphGet<T>(path, params);
  } catch (e) {
    if (e instanceof DemoGraphError) throw new MetaGraphError(e.message, e.status, e.code, 'OAuthException');
    throw e;
  }
}
async function demoGetAll<T>(path: string, params: Record<string, string>): Promise<T[]> {
  try {
    return await demoGraphGetAll<T>(path, params);
  } catch (e) {
    if (e instanceof DemoGraphError) throw new MetaGraphError(e.message, e.status, e.code, 'OAuthException');
    throw e;
  }
}

/** 単発GET。失敗時は MetaGraphError を投げる。 */
async function metaGet<T = unknown>(
  path: string,
  params: Record<string, string> = {},
): Promise<T> {
  // デモモード: 実APIを叩かず偽Graph API（架空データ）に迂回する
  if (isDemoMode()) return demoGet<T>(path, params);
  const url = new URL(`${GRAPH_BASE}/${path}`);
  url.search = new URLSearchParams({ ...params, access_token: getToken() }).toString();

  const res = await fetch(url.toString());
  const json = await res.json();
  if (!res.ok || json?.error) {
    const e = json?.error ?? {};
    throw new MetaGraphError(
      e.message ?? `Meta API error (HTTP ${res.status})`,
      res.status,
      e.code,
      e.type,
    );
  }
  return json as T;
}

/** paging.next を辿って data[] を全件集める。 */
async function metaGetAll<T = unknown>(
  path: string,
  params: Record<string, string> = {},
): Promise<T[]> {
  type Page = { data?: T[]; paging?: { next?: string }; error?: unknown };
  if (isDemoMode()) return demoGetAll<T>(path, params);
  const out: T[] = [];
  const first = await metaGet<Page>(path, {
    ...params,
    limit: params.limit ?? '200',
  });
  out.push(...(first.data ?? []));
  // next は完全URL（access_token込み）。そのまま叩く。
  // 途中ページの失敗は「部分データを全件として返す」事故になるため、黙殺せず必ず投げる。
  const MAX_PAGES = 50;
  let next = first.paging?.next;
  let guard = 0;
  while (next) {
    if (guard >= MAX_PAGES) {
      throw new MetaGraphError(
        `ページネーションが${MAX_PAGES}ページ（約${MAX_PAGES * 200}件）を超えました。期間や対象を絞ってください: ${path}`,
        0,
      );
    }
    const res = await fetch(next);
    const page = (await res.json().catch(() => ({}))) as Page & { error?: { message?: string; code?: number; type?: string } };
    if (!res.ok || page.error) {
      const e = page.error ?? {};
      throw new MetaGraphError(
        `ページネーション${guard + 2}ページ目で失敗: ${e.message ?? `HTTP ${res.status}`}`,
        res.status,
        e.code,
        e.type,
      );
    }
    out.push(...(page.data ?? []));
    next = page.paging?.next;
    guard++;
  }
  return out;
}

export interface MetaAccountInfo {
  id: string;
  name: string;
  account_status: number;
  currency: string;
}

export async function fetchAccount(accountId: string): Promise<MetaAccountInfo> {
  return metaGet<MetaAccountInfo>(accountId, {
    fields: 'name,account_status,currency',
  });
}

export interface MetaAvailableAccount {
  /** act_ 付きのアカウントID */
  id: string;
  name?: string;
  account_status?: number;
  currency?: string;
  /** 累計消化金額（通貨最小単位の文字列）。厳選時の規模感の目安に使う。 */
  amount_spent?: string;
  business?: { id?: string; name?: string };
}

/**
 * トークン（システムユーザー）に割り当てられた全広告アカウントを取得。
 * 管理画面の「追加候補一覧」に使う。
 */
export async function fetchAvailableAdAccounts(): Promise<MetaAvailableAccount[]> {
  try {
    return await metaGetAll<MetaAvailableAccount>('me/adaccounts', {
      fields: 'name,account_status,currency,amount_spent,business{id,name}',
    });
  } catch (e) {
    // business{} フィールドは business_management 権限が必要で、読み取り専用トークン
    // （ads_read のみ）だと (#100) で一覧ごと失敗する。ビジネス名は表示用の飾りなので
    // 権限が無い場合は business なしで再試行する
    if (e instanceof MetaGraphError && (e.code === 100 || /business_management/i.test(e.message))) {
      return metaGetAll<MetaAvailableAccount>('me/adaccounts', {
        fields: 'name,account_status,currency,amount_spent',
      });
    }
    throw e;
  }
}

export interface MetaInsightRow {
  ad_id?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  actions?: { action_type: string; value: string }[];
  cost_per_action_type?: { action_type: string; value: string }[];
  date_start?: string;
  date_stop?: string;
}

/**
 * ad単位のインサイトを取得（既定: 全期間 maximum）。
 * CV/CPAは action_type ごとに actions / cost_per_action_type に入る（キャンペーンで最適化対象が違う）。
 */
export async function fetchAdInsights(
  accountId: string,
  opts: { datePreset?: string } = {},
): Promise<MetaInsightRow[]> {
  return metaGetAll<MetaInsightRow>(`${accountId}/insights`, {
    level: 'ad',
    date_preset: opts.datePreset ?? 'maximum',
    fields:
      'ad_id,spend,impressions,reach,clicks,ctr,cpc,actions,cost_per_action_type',
  });
}

/**
 * ad×日のインサイト（time_increment=1）。日次同期（fact_ad_daily）用。
 * reach は日次値（日をまたぐ合算不可）として保存側で扱う。
 */
export async function fetchAdInsightsDaily(
  accountId: string,
  range: { since: string; until: string },
): Promise<MetaInsightRow[]> {
  return metaGetAll<MetaInsightRow>(`${accountId}/insights`, {
    level: 'ad',
    time_range: JSON.stringify({ since: range.since, until: range.until }),
    time_increment: '1',
    fields: 'ad_id,spend,impressions,reach,clicks,actions',
  });
}

/** time_range の指定。since/until（カスタム）または datePreset のどちらかを使う。 */
export interface InsightTimeRange {
  /** Meta の date_preset（today/yesterday/last_7d/last_14d/last_30d/this_month/last_month/maximum 等） */
  datePreset?: string;
  /** カスタム期間（YYYY-MM-DD）。指定時は datePreset より優先。 */
  since?: string;
  until?: string;
}

/** breakdowns 付きインサイトの行（媒体・配置・階層の次元が動的に乗る）。 */
export interface MetaBreakdownRow extends MetaInsightRow {
  publisher_platform?: string;
  platform_position?: string;
  age?: string;
  gender?: string;
  campaign_id?: string;
  adset_id?: string;
}

function timeParams(range: InsightTimeRange): Record<string, string> {
  if (range.since && range.until) {
    return { time_range: JSON.stringify({ since: range.since, until: range.until }) };
  }
  return { date_preset: range.datePreset ?? 'last_30d' };
}

/** Insights の filtering 条件（campaign.id IN [...] 等）。breakdowns 併用時もMeta側で効く。 */
export interface MetaInsightsFilter { field: string; operator: 'IN'; value: string[] }

/**
 * 汎用インサイト取得。期間・粒度(level)・breakdowns を指定できる。
 *   - level: 'ad' | 'campaign' | 'adset' | 'account'（省略時は account 集計）
 *   - breakdowns: ['publisher_platform'] / ['platform_position'] 等
 */
export async function fetchInsights(
  accountId: string,
  opts: {
    range: InsightTimeRange;
    level?: 'ad' | 'campaign' | 'adset' | 'account';
    breakdowns?: string[];
    fields?: string;
    /** 1 で日次の時系列（date_start/date_stop 付きの行が日ごとに返る）。 */
    timeIncrement?: number;
    /** キャンペーン/広告セット等での絞り込み。 */
    filtering?: MetaInsightsFilter[];
  },
): Promise<MetaBreakdownRow[]> {
  const { level, breakdowns, timeIncrement, filtering } = opts;
  return metaGetAll<MetaBreakdownRow>(`${accountId}/insights`, {
    ...timeParams(opts.range),
    fields: opts.fields ?? 'ad_id,campaign_id,adset_id,spend,impressions,clicks,ctr,cpc,actions,cost_per_action_type',
    ...(level ? { level } : {}),
    ...(breakdowns?.length ? { breakdowns: breakdowns.join(',') } : {}),
    ...(timeIncrement ? { time_increment: String(timeIncrement) } : {}),
    ...(filtering?.length ? { filtering: JSON.stringify(filtering) } : {}),
  });
}

export interface MetaNamedEntity { id: string; name?: string }

/** campaign_id → name を引くための一覧取得。 */
export async function fetchCampaigns(accountId: string): Promise<MetaNamedEntity[]> {
  return metaGetAll<MetaNamedEntity>(`${accountId}/campaigns`, { fields: 'id,name' });
}

export interface MetaAdsetEntity extends MetaNamedEntity { campaign_id?: string }

/** adset_id → name を引くための一覧取得（絞り込みUI用に所属キャンペーンも返す）。 */
export async function fetchAdsets(accountId: string): Promise<MetaAdsetEntity[]> {
  return metaGetAll<MetaAdsetEntity>(`${accountId}/adsets`, { fields: 'id,name,campaign_id' });
}

export interface MetaAdEntity {
  id: string;
  name?: string;
  status?: string;
  effective_status?: string;
  campaign_id?: string;
  adset_id?: string;
  creative?: { id?: string };
}

/** アカウント配下の全ad（メタ情報＋creative_id）を取得。 */
export async function fetchAds(accountId: string): Promise<MetaAdEntity[]> {
  return metaGetAll<MetaAdEntity>(`${accountId}/ads`, {
    fields: 'id,name,status,effective_status,campaign_id,adset_id,creative{id}',
  });
}

export interface MetaCreative {
  id: string;
  object_type?: string;
  image_url?: string;
  thumbnail_url?: string;
  video_id?: string;
  /** 投稿動画の実体ID。再生用ソースはこちら（トップ video_id は権限制限で取れないことがある）。 */
  object_story_spec?: { video_data?: { video_id?: string } };
}

/** creative実体（画像URL/動画ID/種別）を取得。画像CRのみ image_url が返る。 */
export async function fetchCreatives(creativeIds: string[]): Promise<Record<string, MetaCreative>> {
  const out: Record<string, MetaCreative> = {};
  // ids 一括取得（?ids=a,b,c）。多い時は分割。
  const chunkSize = 50;
  for (let i = 0; i < creativeIds.length; i += chunkSize) {
    const chunk = creativeIds.slice(i, i + chunkSize).filter(Boolean);
    if (chunk.length === 0) continue;
    const json = await metaGet<Record<string, MetaCreative>>('', {
      ids: chunk.join(','),
      fields: 'object_type,image_url,thumbnail_url,video_id,object_story_spec{video_data{video_id}}',
      // 指定しないと動画CRのthumbnail_urlが64x64で返り、ギャラリーでボケた塊/空白に見える
      thumbnail_width: '512',
      thumbnail_height: '512',
    });
    Object.assign(out, json);
  }
  return out;
}

/** creative から再生用の動画ID（object_story_spec 優先）を取り出す。 */
export function playableVideoId(c: MetaCreative | undefined): string | undefined {
  return c?.object_story_spec?.video_data?.video_id || c?.video_id;
}

/** 動画ID → 再生用ソースURL/permalink。失効・権限不足時は空で返す（投げない）。 */
export async function fetchVideoSource(videoId: string): Promise<{ source?: string; permalink?: string }> {
  try {
    const v = await metaGet<{ source?: string; permalink_url?: string }>(videoId, {
      fields: 'source,permalink_url',
    });
    return { source: v.source, permalink: v.permalink_url };
  } catch {
    return {};
  }
}

/** 広告テキスト（本文/見出し/説明/CTA/リンク）。Advantage+はテキスト違いが配列で入る。 */
export interface AdText {
  primaryTexts: string[];
  headlines: string[];
  descriptions: string[];
  cta?: string;
  link?: string;
}

interface CreativeTextRaw {
  title?: string;
  body?: string;
  object_story_spec?: {
    link_data?: { message?: string; name?: string; description?: string; link?: string; call_to_action?: { type?: string; value?: { link?: string } } };
    video_data?: { message?: string; title?: string; link_description?: string; call_to_action?: { type?: string; value?: { link?: string } } };
  };
  asset_feed_spec?: {
    bodies?: { text?: string }[];
    titles?: { text?: string }[];
    descriptions?: { text?: string }[];
    call_to_action_types?: string[];
    link_urls?: { website_url?: string }[];
  };
}

function uniqTexts(arr: (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    const t = (s ?? '').trim();
    if (t && !seen.has(t)) { seen.add(t); out.push(t); }
  }
  return out;
}

/** creativeId → 広告テキスト。Advantage+（asset_feed_spec）のテキスト違いを配列で返す。 */
export async function fetchCreativeText(creativeId: string): Promise<AdText> {
  const c = await metaGet<CreativeTextRaw>(creativeId, {
    fields: 'title,body,object_story_spec,asset_feed_spec',
  });
  const afs = c.asset_feed_spec ?? {};
  const ld = c.object_story_spec?.link_data ?? {};
  const vd = c.object_story_spec?.video_data ?? {};
  return {
    primaryTexts: uniqTexts([...(afs.bodies ?? []).map((b) => b.text), ld.message, vd.message, c.body]),
    headlines: uniqTexts([...(afs.titles ?? []).map((t) => t.text), ld.name, vd.title, c.title]),
    descriptions: uniqTexts([...(afs.descriptions ?? []).map((d) => d.text), ld.description, vd.link_description]),
    cta: afs.call_to_action_types?.[0] || ld.call_to_action?.type || vd.call_to_action?.type,
    link: ld.link || afs.link_urls?.[0]?.website_url || ld.call_to_action?.value?.link || vd.call_to_action?.value?.link,
  };
}
