import { NextRequest, NextResponse } from 'next/server';
import { isValidAccountId } from '@/lib/meta/store';
import { getScoringSettings, saveScoringSettings, deleteScoringSettings, hasCustomSettings } from '@/lib/meta/scoring-settings';
import { DEFAULT_SCORING_SETTINGS, type ScoringSettings } from '@/lib/scoring';
import { requireAuth, requireAdmin, assertAccountAccess } from '@/lib/auth/guard';

export const runtime = 'nodejs';

function badRequest(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}

function getAccount(request: NextRequest): string | NextResponse {
  const account = request.nextUrl.searchParams.get('account');
  if (!account) return badRequest('account を指定してください');
  if (!isValidAccountId(account)) return badRequest(`不正なアカウントIDです: ${account}`);
  return account;
}

/** 正の有限数か（評価閾値は全て正の円/％） */
const pos = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * body を ScoringSettings として検証する。UIから全項目が来る前提の全量チェック
 * （部分保存だと「どこまで上書き済みか」が見えなくなるため、常に完全形で保存する）。
 */
function validateSettings(body: unknown): ScoringSettings | string {
  const b = body as Partial<ScoringSettings> | null;
  if (!b || typeof b !== 'object') return '設定オブジェクトが不正です';
  if (!pos(b.payoutPerCv)) return '報酬単価は正の数値で指定してください';
  if (!Array.isArray(b.brandPrefixes) || b.brandPrefixes.some((p) => typeof p !== 'string')) {
    return 'ブランド接頭辞は文字列の配列で指定してください';
  }
  const r = b.roasPct;
  if (!r || !pos(r.excellent) || !pos(r.good) || !pos(r.keep) || !pos(r.improve)) {
    return 'ROAS基準（優秀/良好/継続/要改善）は正の数値で指定してください';
  }
  const s1 = b.spendRank, s2 = b.spendRankBreakdown;
  if (!s1 || !pos(s1.a) || !pos(s1.b) || !pos(s1.c)) return '消化金額ランク境界（単体系）は正の数値で指定してください';
  if (!s2 || !pos(s2.a) || !pos(s2.b) || !pos(s2.c)) return '消化金額ランク境界（内訳系）は正の数値で指定してください';
  const st = b.starSpendMin;
  if (!st || !pos(st.s3) || !pos(st.s2)) return '★判定の消化下限は正の数値で指定してください';
  const w = b.winFilter;
  if (!w || !pos(w.roasMinPct) || typeof w.minPurchases !== 'number' || !Number.isFinite(w.minPurchases) || w.minPurchases < 0) {
    return '勝ち抽出フィルタが不正です';
  }
  // null = CPA基準（★継続ライン）に自動連動
  if (b.cutMinSpend != null && !pos(b.cutMinSpend)) {
    return '除外判定の最低消化額は正の数値か空欄（CPA基準に連動）で指定してください';
  }
  // 100%以上は実CV=0以下になり評価不能（0=補正なし・負値=Metaが少なく出る場合の逆方向補正）
  const dev = b.cvDeviationPct ?? 0;
  if (typeof dev !== 'number' || !Number.isFinite(dev) || dev >= 100) {
    return 'CV乖離率は100未満の数値で指定してください（0=補正なし）';
  }
  return {
    payoutPerCv: b.payoutPerCv,
    brandPrefixes: b.brandPrefixes.map((p) => p.trim()).filter(Boolean),
    roasPct: { excellent: r.excellent, good: r.good, keep: r.keep, improve: r.improve },
    spendRank: { a: s1.a, b: s1.b, c: s1.c },
    spendRankBreakdown: { a: s2.a, b: s2.b, c: s2.c },
    starSpendMin: { s3: st.s3, s2: st.s2 },
    winFilter: { roasMinPct: w.roasMinPct, minPurchases: w.minPurchases },
    cutMinSpend: b.cutMinSpend ?? null,
    cvDeviationPct: dev,
  };
}

/** 現在の評価設定（既定値マージ済み）と、上書きが保存されているかを返す。 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const account = getAccount(request);
    if (account instanceof NextResponse) return account;
    const denied = assertAccountAccess(auth, account);
    if (denied) return denied;

    const settings = await getScoringSettings(account);
    const customized = await hasCustomSettings(account);
    return NextResponse.json({
      ok: true, account, settings,
      defaults: DEFAULT_SCORING_SETTINGS,
      customized,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '評価設定の取得に失敗しました';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/** 評価設定を保存する（完全形で上書き）。 */
export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (auth instanceof NextResponse) return auth;
    const account = getAccount(request);
    if (account instanceof NextResponse) return account;
    const body = await request.json().catch(() => null);
    const validated = validateSettings(body?.settings);
    if (typeof validated === 'string') return badRequest(validated);

    await saveScoringSettings(account, validated);
    return NextResponse.json({ ok: true, account, settings: validated });
  } catch (error) {
    const message = error instanceof Error ? error.message : '評価設定の保存に失敗しました';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/** 上書きを削除して既定値に戻す。 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (auth instanceof NextResponse) return auth;
    const account = getAccount(request);
    if (account instanceof NextResponse) return account;
    await deleteScoringSettings(account);
    return NextResponse.json({ ok: true, account, settings: DEFAULT_SCORING_SETTINGS });
  } catch (error) {
    const message = error instanceof Error ? error.message : '評価設定のリセットに失敗しました';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
