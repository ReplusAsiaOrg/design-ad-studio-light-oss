import { NextRequest, NextResponse } from 'next/server';
import { generateText } from '@/lib/text-llm';
import { hasDb } from '@/lib/db/client';
import { isValidAccountId } from '@/lib/meta/store';
import { getScoringSettings } from '@/lib/meta/scoring-settings';
import { buildAllCreativeCrosses, idFilter, type CreativeCrossResult } from '@/lib/meta/creative-cross';
import { buildInsightsDataSections, type InsightsDataBody } from '@/lib/meta/insights-prompt';
import { requireAuth, assertAccountAccess } from '@/lib/auth/guard';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_TURNS = 20;       // 会話履歴の上限（それ以前は切り捨て）
const MAX_MSG_CHARS = 2000; // 1メッセージの上限

interface ChatMessage { role: 'user' | 'assistant'; content: string }

/**
 * 広告レポートへの質問チャット。
 * 分析（/api/meta/report-insights）と同一のデータプロンプトを再構築した上に、
 * 会話履歴を積んで回答を生成する。分析結果（analysis）があればそのコンテキストも含める
 * （＝改善アクションへの質問と、分析未実行のレポート全体質問の両方に対応）。
 * サーバーは会話状態を持たない（履歴はクライアントが毎回送る）。
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { analysis, focusIndex, messages, account, since, until, campaigns, adsets } = body ?? {};
    if (!body?.summary) return NextResponse.json({ ok: false, error: '集計データがありません' }, { status: 400 });
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    if (typeof account === 'string') {
      const denied = assertAccountAccess(auth, account);
      if (denied) return denied;
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ ok: false, error: '質問がありません' }, { status: 400 });
    }

    const history: ChatMessage[] = messages
      .filter((m: ChatMessage) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-MAX_TURNS)
      .map((m: ChatMessage) => ({ role: m.role, content: m.content.slice(0, MAX_MSG_CHARS) }));
    if (history.length === 0 || history[history.length - 1].role !== 'user') {
      return NextResponse.json({ ok: false, error: '最後のメッセージがユーザーの質問ではありません' }, { status: 400 });
    }

    // 分析時と同じクロス集計を再構築（AIが見る数値を分析と完全一致させる）
    let cross: CreativeCrossResult[] = [];
    let cvDeviationPct = 0;
    if (hasDb() && typeof account === 'string' && isValidAccountId(account)) {
      try {
        const settings = await getScoringSettings(account);
        cvDeviationPct = settings.cvDeviationPct;
        cross = await buildAllCreativeCrosses(account, since ?? null, until ?? null, settings, idFilter(campaigns, adsets));
      } catch (e) {
        console.error('creative-cross failed:', e);
      }
    }

    const actions: { title: string; detail?: string }[] = analysis?.actions ?? [];
    const hasAnalysis = actions.length > 0;
    const focus = typeof focusIndex === 'number' && actions[focusIndex] ? actions[focusIndex] : null;
    const actionLines = actions.map((a, i) => `${i + 1}. ${a.title}`).join('\n');
    const conversation = history
      .map((m) => `${m.role === 'user' ? '運用者' : 'コンサルタント'}: ${m.content}`)
      .join('\n');

    const intro = hasAnalysis
      ? '以下の1アカウントの実データに基づいて先に分析・改善提案を行いました。運用者からその提案について質問が来ています。'
      : '以下は1アカウントの広告レポートの実データです。運用者からこのレポートについて質問が来ています。';
    const prompt = `あなたはMeta広告運用に精通した敏腕コンサルタントです。${intro}データに基づいて日本語で回答してください。

${buildInsightsDataSections(body as InsightsDataBody, cross, { cvDeviationPct })}
${hasAnalysis ? `
# あなたが先に提示した分析
- 状況説明: ${analysis.situation ?? '（なし）'}
- 改善アクション一覧（優先度順）:
${actionLines}` : ''}
${focus ? `
# いま質問されている打ち手（${(focusIndex as number) + 1}番）
- title: ${focus.title}
- detail: ${focus.detail ?? '（詳細なし）'}` : ''}

# 回答ルール
- 上のデータセクションに与えられた数値・固有名詞だけを使う。数値の捏造・推定値のでっち上げは絶対にしない。
- データに無いこと（期間外の数値・ここに無い指標・広告の中身など）を聞かれたら、「この画面のデータには含まれていない」と正直に答え、可能なら「期間を変えて再分析する」「クリエイティブ詳細モーダルで確認する」等の代替手段を案内する。
- 除外・停止の判断は分析時と同じ基準を守る（「除外判断の最低消化額」未満のCV0はデータ不足＝判断保留。早計な除外を勧めない）。
- 提案の根拠を聞かれたら、該当する広告名・セグメント名と数値を具体的に挙げて説明する。
- あなたは分析ツール内のアシスタントであり、広告の入稿・停止・予算変更などの操作は実行できない。操作を頼まれたら手順を案内する。
- 簡潔に（目安3〜8文）。箇条書きは必要な時だけ。前置きや復唱はしない。
- 出力はプレーンテキストのみ（JSONやコードフェンス不要）。

# 会話
${conversation}
コンサルタント:`;

    // プロンプト確認用（デバッグ。LLMは呼ばない）
    if (body?.debug) return NextResponse.json({ ok: true, debugPrompt: prompt });

    const reply = (await generateText(prompt)).trim();
    if (!reply) return NextResponse.json({ ok: false, error: '回答を生成できませんでした' }, { status: 500 });
    return NextResponse.json({ ok: true, reply });
  } catch (error) {
    const message = error instanceof Error ? error.message : '回答の生成に失敗しました';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
