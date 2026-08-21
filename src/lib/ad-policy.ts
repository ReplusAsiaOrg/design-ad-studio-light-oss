/**
 * 広告審査NG表現の簡易ガード（Issue #31）。
 *
 * 「明らかに広告審査（Meta・薬機法・景表法）に通らない表現」に限定した簡易チェック。
 * 本格的な審査ツールではない＝グレーゾーンは対象外・誤検知を抑えるため具体的な
 * 組み合わせのみ検出する。ブロックはせず警告（最終判断は人間）。
 *
 * 基準の出どころ: リプラス提供の広告審査ツール AdEvaluation-v2 の
 * 「Meta広告審査プロンプト v8.6.0」のキラーロジック（即NG）・NG維持条件と整合させている。
 *  - 即NG: 伏字・侮辱語・効能断定（痩せる/血糖値下げる/シミが消える等）
 *  - NG維持条件: 医療効果断定語・数値断定・確実性断定（確実に/100%/絶対に/必ず）
 *  - 緩和側（誤検知防止）: 「絶対」等の熱量表現単体・「〜のあなたへ」等のターゲティング・
 *    「育毛剤」「治療薬」等の製品カテゴリ名・「月収30万を目指す」等の目標表現はOK＝検出しない
 * 本格審査が必要な場合は AdEvaluation-v2（LLM審査）を使う。
 *
 * 使い方:
 *  - checkAdPolicy(text)         … 1テキストのNG検出
 *  - checkAdCopyFields(fields)   … フォーム全体（メイン/サブ/その他）の検出
 *  - AD_POLICY_PROMPT_GUIDE      … コピー生成LLMへの抑制ガイド（プロンプト注入用）
 */

export type PolicyCategory = '薬機法' | '景表法' | '金融・収益' | 'Metaポリシー' | '表現・素材';

export interface PolicyHit {
  /** 実際にマッチした文字列 */
  matched: string;
  category: PolicyCategory;
  reason: string;
  /** 言い換えの方向性（あれば） */
  suggestion?: string;
}

interface PolicyRule {
  pattern: RegExp;
  category: PolicyCategory;
  reason: string;
  suggestion?: string;
}

// 注意: g フラグは lastIndex 状態を持つため使わない（毎回 match で先頭ヒットのみ取る）
const RULES: PolicyRule[] = [
  // ---- 薬機法（医薬品的な効能効果の断定。化粧品・健康食品・エステでは不可） ----
  {
    pattern: /(シミ|しみ|シワ|しわ|ほうれい線|ニキビ|くすみ|たるみ)(跡)?が(消え|なくな|治)/,
    category: '薬機法',
    reason: '化粧品等で「消える・治る」の断定は医薬品的効能となりNG',
    suggestion: '「目立ちにくい印象へ」「〜が気になる方に」',
  },
  {
    pattern: /(脂肪|セルライト)(が|を)?(燃焼|溶け|溶か|分解)/,
    category: '薬機法',
    reason: '身体の変化（脂肪燃焼・分解）の断定は健康食品・エステではNG',
    suggestion: '「ボディメイクをサポート」「運動との併用で」',
  },
  {
    pattern: /(飲む|塗る|貼る|着る|履く)だけで(痩せ|やせ|細く)/,
    category: '薬機法',
    reason: '「〜するだけで痩せる」は効果の断定＋誇大表現でNG',
    suggestion: '「食生活の見直しと合わせて」「スタイルケアを習慣に」',
  },
  {
    pattern: /(完治|治る|治す|治り|治療効果)/,
    category: '薬機法',
    reason: '医療行為以外での「治る」系の表現はNG',
    suggestion: '「ケア」「サポート」「〜にアプローチ」',
  },
  {
    pattern: /(若返り|若返る|アンチエイジング)/,
    category: '薬機法',
    reason: '老化を戻す断定表現はNG（エイジングケアは「年齢に応じたケア」の注記が必要）',
    suggestion: '「エイジングケア※年齢に応じたケア」',
  },
  {
    pattern: /(デトックス|毒素(を|が)?排出)/,
    category: '薬機法',
    reason: '体内の毒素排出をうたう表現は根拠が示せずNG',
    suggestion: '「スッキリした毎日を」等の体感表現に',
  },
  {
    pattern: /免疫力?(が|を)?(上が|アップ|向上|高ま|高め)/,
    category: '薬機法',
    reason: '免疫への効果は医薬品的効能となりNG',
    suggestion: '「健康的な毎日をサポート」',
  },
  {
    pattern: /(育毛|発毛)(効果|する|できる)/,
    category: '薬機法',
    reason: '育毛・発毛の効果標榜は医薬部外品・医薬品以外ではNG',
    suggestion: '「頭皮環境を整える」「ヘアケア」',
  },
  {
    pattern: /血(液|流)(が|を)?サラサラ/,
    category: '薬機法',
    reason: '血流改善の断定は医薬品的効能となりNG',
  },
  {
    pattern: /細胞(レベル)?(から|を|が)?(活性化|再生|若返)/,
    category: '薬機法',
    reason: '細胞への作用の断定はNG',
  },

  // ---- 景表法（根拠のない最上級・断定的な効果保証） ----
  {
    pattern: /(No\.?\s?1|ナンバー\s?ワン|日本一|世界一|業界(No\.?\s?1|一|最高峰?))/i,
    category: '景表法',
    reason: 'No.1系表現は調査機関・調査期間の出典併記が必須（根拠なしはNG）',
    suggestion: '出典を併記できない場合は使わない',
  },
  {
    pattern: /(最安値|業界最安|地域最安)/,
    category: '景表法',
    reason: '最安の断定は常時の根拠が必要で原則NG',
    suggestion: '「お求めやすい価格」等',
  },
  {
    pattern: /(絶対|必ず|100[%％]|確実に)(痩せ|やせ|効く|効果|儲か|もうか|稼げ|受か|合格|成功|治)/,
    category: '景表法',
    reason: '効果・結果の断定保証（絶対/必ず/100%）はNG',
    suggestion: '「目指せる」「〜をサポート」＋「個人差があります」',
  },
  {
    pattern: /誰でも(簡単に)?(痩せ|やせ|稼げ|儲か|もうか|合格)/,
    category: '景表法',
    reason: '「誰でも〜できる」の断定は誇大表現でNG',
    suggestion: '「初心者の方も」「未経験からでも」',
  },
  {
    pattern: /効果(を|は)保証/,
    category: '景表法',
    reason: '効果の保証表現はNG',
  },
  {
    // 「1ヶ月で-5kg」「夏までに-10Kg」「マイナス3キロ」等。期間の有無・大文字小文字を問わず減量数値の訴求を検出
    pattern: /([−ー-]|マイナス)\s?[0-9０-９]+(\.[0-9０-９]+)?\s?(kg|キロ|㌔)/i,
    category: '景表法',
    reason: '減量数値の訴求はビフォーアフター的な効果断定でNG（体験談でも打消し表示が必要。体重計の数値表示素材も同様）',
    suggestion: '数値断定を避け「ダイエットをサポート」等に',
  },
  {
    // 「痩せたい（願望・悩み描写）」はOK、「痩せる/痩せた（断定）」はNG
    pattern: /(痩せる|やせる|痩せた(?!い)|やせた(?!い))/,
    category: '薬機法',
    reason: '「痩せる」の断定は生理的変化の標榜で審査NG（審査ツール基準でも即NG例）',
    suggestion: '「ダイエットをサポート」「理想の体型を目指す」',
  },
  {
    pattern: /(辛い|キツい|きつい|つらい)?(運動|食事制限)も?[^。\n]{0,12}(なし|不要|せず|しないで|ゼロ)/,
    category: '景表法',
    reason: '「運動・食事制限なし」は努力なしで効果が出る暗示となりNG（打消し表示があっても通りにくい）',
    suggestion: '「無理なく続けやすい」「生活に合わせたプランで」',
  },

  // ---- 金融・収益（誇大な収益の約束） ----
  {
    pattern: /元本保証/,
    category: '金融・収益',
    reason: '元本保証の表示は金融商品取引法上NG（預金等を除く）',
  },
  {
    pattern: /(月|日|年)収?[0-9０-９]+万円?(以上)?(確定|保証|稼げる|儲かる)/,
    category: '金融・収益',
    reason: '具体的金額の収益保証は誇大表現でNG',
    suggestion: '「収入アップを目指す」等（実績表示は根拠と注記が必要）',
  },
  {
    // 「毎月30万円を稼ぐ」等の金額×稼ぐ断定。「30万円稼ぐことを目指す」等の目標表現は除外（審査ツール緩和ナレッジ準拠）
    pattern: /[0-9０-９]+(万円?|桁)(を|も)?[^。\n]{0,4}(稼ぐ|稼げ|稼い|儲け|儲か)(?![^。\n]{0,10}(目指|目標))/,
    category: '金融・収益',
    reason: '具体的金額×「稼ぐ」の断定的表現はNG方向（「目指す」を付けた目標表現はOK）',
    suggestion: '「月30万円を目指せる」「実績例: 〜（個人差があります）」',
  },
  {
    pattern: /(素人|初心者|未経験|知識ゼロ|スキルなし)でも(簡単に)?(稼げ|儲か|もうか)/,
    category: '金融・収益',
    reason: '「素人でも稼げる」は誤解を招くビジネスモデル（Metaポリシー）でNG',
    suggestion: '「未経験からスタートできる環境」等に',
  },
  {
    pattern: /(放置|ほったらかし)で(稼げ|儲か|もうか|お金)/,
    category: '金融・収益',
    reason: '労力なしで稼げる表現はMeta広告ポリシー（誤解を招くビジネスモデル）でNG',
  },
  {
    pattern: /不労所得(で|が|を)?(稼げ|確実|保証|手に入)/,
    category: '金融・収益',
    reason: '不労所得の保証・断定はNG',
  },

  // ---- Metaポリシー（個人の属性・コンプレックスの断定・侮辱） ----
  // 注意: 「〜のあなたへ」「あなたの借金」等のターゲティング呼びかけはOK（審査ツール緩和ナレッジ準拠）
  //       → 「あなたは太っている」型の断定のみ検出する
  {
    pattern: /(あなた|お前|君)(は|って)(太って|デブ|ぽっちゃり|ハゲ|はげ|薄毛|ブス|老けて)/,
    category: 'Metaポリシー',
    reason: '閲覧者個人の身体的特徴を断定する表現はMetaポリシーNG',
    suggestion: '「〜が気になる方へ」と一般化する',
  },
  {
    pattern: /(デブ|ブス|負け組|情弱)/,
    category: 'Metaポリシー',
    reason: '侮辱・暴言にあたる語は審査ツール基準で即NG（過去の物語として使う場合も要注意）',
    suggestion: '「体型が気になる」「初心者」等の中立表現に',
  },

  // ---- 表現・素材（システム回避と見なされる表現） ----
  {
    pattern: /(〇〇|○○|××|✕✕|◯◯)/,
    category: '表現・素材',
    reason: '伏字はシステム回避と見なされ即NG（テンプレのプレースホルダ置換忘れにも注意）',
    suggestion: '実際の商品名・語句に置き換える',
  },

  // ---- 効能断定の追加パターン（審査ツールv8.6.0キラーロジック準拠） ----
  {
    pattern: /(激ヤセ|激やせ|飛ぶように痩せ|(一瞬|瞬時)で(細く|痩せ|やせ))/,
    category: '薬機法',
    reason: '急激な痩身効果の断定は即NG',
    suggestion: '「ダイエットをサポート」「ボディメイクを応援」',
  },
  {
    pattern: /(血糖値|血圧|コレステロール|中性脂肪)(が|を)?(下が|下げ|落と|落ち|改善)/,
    category: '薬機法',
    reason: '数値改善（血糖値・血圧等）の断定は医薬品的効能でNG（機能性表示食品でも表現に制約）',
    suggestion: '「健康値が気になる方へ」',
  },
  {
    pattern: /シミ(を|も)?消(す|せる|し)/,
    category: '薬機法',
    reason: '「シミを消す」は効能の断定で即NG',
    suggestion: '「目立ちにくい印象へ」',
  },
  {
    pattern: /みるみる(と)?(痩せ|やせ|消え|若返|治|落ち)/,
    category: '薬機法',
    reason: '「みるみる＋効能動詞」は効果の断定でNG（「みるみる」単体の熱量表現はOK）',
  },
];

/**
 * 複合判定ルール: 単体ではOKでも「組み合わせ」でNGになるパターン。
 * all の全正規表現がヒットした場合に警告する（フィールドを結合したテキスト全体で判定）。
 */
interface ComboRule {
  all: RegExp[];
  category: PolicyCategory;
  reason: string;
  suggestion?: string;
}

const COMBO_RULES: ComboRule[] = [
  {
    // 例: 「毎月30万円を稼ぐ秘訣」×「素人でも出来る！」
    all: [
      /[0-9０-９]+(万円?|桁)/,
      /(素人|初心者|未経験|誰|知識ゼロ|スキルなし)でも(簡単に)?(出来|でき|OK|大丈夫|可能)/,
      /(稼|儲|収入|収益|副業|月収|利益)/,
    ],
    category: '金融・収益',
    reason: '「具体的金額の収益」×「素人でも/誰でもできる」の組み合わせは、単体でOKでも誤解を招くビジネスモデル（Metaポリシー）としてNG',
    suggestion: '金額は「実績例＋個人差があります」に、容易性は「未経験からスタートできる環境」等に',
  },
];

/** 1テキストのNG表現を検出する（各ルール先頭ヒットのみ） */
export function checkAdPolicy(text: string): PolicyHit[] {
  if (!text) return [];
  const hits: PolicyHit[] = [];
  for (const rule of RULES) {
    const m = text.match(rule.pattern);
    if (m) {
      hits.push({
        matched: m[0],
        category: rule.category,
        reason: rule.reason,
        suggestion: rule.suggestion,
      });
    }
  }
  for (const rule of COMBO_RULES) {
    const matches = rule.all.map((re) => text.match(re)?.[0]);
    if (matches.every((m) => m != null)) {
      hits.push({
        matched: [...new Set(matches)].join('」×「'),
        category: rule.category,
        reason: rule.reason,
        suggestion: rule.suggestion,
      });
    }
  }
  return hits;
}

export interface FieldPolicyResult {
  label: string;
  hits: PolicyHit[];
}

/** 複数フィールド（メイン/サブ/その他テキスト）をまとめてチェック。ヒットがあるフィールドのみ返す */
export function checkAdCopyFields(fields: { label: string; text: string }[]): FieldPolicyResult[] {
  return fields
    .map((f) => ({ label: f.label, hits: checkAdPolicy(f.text) }))
    .filter((r) => r.hits.length > 0);
}

/**
 * コピー生成LLMへの抑制ガイド（プロンプト末尾に注入する）。
 * ※ プロンプトだけでは徹底されない（実測知見）ため、生成結果は必ず checkAdPolicy で機械チェックする。
 */
export const AD_POLICY_PROMPT_GUIDE = `
# 広告審査ガード（必須・最優先）
生成する全ての日本語コピーは、Meta広告審査・薬機法・景表法に抵触する表現を使わないこと:
- 生理的変化・効能の断定: 「痩せる」「激ヤセ」「血糖値が下がる」「シミが消える/消す」「治る」「脂肪燃焼」
- 効果の保証: 「必ず〜」「絶対に〜できる」「100%効果」「確実に儲かる」
- 根拠のない最上級: 「No.1」「日本一」「最安」（調査出典を併記できないため使わない）
- 誇大な結果の約束: 「誰でも月◯万円」「1ヶ月で-5kg」「元本保証」「飲むだけで痩せる」
- 閲覧者への断定・侮辱: 「あなたは太っている」「デブ」「ブス」「負け組」「情弱」
- 伏字: 「〇〇」「××」等はシステム回避と見なされNG
OKな表現の例: 「〜を目指せる」「〜をサポート」「〜が気になる方へ」「40代のあなたへ」（ターゲティング呼びかけはOK）、
「エイジングケア※年齢に応じたケア」など、断定を避けた適法表現を使うこと。`;
