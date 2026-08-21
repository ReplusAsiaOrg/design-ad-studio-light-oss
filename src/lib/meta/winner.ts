import type { AccountSnapshot } from './store';
import { analyzeAd, type AnalyzedAd, type ConversionGroup } from './analyze';

/**
 * Phase 2a: 勝ち/負けラベリング。
 *
 * 統計検定は持ち込まず、運用者が直感的に追える「中央値split」で判定する。
 *   - 比較は必ず「同一CV群」内で行う（CPAは購入と登録で意味が違うため）。
 *   - 配信が薄い広告（minSpend未満）は insufficient とし判定から除外。
 *   - winner = 群のCPA中央値より低い（＝安い）／ loser = 中央値より高い。
 */

export type Verdict = 'winner' | 'loser' | 'insufficient';

export interface LabeledAd extends AnalyzedAd {
  verdict: Verdict;
  /** その広告のCPAが群中央値の何倍か（1未満=中央値より安い＝良い）。 */
  cpaRatio: number | null;
}

export interface WinnerGroup {
  client: string;
  accountId: string;
  conversionKey: ConversionGroup['key'];
  conversionLabel: string;
  /** 判定対象（minSpend以上かつCVあり）の中央値CPA。 */
  medianCpa: number | null;
  evaluatedCount: number;
  winners: LabeledAd[];
  losers: LabeledAd[];
  insufficient: LabeledAd[];
}

function median(values: number[]): number | null {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = nums.length;
  if (n === 0) return null;
  return n % 2 ? nums[(n - 1) / 2] : (nums[n / 2 - 1] + nums[n / 2]) / 2;
}

/**
 * スナップショットを同一CV群ごとに分け、各群内で勝ち負けをラベリングする。
 * @param minSpend 判定に乗せる最低消化額（これ未満は insufficient）。
 */
export function labelWinners(snap: AccountSnapshot, minSpend = 3000): WinnerGroup[] {
  const all = snap.ads.map(analyzeAd);
  const analyzed = all.filter((a) => a.conversionKey !== null);
  // minSpend以上消化してCV 0 の広告は「最も明確な負け」。CV種別が特定できないため、
  // 後で判定対象の最も多い群（主要CV群）に loser として合流させる。
  const spentNoCv = all.filter((a) => a.conversionKey === null && a.spend >= minSpend);

  // CV群ごとに分割
  const byKey = new Map<string, AnalyzedAd[]>();
  for (const a of analyzed) {
    const k = a.conversionKey!;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(a);
  }

  const groups: WinnerGroup[] = [];
  for (const [key, ads] of byKey) {
    // 判定対象 = minSpend以上 かつ CPA算出可能（CV>0）
    const evaluable = ads.filter((a) => a.cpa !== null && a.spend >= minSpend);
    const medianCpa = median(evaluable.map((a) => a.cpa!));
    // 判定対象が1件だと中央値=自分自身で必ず勝ちになるため、2件未満は比較不能とする
    const canJudge = evaluable.length >= 2 && medianCpa !== null;

    const winners: LabeledAd[] = [];
    const losers: LabeledAd[] = [];
    const insufficient: LabeledAd[] = [];

    for (const a of ads) {
      const evaluated = a.cpa !== null && a.spend >= minSpend;
      const cpaRatio = evaluated && canJudge && medianCpa! > 0 ? a.cpa! / medianCpa! : null;
      const labeled: LabeledAd = {
        ...a,
        verdict: 'insufficient',
        cpaRatio: cpaRatio !== null ? Math.round(cpaRatio * 100) / 100 : null,
      };
      if (!evaluated || !canJudge) {
        labeled.verdict = 'insufficient';
        insufficient.push(labeled);
      } else if (a.cpa! <= medianCpa!) {
        labeled.verdict = 'winner';
        winners.push(labeled);
      } else {
        labeled.verdict = 'loser';
        losers.push(labeled);
      }
    }

    winners.sort((x, y) => (x.cpa ?? Infinity) - (y.cpa ?? Infinity));
    // CPA null（CV0）は最悪の負けとして先頭に
    losers.sort((x, y) => (y.cpa ?? Infinity) - (x.cpa ?? Infinity));

    groups.push({
      client: snap.client,
      accountId: snap.accountId,
      conversionKey: key as ConversionGroup['key'],
      conversionLabel: ads[0].conversionLabel!,
      medianCpa,
      evaluatedCount: evaluable.length,
      winners,
      losers,
      insufficient,
    });
  }

  // 判定対象件数が多い群を先頭に
  groups.sort((a, b) => b.evaluatedCount - a.evaluatedCount);

  // 消化十分・CV0 の広告を主要CV群（先頭）の loser 先頭に合流させる
  if (spentNoCv.length > 0 && groups.length > 0) {
    const main = groups[0];
    const asLosers: LabeledAd[] = spentNoCv
      .sort((x, y) => y.spend - x.spend)
      .map((a) => ({ ...a, verdict: 'loser' as const, cpaRatio: null }));
    main.losers.unshift(...asLosers);
  }

  return groups;
}
