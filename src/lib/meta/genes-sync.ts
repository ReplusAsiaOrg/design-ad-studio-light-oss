import { loadSnapshot } from '@/lib/meta/store';
import { labelWinners } from '@/lib/meta/winner';
import { fetchCreatives } from '@/lib/meta/client';
import { fetchCreativeMedia } from '@/lib/meta/creatives';
import { classifyCreativeTraits } from '@/lib/openai';
import { loadGeneCache, saveGeneCache, type GeneCache } from '@/lib/meta/genes-store';

export interface GenesClassifyResultRow {
  creativeId: string;
  ok: boolean;
  isVideo?: boolean;
  error?: string;
}

export interface GenesClassifyResult {
  account: string;
  attempted: number;
  classified: number;
  skipped: number;
  cacheTotal: number;
  /** 分類済みCRのうち、失効したimageUrlを取り直した件数（Issue #26）。 */
  refreshedUrls: number;
  results: GenesClassifyResultRow[];
}

/**
 * 勝ち/負けクリエイティブの画像を vision分類し CreativeTraits を付与する。
 * 対象 = 各CV群の winners + losers（上位 limit 件ずつ、既定6）。
 * キャッシュ済みの creativeId はスキップするため、同期のたびに呼んでも
 * 新しく勝ち/負けに入ったCRの差分だけが分類される（インクリメンタル）。
 */
export async function classifyAccountGenes(
  account: string,
  opts: { limit?: number; refresh?: boolean } = {},
): Promise<GenesClassifyResult> {
  const limit = opts.limit && opts.limit > 0 ? Math.floor(opts.limit) : 6;
  const refresh = !!opts.refresh;

  const snap = await loadSnapshot(account);
  if (!snap) throw new Error(`同期データがありません: ${account}`);

  // 各群の winners + losers 上位 limit 件の creativeId を集める
  const groups = labelWinners(snap);
  const targetIds = new Set<string>();
  for (const g of groups) {
    for (const a of [...g.winners.slice(0, limit), ...g.losers.slice(0, limit)]) {
      if (a.creativeId) targetIds.add(a.creativeId);
    }
  }

  const cache: GeneCache = await loadGeneCache(account);
  const toClassify = [...targetIds].filter((id) => refresh || !cache[id]);

  // Meta CDNの署名付きURLは数日で失効する（Issue #26）。分類済みCRは vision分類を
  // スキップしたまま、imageUrl だけ毎回取り直して上書きする（メタ情報のみ・画像DLなし）。
  // 対象はキャッシュ全件: ピッカーは現在の上位圏外に落ちた過去の勝ちCRも表示するため、
  // targetIds だけ取り直すと残りが失効したままになる（50件/1リクエストなので全件でも軽い）。
  const classifySet = new Set(toClassify);
  const toRefreshUrl = Object.keys(cache).filter((id) => !classifySet.has(id));
  let refreshedUrls = 0;
  if (toRefreshUrl.length > 0) {
    try {
      const creatives = await fetchCreatives(toRefreshUrl);
      for (const id of toRefreshUrl) {
        const c = creatives[id];
        const url = c?.image_url || c?.thumbnail_url;
        if (url && url !== cache[id].imageUrl) {
          cache[id] = { ...cache[id], imageUrl: url };
          refreshedUrls++;
        }
      }
    } catch {
      // URL更新は補助処理。失敗しても分類・数値同期は止めない
    }
  }

  if (toClassify.length === 0) {
    if (refreshedUrls > 0) await saveGeneCache(account, cache);
    return {
      account,
      attempted: 0,
      classified: 0,
      skipped: targetIds.size,
      cacheTotal: Object.keys(cache).length,
      refreshedUrls,
      results: [],
    };
  }

  const media = await fetchCreativeMedia(toClassify);

  const results: GenesClassifyResultRow[] = [];
  let classified = 0;
  for (const id of toClassify) {
    const m = media[id];
    if (!m || !m.base64) {
      results.push({ creativeId: id, ok: false, error: m?.error ?? 'no media' });
      continue;
    }
    try {
      const genes = await classifyCreativeTraits(m.base64, m.mimeType);
      cache[id] = {
        creativeId: id,
        genes,
        isVideo: m.isVideo,
        imageUrl: m.imageUrl,
        classifiedAt: new Date().toISOString(),
      };
      classified++;
      results.push({ creativeId: id, ok: true, isVideo: m.isVideo });
    } catch (e) {
      results.push({ creativeId: id, ok: false, error: e instanceof Error ? e.message : 'classify failed' });
    }
  }

  await saveGeneCache(account, cache);

  return {
    account,
    attempted: toClassify.length,
    classified,
    skipped: targetIds.size - toClassify.length,
    cacheTotal: Object.keys(cache).length,
    refreshedUrls,
    results,
  };
}
