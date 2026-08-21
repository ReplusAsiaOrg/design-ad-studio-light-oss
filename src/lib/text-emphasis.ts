/**
 * メインテキスト・サブテキストのメリハリを出すための解析モジュール。
 * AIに「具体的にどの文字を小さく/強調するか」を明示的に渡すことで、
 * 抽象指示では破られがちな日本語タイポグラフィのルールを強制する。
 */

export type EmphasisAnalysis = {
  particles: { particle: string; count: number }[];
  emphasized: string[];
};

// 長い助詞を先に判定して部分一致誤検出を避ける（から→か、まで→ま 等の誤判定防止）
const PARTICLES_LONG = ['から', 'まで', 'より', 'なら', 'って'] as const;
// 「か」は「分かる」「赤い」「向かう」など動詞・形容詞に多く誤検出されるため除外
const PARTICLES_SHORT = ['の', 'を', 'に', 'は', 'が', 'で', 'と', 'も', 'へ', 'や'] as const;
const ALL_PARTICLES = [...PARTICLES_LONG, ...PARTICLES_SHORT] as const;

/**
 * 鉤括弧『...』「...」内の範囲を「除外マスク」として返す。
 * 助詞検出が括弧内の文字を二重カウントしないようにする。
 */
function buildBracketMask(text: string): boolean[] {
  const mask = new Array(text.length).fill(false);
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '「' || c === '『') {
      depth++;
      mask[i] = true;
      continue;
    }
    if (c === '」' || c === '』') {
      mask[i] = true;
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth > 0) mask[i] = true;
  }
  return mask;
}

/**
 * 助詞を順次走査で検出する。
 * 長い助詞から優先マッチして、マッチ済み位置はスキップ。
 * 鉤括弧内は強調語として別扱いするため助詞検出からは除外する。
 */
function detectParticles(text: string): { particle: string; count: number }[] {
  const counts = new Map<string, number>();
  const matched = new Array(text.length).fill(false);
  const excluded = buildBracketMask(text);

  // 長い助詞を先に検出
  for (const p of PARTICLES_LONG) {
    let idx = 0;
    while ((idx = text.indexOf(p, idx)) !== -1) {
      // 鉤括弧内 or マッチ済みの範囲と重なる場合はスキップ
      const range = matched.slice(idx, idx + p.length);
      const exRange = excluded.slice(idx, idx + p.length);
      if (!range.some(Boolean) && !exRange.some(Boolean)) {
        for (let i = idx; i < idx + p.length; i++) matched[i] = true;
        counts.set(p, (counts.get(p) ?? 0) + 1);
      }
      idx += p.length;
    }
  }

  // 短い助詞を検出
  for (const p of PARTICLES_SHORT) {
    let idx = 0;
    while ((idx = text.indexOf(p, idx)) !== -1) {
      if (!matched[idx] && !excluded[idx]) {
        matched[idx] = true;
        counts.set(p, (counts.get(p) ?? 0) + 1);
      }
      idx += p.length;
    }
  }

  // 出現順を保つため text 走査順で並べ直す
  const result: { particle: string; count: number }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < text.length; i++) {
    for (const p of ALL_PARTICLES) {
      if (text.startsWith(p, i) && counts.has(p) && !seen.has(p)) {
        result.push({ particle: p, count: counts.get(p)! });
        seen.add(p);
      }
    }
  }
  return result;
}

/**
 * 強調すべき語を検出する。
 * - 鉤括弧「」『』内の文字列
 * - 半角/全角数字を含む語（後続の名詞も含めて取り込む）
 * - カタカナ4文字以上の連続（固有名詞・サービス名等）
 */
function detectEmphasized(text: string): string[] {
  const emphasized: string[] = [];

  // 鉤括弧内（カギ括弧自体を含めて表記）。種別ごとに分離してネスト誤検出を避ける
  const bracketRegex = /「[^「」]*」|『[^『』]*』/g;
  let m: RegExpExecArray | null;
  while ((m = bracketRegex.exec(text)) !== null) {
    emphasized.push(m[0]);
  }

  // 数字を含む語: 通貨記号 + 数字（カンマ・小数点込み）+ 後続の単位（漢字/カタカナ最大2文字）
  // 例: "3ヶ月" "15名様" "100円" "198,000円" "¥198,000" "1.5倍"
  const numRegex = /[¥￥]?[0-9０-９][0-9０-９,，.．]*[一-龯ヵヶー]{0,2}/g;
  while ((m = numRegex.exec(text)) !== null) {
    const word = m[0];
    if (word) emphasized.push(word);
  }

  // カタカナ4文字以上の連続（固有名詞・サービス名）
  const kataRegex = /[ァ-ヴー]{4,}/g;
  while ((m = kataRegex.exec(text)) !== null) {
    emphasized.push(m[0]);
  }

  // 重複削除（出現順保持）
  const seen = new Set<string>();
  return emphasized.filter(w => {
    if (seen.has(w)) return false;
    seen.add(w);
    return true;
  });
}

export function analyzeTextEmphasis(text: string): EmphasisAnalysis {
  if (!text || !text.trim()) {
    return { particles: [], emphasized: [] };
  }
  return {
    particles: detectParticles(text),
    emphasized: detectEmphasized(text),
  };
}

/**
 * プロンプト用の英文ディレクティブを生成する。
 * 助詞も強調語も検出されなかった場合は null を返す（プロンプトに不要な情報を追加しないため）。
 */
export function buildEmphasisDirective(text: string, label: string): string | null {
  if (!text || !text.trim()) return null;
  const { particles, emphasized } = analyzeTextEmphasis(text);
  if (particles.length === 0 && emphasized.length === 0) return null;

  const lines: string[] = [];
  lines.push(`- [CRITICAL] ${label} typography for 「${text}」:`);

  if (particles.length > 0) {
    const particleList = particles
      .map(p => p.count > 1 ? `${p.particle} (×${p.count})` : p.particle)
      .join(', ');
    lines.push(`  - Particles to shrink to 55-65% of base size: ${particleList}`);
  }

  if (emphasized.length > 0) {
    lines.push(`  - Words to emphasize (110-120% size, bolder weight, optionally tinted with accent color): ${emphasized.join(', ')}`);
  }

  lines.push(`  - All other characters at base size`);
  lines.push(`  - This size variation is MANDATORY — do NOT render the text uniformly`);

  return lines.join('\n');
}
