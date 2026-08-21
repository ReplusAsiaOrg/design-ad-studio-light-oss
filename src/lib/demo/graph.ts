/**
 * デモモード用の「偽 Meta Graph API」。
 * client.ts の metaGet / metaGetAll がここへ迂回する（DEMO_MODE=1 のとき）。
 * 実装しているのは本アプリが叩くエンドポイントだけ:
 *   me/adaccounts / {act} / {act}/insights / {act}/campaigns / {act}/adsets / {act}/ads
 *   ''?ids=（クリエイティブ一括） / {creativeId}（広告テキスト） / {videoId}
 * 返す JSON の形は Meta と同じ（数値は文字列）。
 */
import {
  DEMO_ACCOUNT_ID, DEMO_ACCOUNT_NAME, DEMO_CURRENCY, DEMO_CAMPAIGNS, DEMO_ADSETS, DEMO_CREATIVES,
  demoAds, demoAdDays, demoToday, demoEarliestDate, demoImageUrl, demoCreative, addDays, diffDays,
  type DemoCell,
} from './dataset';

export class DemoGraphError extends Error {
  constructor(message: string, public readonly status = 400, public readonly code = 100) {
    super(message);
    this.name = 'DemoGraphError';
  }
}

type Params = Record<string, string>;

/** 動画CRの video_id（クリエイティブIDから機械的に導く） */
const videoIdOf = (creativeId: string) => creativeId.replace(/^12/, '13');

// ---------------------------------------------------------------------------
// 期間解決
// ---------------------------------------------------------------------------

function resolveRange(params: Params): { since: string; until: string } {
  const today = demoToday();
  if (params.time_range) {
    try {
      const tr = JSON.parse(params.time_range) as { since?: string; until?: string };
      if (tr.since && tr.until) return { since: tr.since, until: tr.until > today ? today : tr.until };
    } catch { /* fallthrough */ }
  }
  const preset = params.date_preset ?? 'last_30d';
  const m = preset.match(/^last_(\d+)d$/);
  if (m) return { since: addDays(today, -Number(m[1])), until: addDays(today, -1) };
  switch (preset) {
    case 'today': return { since: today, until: today };
    case 'yesterday': return { since: addDays(today, -1), until: addDays(today, -1) };
    case 'this_month': return { since: today.slice(0, 8) + '01', until: today };
    case 'last_month': {
      const firstThis = today.slice(0, 8) + '01';
      const lastPrev = addDays(firstThis, -1);
      return { since: lastPrev.slice(0, 8) + '01', until: lastPrev };
    }
    case 'maximum':
    case 'lifetime':
    default:
      return { since: demoEarliestDate(), until: today };
  }
}

// ---------------------------------------------------------------------------
// insights
// ---------------------------------------------------------------------------

interface Filter { field: string; operator: string; value: string[] }

function applyFiltering(params: Params): Set<string> | undefined {
  if (!params.filtering) return undefined;
  let filters: Filter[] = [];
  try { filters = JSON.parse(params.filtering) as Filter[]; } catch { return undefined; }
  let ids: Set<string> | undefined;
  for (const f of filters) {
    if (f.operator !== 'IN' || !Array.isArray(f.value)) continue;
    const want = new Set(f.value.map(String));
    const matched = new Set(
      demoAds()
        .filter((a) =>
          f.field === 'campaign.id' ? want.has(a.campaignId)
            : f.field === 'adset.id' ? want.has(a.adsetId)
              : f.field === 'ad.id' ? want.has(a.id)
                : true)
        .map((a) => a.id),
    );
    ids = ids ? new Set([...ids].filter((x) => matched.has(x))) : matched;
  }
  return ids;
}

interface Agg extends DemoCell { keys: Record<string, string>; date_start: string; date_stop: string; days: Set<string> }

function actionsOf(cv: number, spend: number): { actions: { action_type: string; value: string }[]; cost: { action_type: string; value: string }[] } {
  const rows: [string, number][] = [
    ['offsite_conversion.fb_pixel_purchase', cv],
    ['purchase', cv],
    ['omni_purchase', cv],
    ['offsite_conversion.fb_pixel_add_to_cart', Math.round(cv * 3.1)],
    ['offsite_conversion.fb_pixel_initiate_checkout', Math.round(cv * 1.7)],
  ];
  const actions = rows.filter(([, v]) => v > 0).map(([t, v]) => ({ action_type: t, value: String(v) }));
  const cost = rows.filter(([, v]) => v > 0).map(([t, v]) => ({ action_type: t, value: (spend / v).toFixed(2) }));
  return { actions, cost };
}

function insights(accountId: string, params: Params): Record<string, unknown>[] {
  const { since, until } = resolveRange(params);
  const level = params.level ?? 'account';
  const breakdowns = (params.breakdowns ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const daily = params.time_increment === '1';
  const fields = new Set((params.fields ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  const adFilter = applyFiltering(params);
  const ads = new Map(demoAds().map((a) => [a.id, a]));

  const useAg = breakdowns.includes('age') || breakdowns.includes('gender');
  const usePl = breakdowns.includes('publisher_platform') || breakdowns.includes('platform_position');
  if (useAg && usePl) throw new DemoGraphError('(#100) age/gender と placement の breakdowns は併用できません');

  const aggs = new Map<string, Agg>();
  for (const day of demoAdDays(since, until, adFilter)) {
    const ad = ads.get(day.adId)!;
    const levelKeys: Record<string, string> =
      level === 'ad' ? { ad_id: ad.id, campaign_id: ad.campaignId, adset_id: ad.adsetId }
        : level === 'adset' ? { adset_id: ad.adsetId, campaign_id: ad.campaignId }
          : level === 'campaign' ? { campaign_id: ad.campaignId }
            : {};

    const cells: { keys: Record<string, string>; cell: DemoCell }[] = [];
    if (useAg) {
      for (const [k, cell] of Object.entries(day.ageGender)) {
        const [age, gender] = k.split('・');
        const keys: Record<string, string> = {};
        if (breakdowns.includes('age')) keys.age = age;
        if (breakdowns.includes('gender')) keys.gender = gender;
        cells.push({ keys, cell });
      }
    } else if (usePl) {
      for (const [k, cell] of Object.entries(day.placement)) {
        const [platform, position] = k.split('/');
        const keys: Record<string, string> = {};
        if (breakdowns.includes('publisher_platform')) keys.publisher_platform = platform;
        if (breakdowns.includes('platform_position')) keys.platform_position = position;
        cells.push({ keys, cell });
      }
    } else {
      cells.push({ keys: {}, cell: day.total });
    }

    for (const { keys, cell } of cells) {
      const allKeys = { ...levelKeys, ...keys };
      const id = (daily ? day.date + '|' : '') + JSON.stringify(allKeys);
      let a = aggs.get(id);
      if (!a) {
        a = { keys: allKeys, spend: 0, impressions: 0, clicks: 0, cv: 0, date_start: daily ? day.date : since, date_stop: daily ? day.date : until, days: new Set() };
        aggs.set(id, a);
      }
      a.spend += cell.spend; a.impressions += cell.impressions; a.clicks += cell.clicks; a.cv += cell.cv;
      a.days.add(day.date);
    }
  }

  const rows: Record<string, unknown>[] = [];
  for (const a of aggs.values()) {
    if (a.impressions <= 0) continue;
    const row: Record<string, unknown> = { ...a.keys };
    const want = (f: string) => fields.size === 0 || fields.has(f);
    if (want('spend')) row.spend = a.spend.toFixed(2);
    if (want('impressions')) row.impressions = String(a.impressions);
    if (want('reach')) {
      // リーチは日次≒imp/1.35、期間が長いほど重複が増えるので割る数を大きくする
      const span = Math.max(1, diffDays(a.date_start, a.date_stop) + 1);
      row.reach = String(Math.round(a.impressions / (1.35 + 0.03 * Math.min(span, 60))));
    }
    if (want('clicks')) row.clicks = String(a.clicks);
    if (want('ctr')) row.ctr = a.impressions > 0 ? ((a.clicks / a.impressions) * 100).toFixed(6) : '0';
    if (want('cpc')) row.cpc = a.clicks > 0 ? (a.spend / a.clicks).toFixed(6) : '0';
    const { actions, cost } = actionsOf(a.cv, a.spend);
    if (want('actions') && actions.length) row.actions = actions;
    if (want('cost_per_action_type') && cost.length) row.cost_per_action_type = cost;
    row.date_start = a.date_start;
    row.date_stop = a.date_stop;
    rows.push(row);
  }
  rows.sort((x, y) => String(x.date_start).localeCompare(String(y.date_start)) || String(x.ad_id ?? '').localeCompare(String(y.ad_id ?? '')));
  return rows;
}

// ---------------------------------------------------------------------------
// エンティティ
// ---------------------------------------------------------------------------

function totalSpend(): number {
  return demoAdDays(demoEarliestDate(), demoToday()).reduce((s, d) => s + d.total.spend, 0);
}

function creativeObject(id: string): Record<string, unknown> | null {
  const c = demoCreative(id);
  if (!c) return null;
  const url = demoImageUrl(c);
  if (c.isVideo) {
    return {
      id: c.id,
      object_type: 'VIDEO',
      thumbnail_url: url,
      video_id: videoIdOf(c.id),
      object_story_spec: {
        video_data: {
          video_id: videoIdOf(c.id),
          message: c.text.primary,
          title: c.text.headline,
          link_description: c.text.description,
          call_to_action: { type: 'SHOP_NOW', value: { link: 'https://example.com/lumina' } },
        },
      },
    };
  }
  return {
    id: c.id,
    object_type: 'SHARE',
    image_url: url,
    thumbnail_url: url,
    title: c.text.headline,
    body: c.text.primary,
    object_story_spec: {
      link_data: {
        message: c.text.primary,
        name: c.text.headline,
        description: c.text.description,
        link: 'https://example.com/lumina',
        call_to_action: { type: 'SHOP_NOW', value: { link: 'https://example.com/lumina' } },
      },
    },
  };
}

function assertAccount(id: string) {
  if (id !== DEMO_ACCOUNT_ID) {
    throw new DemoGraphError(`Unsupported get request. Object with ID '${id}' does not exist（デモモードでは ${DEMO_ACCOUNT_ID} のみ利用できます）`, 400, 100);
  }
}

/** 単発 GET（metaGet 相当）。 */
export async function demoGraphGet<T = unknown>(path: string, params: Params = {}): Promise<T> {
  const p = path.replace(/^\/+/, '');

  // クリエイティブ一括（?ids=a,b,c）
  if (p === '' && params.ids) {
    const out: Record<string, unknown> = {};
    for (const id of params.ids.split(',')) {
      const c = creativeObject(id.trim());
      if (c) out[id.trim()] = c;
    }
    return out as T;
  }

  if (p === 'me/adaccounts') {
    return {
      data: [{
        id: DEMO_ACCOUNT_ID,
        name: DEMO_ACCOUNT_NAME,
        account_status: 1,
        currency: DEMO_CURRENCY,
        amount_spent: String(totalSpend()),
        business: { id: '0', name: 'サンプルビジネス（デモ）' },
      }],
      paging: {},
    } as T;
  }

  const [head, sub] = p.split('/');

  if (head.startsWith('act_')) {
    assertAccount(head);
    if (!sub) return { id: DEMO_ACCOUNT_ID, name: DEMO_ACCOUNT_NAME, account_status: 1, currency: DEMO_CURRENCY } as T;
    if (sub === 'insights') return { data: insights(head, params), paging: {} } as T;
    if (sub === 'campaigns') return { data: DEMO_CAMPAIGNS.map((c) => ({ id: c.id, name: c.name })), paging: {} } as T;
    if (sub === 'adsets') return { data: DEMO_ADSETS.map((a) => ({ id: a.id, name: a.name, campaign_id: a.campaignId })), paging: {} } as T;
    if (sub === 'ads') {
      return {
        data: demoAds().map((a) => ({
          id: a.id, name: a.name, status: a.status, effective_status: a.effectiveStatus,
          campaign_id: a.campaignId, adset_id: a.adsetId, creative: { id: a.creativeId },
        })),
        paging: {},
      } as T;
    }
    throw new DemoGraphError(`Unsupported edge: ${p}`, 400, 100);
  }

  // クリエイティブ単体（広告テキスト）
  const c = creativeObject(head);
  if (c) return c as T;

  // 動画（デモでは再生ソースなし。permalink だけ返す）
  if (DEMO_CREATIVES.some((cr) => videoIdOf(cr.id) === head)) {
    return { id: head, permalink_url: 'https://example.com/lumina/video' } as T;
  }

  throw new DemoGraphError(`Unsupported get request. Object with ID '${head}' does not exist`, 400, 100);
}

/** paging を辿って全件（metaGetAll 相当）。デモは1ページで全件返す。 */
export async function demoGraphGetAll<T = unknown>(path: string, params: Params = {}): Promise<T[]> {
  const res = await demoGraphGet<{ data?: T[] }>(path, params);
  return res.data ?? [];
}
