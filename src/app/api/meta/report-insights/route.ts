import { NextRequest, NextResponse } from 'next/server';
import { generateText } from '@/lib/text-llm';
import { hasDb } from '@/lib/db/client';
import { isValidAccountId } from '@/lib/meta/store';
import { getScoringSettings } from '@/lib/meta/scoring-settings';
import { buildAllCreativeCrosses, idFilter, type CreativeCrossResult } from '@/lib/meta/creative-cross';
import { buildInsightsDataSections } from '@/lib/meta/insights-prompt';
import { requireAuth, assertAccountAccess } from '@/lib/auth/guard';

export const runtime = 'nodejs';

/**
 * 広告レポートのAI分析・改善案を生成する。
 * クライアントが既に取得済みの集計（summary/deltas/媒体/配置/勝ち負け/上位下位CR）に加え、
 * 優先順位タブ（シートv5総合評価）・勝ちセグメントタブ（内訳★判定）の評価済みデータと、
 * サーバー側で集計するクリエイティブ×セグメントクロス（配置・年齢×性別で化ける候補の発掘）を
 * 材料に、LLM（GEMINIキーがあればGemini、無ければOpenAI）で
 * 「①この期間の状況説明（前期比込み）」「②改善アクション」を返す。
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { client, rangeLabel, summary, deltas, media, placement, age, gender, winningSummary, topCreatives, worstCreatives, priority, segments, account, since, until, campaigns, adsets } = body ?? {};
    if (!summary) return NextResponse.json({ ok: false, error: '集計データがありません' }, { status: 400 });
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    if (typeof account === 'string') {
      const denied = assertAccountAccess(auth, account);
      if (denied) return denied;
    }

    // クリエイティブ×セグメントクロス（配置・年齢×性別。DBがあり、対象アカウントが妥当な場合のみ。失敗しても分析自体は続行）
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

    const prompt = `あなたはMeta広告運用に精通した敏腕コンサルタントです。以下の1アカウントの実データを読み、運用者（広告主）向けに日本語で「状況説明」と「改善アクション」を作成してください。

${buildInsightsDataSections(body, cross, { cvDeviationPct })}

# 出力ルール
- 与えられた数値・固有名詞だけを使う。データに無い数値や施策効果を捏造しない。
- 前期比は「先月（前期）と比べて〜」のように自然に状況説明へ織り込む。
- **評価済みデータ（総合評価・★判定）を分析の主軸にする**。生のCPAだけでなく「★★★優秀」「損切り」「判定不可（消化不足）」等の評価に言及し、対象のクリエイティブ名・セグメント名を具体的に挙げる。
- **クリエイティブ×セグメントクロス（配置・年齢×性別）を必ず確認する**。「全体では負け・要改善でも特定の媒体/配置、または特定の年齢×性別ではCPA基準内」のクリエイティブがあれば、そこに絞った再配信（手動配置への切替／ターゲティングの絞り込み）を提案する。CV数が1〜2件と少ない場合は断定せず「少額の検証枠で絞って再テスト」のように表現する。
- **単独軸（性別のみ・年齢のみ）の★判定だけを根拠に配分・絞り込みを指示してはいけない**。単独軸は合計値であり、内側に負けセグメントを抱えていることがある（例:「65+」全体は★★でも「65+・female」はCPA基準超え）。「年齢Xが良好」「性別Yが良好」から「XのY層に寄せる」と提案する場合は、必ず「年齢×性別」の該当マスの実績を確認し、その数値を根拠として挙げること。該当マスが「判定不可（消化不足）」なら断定せず「掛け合わせでの検証データが不足しているため少額で検証」と表現する。
- **同じ消化を単独軸と掛け合わせで二重に数えない**。「年齢=65+に寄せる」と「年齢×性別=65+・maleに寄せる」を別々の打ち手として挙げてはいけない。掛け合わせのデータがある場合は掛け合わせを優先し、打ち手は1つにまとめる。
- **配置・セグメントの除外・停止提案は「←▲除外候補」の印が付いた行、または★判定が「停止推奨」の行に限定する**。それ以外のCV0の配置・セグメント（性別・年齢含む。判定が「判定不可」のものも同様）は、消化が「除外判断の最低消化額」に達していないデータ不足＝判断保留であり、除外・停止を提案してはいけない（少額消化のCV0からの除外判断は早計）。必要なら「消化が基準額に達するまで判断保留」と表現する。
- CPA最適化の視点を最優先。媒体/配置/性別/年齢/年齢×性別/クリエイティブのどこを伸ばし、どこを止める/絞る/差し替えるかを具体的に。
- 【配信状況】に注意：【停止中】の広告に「配信を停止せよ」と言わない（すでに停止済み）。停止中の不調CRは「次に活かす学び（同系統の訴求は再制作しない 等）」または「配置を絞っての復活テスト候補」として扱う。「今すぐ止める」は【配信中】の不調CRに限定する。
- 改善アクションは、①クリエイティブ（伸ばす/止める/差し替え/配置を絞って再配信）②セグメント配分（配置・年齢×性別。単独軸は根拠に使わない）③予算配分 ④検証・テスト の観点から**考えうる打ち手をすべて洗い出し**、CPA改善インパクトの大きい順（優先度順）に並べて**最大10個**出力する。打ち手が10個に満たない場合はある分だけでよい（無理に水増ししない）。
- 各アクションは title と detail に分ける:
  - title: 実行可能な命令形の1文（一覧に表示される要約。40字程度まで）
  - detail: (a) 根拠となる数値 (b) **該当する広告名・媒体/配置・セグメントの組み合わせを省略せずすべて列挙する**（「〜など」「等」でまとめない。例えば「CV0の配置を除外」なら該当する広告×配置の全組み合わせを挙げる） (c) 具体的な実行手順や判断基準。3〜10文程度
- マーケ専門用語は使ってよいが、冗長にしない。

# 出力フォーマット（厳守・JSONのみ・前後の説明やコードフェンス不要）
{
  "situation": "この期間の状況説明（前期比込み・評価分布込み）を4〜6文の日本語で。",
  "actions": [
    {"title": "優先度1位の打ち手（命令形1文）", "detail": "根拠数値＋該当する広告・配置・セグメントの全列挙＋実行手順"},
    {"title": "優先度2位の打ち手", "detail": "..."}
  ]
}`;

    // プロンプト確認用（プロンプト調整時のデバッグ。LLMは呼ばない）
    if (body?.debug) return NextResponse.json({ ok: true, debugPrompt: prompt });

    const result = await generateText(prompt);
    let parsed: { situation?: string; actions?: { title?: string; detail?: string }[]; suggestions?: string[] };
    try {
      const m = result.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : {};
    } catch {
      // JSONで返らなかった場合は全文を situation に入れて救済
      parsed = { situation: result.trim(), actions: [] };
    }
    // actions（title+detail）が本命。旧形式 suggestions（文字列配列）で返ってきた場合も救済
    const actions = Array.isArray(parsed.actions)
      ? parsed.actions
          .filter((a): a is { title: string; detail?: string } => !!a && typeof a.title === 'string' && a.title.trim() !== '')
          .slice(0, 10)
          .map((a) => ({ title: a.title.trim(), detail: typeof a.detail === 'string' ? a.detail.trim() : '' }))
      : Array.isArray(parsed.suggestions)
        ? parsed.suggestions.filter((s): s is string => typeof s === 'string').slice(0, 10).map((s) => ({ title: s, detail: '' }))
        : [];
    return NextResponse.json({
      ok: true,
      situation: parsed.situation ?? '',
      actions,
      // 互換用（旧UI・外部利用向け）: titleのみの配列
      suggestions: actions.map((a) => a.title),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI分析の生成に失敗しました';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
