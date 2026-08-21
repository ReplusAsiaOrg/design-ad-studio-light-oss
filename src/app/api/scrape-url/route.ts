import { NextRequest, NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import type { ScrapedPageData } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URLを入力してください' }, { status: 400 });
    }

    // URL validation
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('invalid protocol');
      }
    } catch {
      return NextResponse.json({ error: '有効なURLを入力してください' }, { status: 400 });
    }

    // Fetch with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    let html: string;
    try {
      const res = await fetch(parsedUrl.toString(), {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; BannerGenerator/1.0)',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'ja,en;q=0.9',
        },
      });
      if (!res.ok) {
        return NextResponse.json({ error: `ページの取得に失敗しました (${res.status})` }, { status: 400 });
      }
      html = await res.text();
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        return NextResponse.json({ error: 'タイムアウト: ページの取得に時間がかかりすぎました' }, { status: 400 });
      }
      return NextResponse.json({ error: 'ページの取得に失敗しました' }, { status: 400 });
    } finally {
      clearTimeout(timeout);
    }

    // OGタグはscript/style除去前に取得（cheerio.loadし直し不要）
    const $full = cheerio.load(html);
    const title = $full('meta[property="og:title"]').attr('content')
      || $full('title').text().trim()
      || '';
    const description = $full('meta[property="og:description"]').attr('content')
      || $full('meta[name="description"]').attr('content')
      || '';
    const ogImage = $full('meta[property="og:image"]').attr('content') || undefined;

    const $ = cheerio.load(html);

    // Remove script/style/nav/footer
    $('script, style, nav, footer, iframe, noscript').remove();

    // Hero texts: ページ冒頭のテキストブロックを順番に取得
    // LPのキャッチコピーは先頭付近の目立つテキスト要素にある
    const heroTexts: string[] = [];
    const bodyEl = $('main, article, [role="main"], .main, #main, body').first();
    // 全テキスト要素を DOM 順に走査し、冒頭のものを拾う
    bodyEl.find('h1, h2, h3, h4, p, div, span, li, strong, em').each((_, el) => {
      if (heroTexts.length >= 15) return false; // 十分な量を取得したら終了
      const $el = $(el);
      // 子要素にさらにテキスト要素がある場合はスキップ（末端のみ）
      if ($el.children('h1, h2, h3, h4, p, div, span, strong, em').length > 0 &&
          $el.children().length > 0 &&
          $el.contents().filter(function() { return this.type === 'text' && $(this).text().trim().length > 0; }).length === 0) {
        return;
      }
      const text = $el.text().trim().replace(/\s+/g, ' ');
      if (text && text.length >= 4 && text.length <= 80 && !heroTexts.includes(text)) {
        heroTexts.push(text);
      }
    });

    // Hero images: ページ冒頭の画像URL（キャッチコピーが画像に含まれている場合がある）
    const heroImageUrls: string[] = [];
    const baseUrl = parsedUrl.origin;
    bodyEl.find('img').each((_, el) => {
      if (heroImageUrls.length >= 5) return false;
      let src = $(el).attr('src') || '';
      if (!src) return;
      // 相対URLを絶対URLに変換
      if (src.startsWith('//')) src = 'https:' + src;
      else if (src.startsWith('/')) src = baseUrl + src;
      else if (!src.startsWith('http')) {
        try { src = new URL(src, parsedUrl.toString()).toString(); } catch { return; }
      }
      // 小さいアイコン・トラッキングピクセルを除外
      const width = parseInt($(el).attr('width') || '0', 10);
      const height = parseInt($(el).attr('height') || '0', 10);
      if ((width > 0 && width < 50) || (height > 0 && height < 50)) return;
      // data: URIやSVGを除外
      if (src.startsWith('data:') || src.endsWith('.svg')) return;
      if (!heroImageUrls.includes(src)) {
        heroImageUrls.push(src);
      }
    });

    // Headings
    const headings: string[] = [];
    $('h1, h2, h3').each((_, el) => {
      const text = $(el).text().trim().replace(/\s+/g, ' ');
      if (text && text.length <= 100 && !headings.includes(text)) {
        headings.push(text);
      }
    });

    // CTA texts
    const ctaTexts: string[] = [];
    $('a, button').each((_, el) => {
      const text = $(el).text().trim().replace(/\s+/g, ' ');
      if (text && text.length >= 2 && text.length <= 30 && !ctaTexts.includes(text)) {
        // CTA-like keywords
        if (/申し込|購入|詳しく|無料|お問|資料|ダウンロード|登録|予約|体験|見積|カート|注文|今すぐ|始め|試し|相談|entry|submit|buy|order|contact|free|start|sign|book|get/i.test(text)) {
          ctaTexts.push(text);
        }
      }
    });

    // Body text summary (first ~500 chars of visible text)
    const bodyText = $('main, article, [role="main"], .main, #main, body')
      .first()
      .text()
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 800);

    // Extract colors from inline styles and CSS
    const primaryColors: string[] = [];
    const colorRegex = /#[0-9a-fA-F]{6}\b/g;
    // Check inline styles on key elements
    $('[style]').each((_, el) => {
      const style = $(el).attr('style') || '';
      const matches = style.match(colorRegex);
      if (matches) {
        matches.forEach(c => {
          if (!primaryColors.includes(c) && primaryColors.length < 5) {
            // Skip near-white and near-black
            const r = parseInt(c.slice(1, 3), 16);
            const g = parseInt(c.slice(3, 5), 16);
            const b = parseInt(c.slice(5, 7), 16);
            if (r + g + b > 50 && r + g + b < 700) {
              primaryColors.push(c);
            }
          }
        });
      }
    });
    // Also check theme-color meta
    const themeColor = $('meta[name="theme-color"]').attr('content');
    if (themeColor && /^#[0-9a-fA-F]{6}$/.test(themeColor) && !primaryColors.includes(themeColor)) {
      primaryColors.unshift(themeColor);
    }

    const data: ScrapedPageData = {
      url: parsedUrl.toString(),
      title,
      description,
      ogImage,
      heroImageUrls: heroImageUrls.slice(0, 5),
      heroTexts: heroTexts.slice(0, 15),
      headings: headings.slice(0, 10),
      ctaTexts: ctaTexts.slice(0, 5),
      bodyTextSummary: bodyText.slice(0, 500),
      primaryColors: primaryColors.slice(0, 5),
    };

    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
