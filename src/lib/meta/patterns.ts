import type { AccountSnapshot } from './store';
import { labelWinners, type Verdict } from './winner';
import type { GeneCache } from './genes-store';
import {
  TRAIT_AGG_DIMENSIONS,
  traitDimensionLabel,
  traitLabel,
  type TraitDimension,
} from '../genes';

/**
 * Phase 2c: 勝ち/負けラベル × CreativeTraits を次元別に集計し、
 * 「勝ちは○○ / 負けは××」を抽出する。
 *
 * 各次元の各値について winner数/loser数を数え、勝率 winRate=winners/(winners+losers) を出す。
 * - winRate高 & サンプル十分 → 勝ち特徴
 * - winRate低 & サンプル十分 → 負け特徴
 * hooks は配列なので各フックを個別カウント。format(動画/静止画)は traits外の合成次元。
 */

export interface PatternValueStat {
  dimension: string;
  dimensionLabel: string;
  value: string;
  valueLabel: string;
  winners: number;
  losers: number;
  total: number;
  /** winners/(winners+losers)。判定対象のみ（insufficientは除外）。 */
  winRate: number;
}

export interface AccountPatterns {
  client: string;
  accountId: string;
  evaluatedAds: number;
  genesCovered: number;
  stats: PatternValueStat[];
  winningTraits: PatternValueStat[];
  losingTraits: PatternValueStat[];
  /** 人間向けの要約行（「勝ちは○○」「負けは××」）。 */
  headlines: string[];
}

type Counter = Map<string, { winners: number; losers: number }>;

function bump(counter: Counter, key: string, verdict: Verdict) {
  if (verdict === 'insufficient') return;
  if (!counter.has(key)) counter.set(key, { winners: 0, losers: 0 });
  const c = counter.get(key)!;
  if (verdict === 'winner') c.winners++;
  else c.losers++;
}

export function buildAccountPatterns(
  snap: AccountSnapshot,
  geneCache: GeneCache,
  opts: { minSamples?: number } = {},
): AccountPatterns {
  const minSamples = opts.minSamples ?? 3;
  const groups = labelWinners(snap);

  // creativeId → verdict（判定対象のみ）。同creativeが複数広告にまたがる場合は勝ち優先。
  const verdictByCreative = new Map<string, Verdict>();
  let evaluatedAds = 0;
  for (const g of groups) {
    for (const a of [...g.winners, ...g.losers]) {
      evaluatedAds++;
      if (!a.creativeId) continue;
      const prev = verdictByCreative.get(a.creativeId);
      if (prev === 'winner') continue;
      verdictByCreative.set(a.creativeId, a.verdict);
    }
  }

  // 次元別カウンタ（traits次元 + format合成次元）。次元名＝フィールド名なので直接引ける
  const counters = new Map<string, Counter>();
  for (const d of TRAIT_AGG_DIMENSIONS) counters.set(d, new Map());
  counters.set('format', new Map());

  let genesCovered = 0;
  for (const [creativeId, verdict] of verdictByCreative) {
    const rec = geneCache[creativeId];
    if (!rec) continue;
    genesCovered++;

    for (const d of TRAIT_AGG_DIMENSIONS) {
      // 旧スキーマのキャッシュにはこの次元が無いことがある → スキップ
      const v: string | readonly string[] | undefined = rec.genes?.[d];
      if (v == null) continue;
      if (Array.isArray(v)) {
        for (const item of v) bump(counters.get(d)!, item, verdict);
      } else {
        bump(counters.get(d)!, v as string, verdict);
      }
    }
    bump(counters.get('format')!, rec.isVideo ? 'video' : 'image', verdict);
  }

  const FORMAT_LABELS: Record<string, string> = { video: '動画', image: '静止画' };
  const stats: PatternValueStat[] = [];
  for (const [dimension, counter] of counters) {
    const dimensionLabel =
      dimension === 'format' ? '形式' : traitDimensionLabel(dimension as TraitDimension);
    for (const [value, c] of counter) {
      const total = c.winners + c.losers;
      stats.push({
        dimension,
        dimensionLabel,
        value,
        valueLabel: dimension === 'format' ? (FORMAT_LABELS[value] ?? value) : traitLabel(value),
        winners: c.winners,
        losers: c.losers,
        total,
        winRate: total > 0 ? Math.round((c.winners / total) * 100) / 100 : 0,
      });
    }
  }

  // サンプル十分なものだけを勝ち/負け特徴に
  const qualified = stats.filter((s) => s.total >= minSamples);
  const winningTraits = qualified
    .filter((s) => s.winRate >= 0.6)
    .sort((a, b) => b.winRate - a.winRate || b.total - a.total);
  const losingTraits = qualified
    .filter((s) => s.winRate <= 0.4)
    .sort((a, b) => a.winRate - b.winRate || b.total - a.total);

  const headlines: string[] = [];
  for (const s of winningTraits.slice(0, 5)) {
    headlines.push(
      `勝ちは「${s.dimensionLabel}=${s.valueLabel}」（勝率${Math.round(s.winRate * 100)}% ・${s.winners}/${s.total}件）`,
    );
  }
  for (const s of losingTraits.slice(0, 5)) {
    headlines.push(
      `負けは「${s.dimensionLabel}=${s.valueLabel}」（勝率${Math.round(s.winRate * 100)}% ・${s.winners}/${s.total}件）`,
    );
  }

  return {
    client: snap.client,
    accountId: snap.accountId,
    evaluatedAds,
    genesCovered,
    stats: stats.sort((a, b) => b.total - a.total),
    winningTraits,
    losingTraits,
    headlines,
  };
}
