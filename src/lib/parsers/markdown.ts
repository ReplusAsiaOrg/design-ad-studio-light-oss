import type { ScrapedPageData } from '@/lib/types';

export interface ParsedMarkdown {
  data: ScrapedPageData;
  /** 抽出した frontmatter (key→value, すべて文字列) */
  frontmatter: Record<string, string>;
  /** 抽出したセクション名 → 本文（生Markdownのまま） */
  sections: Record<string, string>;
}

/**
 * /lp-ingest スキルが出す構造化 Markdown を ScrapedPageData に変換する。
 * URL タブが期待する形に合流させるのが目的なので、画像URLや色は空でよい。
 */
export function parseMarkdownToScrapedPageData(text: string, filename?: string): ParsedMarkdown {
  const { frontmatter, body } = extractFrontmatter(text);
  const sections = extractSections(body);

  const title =
    frontmatter.title?.trim() ||
    extractH1(body) ||
    (filename ? filename.replace(/\.(md|markdown|txt)$/i, '') : '') ||
    'Untitled';

  const url = frontmatter.url?.trim() || '';

  const heroSection = pickSection(sections, ['ヘッドコピー', 'FV', 'ファーストビュー', 'キャッチコピー']);
  const subSection = pickSection(sections, ['サブコピー', '第二訴求', 'サブヘッド']);
  const targetSection = pickSection(sections, ['ターゲット', 'こんな方', 'CONCERN', 'お悩み']);
  const offerSection = pickSection(sections, ['オファー', '特典', '提供価値']);
  const ctaSection = pickSection(sections, ['CTA', 'ボタン', '行動喚起']);

  const heroTexts = toFlatLines(heroSection)
    .concat(toFlatLines(subSection))
    .filter(t => t.length >= 2 && t.length <= 80)
    .slice(0, 15);

  const description = condenseToOneLine(subSection) || condenseToOneLine(heroSection) || '';

  const headings = Object.keys(sections).slice(0, 10);

  const ctaTexts = extractCtaTexts(ctaSection, targetSection, offerSection).slice(0, 5);

  const bodyTextSummary = stripMarkdown(body).replace(/\s+/g, ' ').trim().slice(0, 800);

  const data: ScrapedPageData = {
    url,
    title,
    description: description.slice(0, 200),
    ogImage: undefined,
    heroImageUrls: [],
    heroTexts,
    headings,
    ctaTexts,
    bodyTextSummary: bodyTextSummary.slice(0, 500),
    primaryColors: [],
  };

  return { data, frontmatter, sections };
}

function extractFrontmatter(text: string): { frontmatter: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { frontmatter: {}, body: text };
  const fm: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return { frontmatter: fm, body: text.slice(m[0].length) };
}

function extractH1(body: string): string {
  const m = /^#\s+(.+?)\s*$/m.exec(body);
  return m ? m[1].trim() : '';
}

/**
 * `## 見出し` でセクション分割。`### ...` は親セクションに含めたまま残す。
 * 同じ名前の見出しが複数あれば後ろを上書き（実用上問題ない）。
 */
function extractSections(body: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = body.split(/\r?\n/);
  let currentName: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (currentName !== null) {
      sections[currentName] = buf.join('\n').trim();
    }
  };
  for (const line of lines) {
    const h2 = /^##\s+(.+?)\s*$/.exec(line);
    if (h2) {
      flush();
      currentName = h2[1].trim();
      buf = [];
      continue;
    }
    if (currentName !== null) buf.push(line);
  }
  flush();
  return sections;
}

function pickSection(sections: Record<string, string>, keywords: string[]): string {
  for (const name of Object.keys(sections)) {
    if (keywords.some(kw => name.includes(kw))) {
      return sections[name];
    }
  }
  return '';
}

/**
 * セクション本文を「キャッチコピー候補の行」リストに展開する。
 * - リストマーカー（- / * / ・ / ☑ など）、強調記号（** __）、見出し記号を剥がす
 * - 空行で連結された段落は1行に詰める
 * - 段落内の改行は別エントリ扱い（FVは複数行で1つのコピーになるが、候補としては行ごとに分けたほうが扱いやすい）
 */
function toFlatLines(section: string): string[] {
  if (!section) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of section.split(/\r?\n/)) {
    const cleaned = stripInlineMarkdown(rawLine);
    if (!cleaned) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

function condenseToOneLine(section: string): string {
  return toFlatLines(section).join(' / ');
}

function extractCtaTexts(...sources: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const ctaHints = /(申し込|今すぐ|無料|参加|登録|追加|公式LINE|公式ライン|相談|ダウンロード|資料|予約|体験)/;
  for (const src of sources) {
    if (!src) continue;
    for (const line of toFlatLines(src)) {
      // 「ボタン文言:」「ボタン上文言:」のようなラベル＋値を分解
      const labeled = /^(?:ボタン上文言|ボタン文言|ボタン)[\s：:]+(.+)$/.exec(line);
      const candidate = labeled ? labeled[1].trim() : line;
      if (candidate.length < 2 || candidate.length > 30) continue;
      if (!ctaHints.test(candidate)) continue;
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      out.push(candidate);
    }
  }
  return out;
}

function stripInlineMarkdown(line: string): string {
  let s = line;
  // 水平線 (---, ***, ___) は除外
  if (/^\s*([-*_])\1\1+\s*$/.test(s)) return '';
  s = s.replace(/^\s*[-*+]\s+/, ''); // list marker
  s = s.replace(/^\s*[・☑✓✔]+\s*/, ''); // 日本語チェックマーカー
  s = s.replace(/^#+\s+/, ''); // heading marker (## などは extractSections で消えるが ### は残る)
  s = s.replace(/\*\*(.+?)\*\*/g, '$1'); // bold
  s = s.replace(/__(.+?)__/g, '$1');
  s = s.replace(/\*(.+?)\*/g, '$1'); // italic
  s = s.replace(/`([^`]+)`/g, '$1'); // inline code
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // links → text
  s = s.replace(/^>\s+/, ''); // blockquote
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function stripMarkdown(body: string): string {
  return body
    .replace(/^---[\s\S]*?---\r?\n/, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_`|]/g, ' ');
}
