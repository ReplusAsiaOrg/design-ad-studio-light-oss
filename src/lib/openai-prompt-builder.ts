import { BannerFormData, ASPECT_RATIO_DIMENSIONS, getBannerDimensions, hasValidCustomSize } from './types';
import { buildEmphasisDirective } from './text-emphasis';
import type { MoodClassification } from './mood-classifier';

// ============================================================
// Design Mood System — テキスト内容からデザインの方向性を自動推定
// ============================================================

interface DesignMood {
  id: string;
  fontMain: string;
  fontSub: string;
  fontOther: string;
  decoration: string;
  background: string;
  style: string;
  theme: string;
}

const MOOD_RULES: { pattern: RegExp; mood: DesignMood }[] = [
  // --- セール・プロモーション ---
  {
    pattern: /セール|割引|%OFF|半額|特価|お得|キャンペーン|バーゲン|期間限定|数量限定|今だけ|タイムセール|大特価|激安/i,
    mood: {
      id: 'sale',
      fontMain: 'extra-bold, heavy-weight Gothic/sans-serif with maximum impact — like a Japanese sale flyer headline. Thick, compressed, attention-grabbing',
      fontSub: 'bold Gothic/sans-serif, slightly rounded for friendliness',
      fontOther: 'bold sans-serif with high contrast',
      decoration: 'Starburst/explosion shapes, bold zigzag ribbons, price-tag badges, diagonal sashes, bold bordered frames. Use high-contrast yellow/red accents. Add motion lines or speed effects for urgency. Spot illustrations: shopping bags, gift boxes, coins, percent symbols, megaphone icons scattered around edges',
      background: 'Vivid red, yellow, or orange backgrounds with radial burst patterns, diagonal stripes, or checkerboard accents. High energy and dynamic',
      style: 'Pop, energetic, high-impact, eye-catching Japanese sale/flyer style',
      theme: 'sale / promotion — urgency, excitement, and irresistible deals',
    },
  },
  // --- 自然・オーガニック ---
  {
    pattern: /有機|オーガニック|自然栽培|無農薬|天然|ナチュラル|農園|農家|畑|収穫|産直|朝採り/i,
    mood: {
      id: 'natural',
      fontMain: 'warm, rounded sans-serif typeface (like Zen Maru Gothic) — soft, friendly, handcraft feel. Medium-bold weight, NOT sharp or rigid',
      fontSub: 'rounded sans-serif, gentle weight — approachable and warm',
      fontOther: 'soft rounded sans-serif, readable and warm',
      decoration: 'Hand-drawn style leaf/plant icons, watercolor splashes, natural texture stamps, rustic kraft-paper elements, botanical line art. Avoid hard geometric shapes',
      background: 'Earth tones, warm greens, soft sunlight, rustic wood or kraft paper textures, natural photography with warm lighting. Soft and organic feel',
      style: 'Warm, organic, natural, handcraft feel — like a farmers market poster',
      theme: 'natural / organic — wholesome, fresh, and trustworthy',
    },
  },
  // --- 食・グルメ ---
  {
    pattern: /食[^堂]|レストラン|カフェ|グルメ|料理|ランチ|ディナー|弁当|デリバリー|テイクアウト|おいしい|美味|焼肉|寿司|ラーメン|パスタ|スイーツ|ケーキ|パン/i,
    mood: {
      id: 'food',
      fontMain: 'warm, slightly rounded bold sans-serif — appetizing and inviting. Generous letter-spacing for readability',
      fontSub: 'medium-weight rounded sans-serif, friendly',
      fontOther: 'clean sans-serif, readable',
      decoration: 'Warm spotlight/glow effects, subtle steam/aroma wisps, appetizing color accents (warm red, orange, golden yellow). Simple frames or banners with rounded corners. Spot illustrations: fork/spoon icons, small food doodles, steam swirls, plate/bowl motifs',
      background: 'Warm-toned photography style, rich and appetizing lighting, shallow depth-of-field feel, warm wood/table textures or clean kitchen backgrounds',
      style: 'Appetizing, warm, inviting Japanese food advertisement style',
      theme: 'food / gourmet — delicious, fresh, and mouth-watering',
    },
  },
  // --- 野菜・青果（自然寄りだが食カテゴリ） ---
  {
    pattern: /野菜|果物|フルーツ|お試しセット|詰め合わせ|旬|新鮮/i,
    mood: {
      id: 'fresh-produce',
      fontMain: 'warm, rounded bold sans-serif (like Zen Maru Gothic) — fresh and friendly, handwritten feel. NOT rigid or corporate',
      fontSub: 'rounded sans-serif with playful weight',
      fontOther: 'soft rounded sans-serif',
      decoration: 'Hand-drawn style vegetable/fruit doodles, leaf motifs, watercolor splashes, natural texture elements, sticker-like badges with rounded edges. Playful and organic',
      background: 'Fresh, bright natural colors — green fields, blue sky, warm sunlight. Natural photography or soft watercolor-style backgrounds',
      style: 'Fresh, natural, friendly — like a local farm shop poster with handmade charm',
      theme: 'fresh produce — wholesome, natural, and vibrant',
    },
  },
  // --- 美容・ウェルネス ---
  {
    pattern: /美容|ヘア|サロン|エステ|ネイル|コスメ|スキンケア|化粧品|メイク|ウェルネス|ヨガ|リラク|マッサージ|癒し|アロマ/i,
    mood: {
      id: 'beauty',
      fontMain: 'elegant, thin-to-medium weight sans-serif or light serif — clean, refined, and feminine. Generous tracking/letter-spacing',
      fontSub: 'light serif or thin sans-serif, delicate and elegant',
      fontOther: 'thin, clean sans-serif',
      decoration: 'Floral motifs, botanical line art, soft gradient overlays, delicate thin borders, petal/sparkle accents. Minimal and refined. Spot illustrations: small flowers, leaf sprigs, water droplets, butterfly silhouettes, gentle sparkles',
      background: 'Soft pastels (blush pink, lavender, cream), clean white space, subtle floral or bokeh backgrounds, airy and luminous',
      style: 'Elegant, clean, feminine, refined beauty/salon advertisement style',
      theme: 'beauty / wellness — refined, calming, and aspirational',
    },
  },
  // --- 高級・プレミアム ---
  {
    pattern: /高級|プレミアム|限定|VIP|ラグジュアリー|上質|厳選|本格|贅沢|至高|極上|特撰/i,
    mood: {
      id: 'luxury',
      fontMain: 'elegant bold serif/Mincho typeface with refined weight — luxurious and authoritative. Gold or silver text effects with dimensional shine',
      fontSub: 'medium-weight serif, elegant with subtle letter-spacing',
      fontOther: 'thin serif or clean sans-serif, understated luxury',
      decoration: 'Thin gold/silver line borders, elegant frames, subtle metallic shine, minimal ornamental lines. NO flashy ribbons or starburst shapes',
      background: 'Dark backgrounds (deep black, navy, or dark green) with gold/champagne accents, subtle texture, or sophisticated gradient. Rich and premium',
      style: 'Luxury, premium, elegant, refined — like a high-end brand advertisement',
      theme: 'luxury / premium — exclusive, sophisticated, and aspirational',
    },
  },
  // --- テック・IT ---
  {
    pattern: /IT|AI|Web|デジタル|テック|プログラミング|SaaS|クラウド|DX|アプリ|システム|開発|エンジニア/i,
    mood: {
      id: 'tech',
      fontMain: 'clean, geometric sans-serif — modern and sharp. Medium-bold weight with tight tracking',
      fontSub: 'light sans-serif, clean and modern',
      fontOther: 'geometric sans-serif, minimal',
      decoration: 'Geometric shapes, subtle grid patterns, circuit-like line art, gradient overlays, minimal glowing accents. Clean and structured. Spot illustrations: cursor arrows, gear icons, code brackets, circuit dots, floating UI elements',
      background: 'Dark gradients (deep blue to purple, or dark blue to black) with subtle glow effects, geometric patterns, or abstract tech-inspired visuals',
      style: 'Modern, tech, futuristic, clean digital style',
      theme: 'technology — innovative, cutting-edge, and professional',
    },
  },
  // --- 教育・スクール ---
  {
    pattern: /講習|塾|学校|進学|受験|入学|学生|教育|授業|スクール|セミナー|講座|資格|学習|勉強|合格/i,
    mood: {
      id: 'education',
      fontMain: 'clear, trustworthy bold sans-serif — professional yet approachable. Strong but not aggressive',
      fontSub: 'medium-weight sans-serif, clean and readable',
      fontOther: 'clean sans-serif, straightforward',
      decoration: 'Clean geometric badges, simple bordered frames, checkmark/star motifs, notebook-ruled-line accents. Organized and trustworthy. Spot illustrations: pencil, open book, graduation cap, lightbulb, star/medal icons, notebook doodles',
      background: 'Blue, green, or warm yellow tones — academic and trustworthy. Clean gradients or subtle pattern backgrounds with good readability',
      style: 'Academic, trustworthy, approachable Japanese education/cram school advertisement style',
      theme: 'education — motivating, trustworthy, and supportive',
    },
  },
  // --- エンタメ・配信 ---
  {
    pattern: /音楽|ライブ|コンサート|フェス|DJ|配信|雑談|ゲーム|実況|コラボ|イベント|パーティ|エンタメ/i,
    mood: {
      id: 'entertainment',
      fontMain: 'dynamic, playful bold display font — energetic and fun with character. Slightly tilted or with motion feel',
      fontSub: 'bold rounded sans-serif, pop and cute',
      fontOther: 'rounded sans-serif, playful',
      decoration: 'Neon glow effects, sparkle/star accents, dynamic shapes, music notes or game-related motifs, light streaks, confetti. Energetic and fun',
      background: 'Vibrant gradients (purple-pink, blue-cyan), neon accents, dynamic light effects, party/stage atmosphere',
      style: 'Dynamic, vibrant, pop, energetic entertainment/streaming style',
      theme: 'entertainment — exciting, fun, and engaging',
    },
  },
  // --- 募集・採用 ---
  {
    pattern: /募集|採用|求人|スタッフ|バイト|パート|正社員|メンバー|仲間|一緒に|チーム/i,
    mood: {
      id: 'recruitment',
      fontMain: 'friendly, bold rounded sans-serif — warm, inviting, and approachable. NOT intimidating or corporate',
      fontSub: 'medium-weight rounded sans-serif, warm',
      fontOther: 'rounded sans-serif, friendly',
      decoration: 'Speech bubbles, warm-toned badges, soft bordered frames. Welcoming and positive. Spot illustrations: megaphone, thumbs-up, smile faces, handshake, briefcase, welcome hand-wave icons',
      background: 'Bright, warm colors (orange, sky blue, light green), open and inviting feel, subtle pattern or clean gradient backgrounds',
      style: 'Friendly, warm, inviting Japanese recruitment advertisement style',
      theme: 'recruitment — welcoming, positive, and opportunity-filled',
    },
  },
  // --- 旅行・観光 ---
  {
    pattern: /旅行|ツアー|観光|ホテル|トラベル|温泉|宿|リゾート|海外|国内旅行/i,
    mood: {
      id: 'travel',
      fontMain: 'clean, adventurous bold sans-serif — open and exciting with generous letter-spacing',
      fontSub: 'medium sans-serif, clean and inviting',
      fontOther: 'clean sans-serif',
      decoration: 'Scenic framing, compass/map motifs, airplane/travel icons, postcard-style borders, stamp effects. Adventurous yet clean',
      background: 'Scenic blue sky, ocean, landscapes, vivid travel photography, bright and open compositions',
      style: 'Adventurous, scenic, exciting travel/tourism advertisement style',
      theme: 'travel — inspiring, exciting, and aspirational',
    },
  },
  // --- ファッション ---
  {
    pattern: /ファッション|アパレル|コーデ|ブランド|トレンド|新作|コレクション|着こなし|LOOK|STYLE/i,
    mood: {
      id: 'fashion',
      fontMain: 'stylish, editorial sans-serif — thin to medium weight, modern and chic. Wide letter-spacing for editorial feel',
      fontSub: 'thin sans-serif, editorial and minimal',
      fontOther: 'thin sans-serif, understated',
      decoration: 'Minimal decorations — thin lines, editorial layouts, clean borders. Fashion magazine aesthetic. Less is more',
      background: 'Clean white/black editorial backgrounds, or muted fashion photography, accent colors used sparingly',
      style: 'Stylish, editorial, minimal, trendy fashion magazine advertisement style',
      theme: 'fashion — chic, modern, and trendsetting',
    },
  },
  // --- 季節: 夏 ---
  {
    pattern: /夏|サマー|summer|ひまわり|海水浴|花火|祭り|納涼|冷やし|かき氷/i,
    mood: {
      id: 'summer',
      fontMain: 'bold, refreshing sans-serif — bright and energetic with clean edges',
      fontSub: 'medium-weight sans-serif, fresh and clean',
      fontOther: 'clean sans-serif',
      decoration: 'Sun, wave, hibiscus motifs, water splash effects, tropical leaf accents, firework sparkles. Refreshing and bright. Spot illustrations: sunglasses, ice cream, watermelon slice, beach ball, seashell, palm tree icons',
      background: 'Bright blue sky, ocean, tropical colors, vivid yellow/cyan/white, refreshing and summery',
      style: 'Bright, refreshing, energetic Japanese summer campaign style',
      theme: 'summer — bright, refreshing, and energetic',
    },
  },
  // --- 季節: 冬・年末年始 ---
  {
    pattern: /冬|ウィンター|winter|クリスマス|年末|年始|お正月|新年|雪|初売/i,
    mood: {
      id: 'winter',
      fontMain: 'elegant serif or bold sans-serif with seasonal warmth — festive and special',
      fontSub: 'medium serif or clean sans-serif, warm feel',
      fontOther: 'clean serif or sans-serif',
      decoration: 'Snowflake motifs, warm candle/light glow, pine/holly accents, gift ribbon decorations, festive sparkles. Warm yet wintry. Spot illustrations: snowflakes, gift boxes, Christmas ornaments, mittens, hot cocoa, bells',
      background: 'Cool blue/white or warm red/gold (depending on Christmas vs New Year), cozy indoor lighting, snowfall effects',
      style: 'Festive, seasonal, warm Japanese winter/holiday style',
      theme: 'winter — festive, cozy, and special',
    },
  },
  // --- 季節: 春 ---
  {
    pattern: /春|スプリング|spring|桜|新生活|新学期|新社会人|卒業|入園/i,
    mood: {
      id: 'spring',
      fontMain: 'soft, fresh sans-serif or light rounded typeface — gentle and optimistic',
      fontSub: 'light rounded sans-serif, fresh feel',
      fontOther: 'soft sans-serif, clean',
      decoration: 'Cherry blossom petals, fresh green leaf motifs, soft floral accents, gentle sparkles. Light and airy. Spot illustrations: sakura petals, butterflies, young leaves, small birds, ribbon bows',
      background: 'Soft pink/green, cherry blossom imagery, fresh spring light, airy and bright',
      style: 'Fresh, gentle, optimistic Japanese spring campaign style',
      theme: 'spring — new beginnings, fresh, and hopeful',
    },
  },
  // --- 季節: 秋 ---
  {
    pattern: /秋|オータム|autumn|紅葉|ハロウィン|収穫祭|食欲の秋|読書の秋/i,
    mood: {
      id: 'autumn',
      fontMain: 'warm, slightly rounded serif or bold sans-serif — cozy and rich',
      fontSub: 'medium-weight serif or rounded sans-serif, warm',
      fontOther: 'warm sans-serif',
      decoration: 'Autumn leaf motifs, warm-toned frames, harvest/pumpkin accents, wood texture elements. Rich and cozy',
      background: 'Warm orange/brown/deep red/gold tones, autumn scenery, warm lighting, cozy atmosphere',
      style: 'Warm, cozy, rich Japanese autumn campaign style',
      theme: 'autumn — warm, harvest, and nostalgic',
    },
  },
  // --- かわいい・キッズ ---
  {
    pattern: /かわいい|キュート|女子|ガール|ベビー|赤ちゃん|ママ|子供|こども|キッズ|親子|保育|幼稚園/i,
    mood: {
      id: 'cute',
      fontMain: 'rounded, bubbly bold sans-serif (like M PLUS Rounded or Kosugi Maru) — cute, pop, and playful',
      fontSub: 'rounded sans-serif, cute and friendly',
      fontOther: 'rounded sans-serif, playful',
      decoration: 'Hearts, stars, sparkles, pastel circles, confetti, hand-drawn doodle-style stickers, ribbon bows. Playful and cute',
      background: 'Pastel colors (soft pink, mint, lavender, light yellow), polka dots or soft patterns, playful and kawaii',
      style: 'Cute, pop, playful, kawaii Japanese style',
      theme: 'cute / kids — adorable, fun, and heartwarming',
    },
  },
];

/** デフォルトのムード（どのパターンにもマッチしない場合） */
const DEFAULT_MOOD: DesignMood = {
  id: 'default',
  fontMain: 'bold, impactful Gothic/sans-serif — strong and readable with thick outlines for contrast',
  fontSub: 'bold Gothic/sans-serif, readable',
  fontOther: 'clean sans-serif, legible',
  decoration: 'Clean badges, subtle gradient ribbons, light shadow effects. Professional and balanced — choose decorations appropriate to the content',
  background: 'Professional gradient or textured background with depth. Avoid flat solid colors — use subtle patterns, light rays, or gradient for a polished look',
  style: 'Professional, impactful Japanese advertising banner style',
  theme: 'impactful and professional',
};

/** テキスト全体からデザインムードを推定（キーワードマッチ・フォールバック用） */
function inferDesignMood(formData: BannerFormData): DesignMood {
  const all = [formData.mainText, formData.subText, ...formData.extraTexts.map(t => t.text)]
    .filter(Boolean)
    .join(' ');

  if (!all.trim()) return DEFAULT_MOOD;

  for (const rule of MOOD_RULES) {
    if (rule.pattern.test(all)) return rule.mood;
  }
  return DEFAULT_MOOD;
}

/** moodIdから該当ムードを取得（AI判定結果を使う時用） */
function getMoodById(id: string): DesignMood {
  if (id === 'default') return DEFAULT_MOOD;
  const rule = MOOD_RULES.find(r => r.mood.id === id);
  return rule ? rule.mood : DEFAULT_MOOD;
}

/**
 * OpenAI（GPT-image-1）用のプロンプトを構築する。
 * 指示部分は英語、表示テキストは日本語のまま。
 */
export function buildOpenAIPrompt(
  formData: BannerFormData,
  translatedCustomPrompt?: string,
  moodClassification?: MoodClassification | null,
): string {
  const { mainText, subText, subTextDecoration, extraTexts, mainColor, aspectRatio, fontStyle, customPrompt, referenceImageBase64, referenceImageMode, logoImageBase64, logoPosition } = formData;
  // 人物: personMode 優先、未指定なら hasPersons からフォールバック
  const personMode = formData.personMode ?? (formData.hasPersons ? 'yes' : 'auto');
  const wantsPerson = personMode === 'yes';
  // 翻訳済みカスタム指示があればそちらを使う
  const effectiveCustomPrompt = applyMainColorToCustomPrompt(scrubStaleQuotedTexts(translatedCustomPrompt ?? customPrompt, { mainText, subText, extraTexts }), mainColor);
  const hasReferenceImage = !!referenceImageBase64;
  // clone はこのビルダーに来る前に generate-core で専用処理される。来た場合は asset 扱い。
  const refMode: 'style' | 'asset' = referenceImageMode === 'style' ? 'style' : 'asset';
  const isStyleRef = hasReferenceImage && refMode === 'style';
  const isAssetRef = hasReferenceImage && refMode === 'asset';
  const hasLogo = !!logoImageBase64;
  const dims = getBannerDimensions(formData);
  const extras = extraTexts.filter(t => t.text.trim());
  // AI判定結果があれば優先、なければキーワードマッチにフォールバック
  const mood = moodClassification
    ? getMoodById(moodClassification.moodId)
    : inferDesignMood(formData);
  const mainWeightOverride = moodClassification?.mainWeight;
  const subWeightOverride = moodClassification?.subWeight;

  const lines: string[] = [];

  // テキスト描画禁止判定（テンプレートがKonvaでテキスト合成する場合）
  const hasNoTextDirective = /テキスト.*一切含めない|テキスト.*描画してはいけない|no text/i.test(customPrompt);

  // ==================== TEXT ====================
  const allTexts: string[] = [];
  if (mainText) allTexts.push(mainText);
  if (subText) allTexts.push(subText);
  // 注釈は装飾扱いだが、隅に小さく置く独立カテゴリとして扱う（ボタン/バッジ等とは別）
  const annotations = extras.filter(t => t.decoration === 'annotation');
  const decorated = extras.filter(t =>
    t.decoration && t.decoration !== 'none' && t.decoration !== 'annotation'
  );
  const plain = extras.filter(t => !t.decoration || t.decoration === 'none');
  plain.forEach(et => allTexts.push(et.text));
  decorated.forEach(et => allTexts.push(et.text));
  annotations.forEach(et => allTexts.push(et.text));
  // Legacy compat helpers
  const buttons = decorated.filter(t => t.decoration === 'button');
  const badges = decorated.filter(t => t.decoration === 'badge');
  const ribbons = decorated.filter(t => t.decoration === 'ribbon');
  const circles = decorated.filter(t => t.decoration === 'circle');
  const autoDecor = decorated.filter(t => t.decoration === 'auto');
  // subText が annotation 指定のときも独立カウント（後段の Font セクションで使う）
  const hasAnyAnnotation = annotations.length > 0 || subTextDecoration === 'annotation';

  if (hasNoTextDirective) {
    // テキストはKonvaで後から合成するため、AIには描画させない
    lines.push(`# Text`);
    lines.push(`[CRITICAL] Do NOT render any text, letters, numbers, or characters in this image. The image must contain ONLY visual elements (background, illustrations, decorations). Text will be added programmatically later.`);
  } else {
    lines.push(`# Text`);
    lines.push(`[STRICT] Each text below must appear EXACTLY ONCE in the image. No duplicates. Total: ${allTexts.length} text elements.`);
    if (mainText) {
      lines.push(`- Main: 「${mainText}」 — display once only`);
    }
    if (subText) {
      const subDeco = subTextDecoration && subTextDecoration !== 'none' ? subTextDecoration : null;
      if (subDeco === 'button') {
        lines.push(`- Sub (Button): 「${subText} ▶」 [render as clickable button with a small right-pointing triangle at the right end] — display once only`);
      } else if (subDeco === 'badge') {
        lines.push(`- Sub (Badge): 「${subText}」 [render as a small rounded badge/label with colored background] — display once only`);
      } else if (subDeco === 'ribbon') {
        lines.push(`- Sub (Ribbon): 「${subText}」 [render on a ribbon banner/sash decoration] — display once only`);
      } else if (subDeco === 'circle') {
        lines.push(`- Sub (Circle): 「${subText}」 [render inside a circular shape] — display once only`);
      } else if (subDeco === 'annotation') {
        lines.push(`- Sub (Annotation): 「${subText}」 [render as a tiny disclaimer/footnote — extremely small font (about 1/8 of main text size, near the legible minimum), neutral gray color (around #777-#999), placed at a corner of the banner (bottom-right or bottom-left), no background, no decoration, no frame] — display once only`);
      } else if (subDeco === 'auto') {
        lines.push(`- Sub (Decorated): 「${subText}」 [add the most suitable decoration — badge, ribbon, circle, or button — based on the text content] — display once only`);
      } else {
        lines.push(`- Sub: 「${subText}」 — display once only`);
      }
    }
    plain.forEach((et, i) => {
      lines.push(`- Extra ${i + 1}: 「${et.text}」 — display once only`);
    });
    buttons.forEach((et, i) => {
      lines.push(`- Button${buttons.length > 1 ? ` ${i + 1}` : ''}: 「${et.text} ▶」 [render as clickable button with a small right-pointing triangle at the right end] — display once only`);
    });
    badges.forEach((et, i) => {
      lines.push(`- Badge${badges.length > 1 ? ` ${i + 1}` : ''}: 「${et.text}」 [render as a small rounded badge/label with colored background] — display once only`);
    });
    ribbons.forEach((et, i) => {
      lines.push(`- Ribbon${ribbons.length > 1 ? ` ${i + 1}` : ''}: 「${et.text}」 [render on a ribbon banner/sash decoration] — display once only`);
    });
    circles.forEach((et, i) => {
      lines.push(`- Circle${circles.length > 1 ? ` ${i + 1}` : ''}: 「${et.text}」 [render inside a circular shape] — display once only`);
    });
    autoDecor.forEach((et, i) => {
      lines.push(`- Decorated${autoDecor.length > 1 ? ` ${i + 1}` : ''}: 「${et.text}」 [add the most suitable decoration — badge, ribbon, circle, or button — based on the text content] — display once only`);
    });
    annotations.forEach((et, i) => {
      lines.push(`- Annotation${annotations.length > 1 ? ` ${i + 1}` : ''}: 「${et.text}」 [render as a tiny disclaimer/footnote — extremely small font (about 1/8 of main text size, near the legible minimum), neutral gray color (around #777-#999), placed at a corner of the banner (bottom-right or bottom-left), no background, no decoration, no frame] — display once only`);
    });
  }

  // Structured prompt detection — 元の日本語で判定（翻訳後はセクション見出しが消えるため）
  const isStructuredPrompt = /^(配色|レイアウト)\n/m.test(customPrompt.trim());
  const hasFreeTextCustom = !isStructuredPrompt && customPrompt.trim().length > 0;

  // ==================== CUSTOM DESIGN INSTRUCTIONS (highest priority) ====================
  if (hasFreeTextCustom) {
    lines.push(``, `# Design Instructions (HIGHEST PRIORITY)`);
    lines.push(`Apply the following user instructions as the top design priority:`);
    lines.push(`[TEXT AUTHORITY] The ONLY texts allowed to appear in the image are the ones listed in the text section. Any other quoted words in these instructions are style references from a previous design — apply the styling to the corresponding current text; never render the old quoted words.`);
    if (mainColor) {
      lines.push(`[COLOR OVERRIDE] Primary/accent color is ${mainColor}. It overrides any conflicting color words below; recolor accents, bands, badges, and highlighted text to ${mainColor}. Neutral white/black/gray elements stay as written.`);
    }
    lines.push(effectiveCustomPrompt.trim());
  }

  // ==================== COLOR ====================
  const customTextColor = hasFreeTextCustom
    ? customPrompt.match(/文字[はを色がの]*[：:]?\s*(ゴールド|金色|金|シルバー|銀色|銀|赤|青|黄色|白|黒|ネオン|メタリック)/)?.[1]
    : null;
  const textColorMap: Record<string, string> = {
    'ゴールド': 'gold metallic', '金色': 'gold metallic', '金': 'gold metallic',
    'シルバー': 'silver metallic', '銀色': 'silver metallic', '銀': 'silver metallic',
    'ネオン': 'neon glow', 'メタリック': 'metallic shine',
    '赤': 'red', '青': 'blue', '黄色': 'yellow', '白': 'white', '黒': 'black',
  };

  lines.push(``, `# Color Palette`);
  if (mainColor) {
    lines.push(`- Primary color: ${mainColor}`);
  } else {
    lines.push(`- Primary color: AI's choice — select the most appropriate and appealing color scheme for the theme and content. Use vivid, clean colors`);
  }
  if (customTextColor) {
    const enColor = textColorMap[customTextColor] ?? customTextColor;
    lines.push(`- Text color: ${enColor} with glossy, dimensional text effects`);
  } else {
    lines.push(`- Text color: white (#ffffff) as base, choose maximum contrast against background`);
  }
  lines.push(`- Accent: use complementary colors or brightness variations of the primary color`);
  lines.push(`- [CRITICAL] Color temperature must be neutral/cool (5500K daylight). Do NOT add warm yellow/orange/sepia tint to the overall image. Whites must be pure white, not yellowish`);

  // ==================== FONT ====================
  const fontOverride = fontStyle && fontStyle !== 'auto';
  if (fontOverride || !isStructuredPrompt) {
    lines.push(``, `# Font`);
    if (fontOverride) {
      // ユーザーが明示的にフォントスタイルを指定した場合
      const fontMap: Record<Exclude<typeof fontStyle, 'auto'>, { main: string; sub: string; other: string }> = {
        gothic: {
          main: 'extra-bold Gothic/sans-serif typeface — impactful and strong, with thick outlines (white or dark) for readability',
          sub: 'medium-weight Gothic/sans-serif, clean and readable (noticeably lighter than main text)',
          other: 'legible Gothic/sans-serif, light-to-regular weight',
        },
        mincho: {
          main: 'bold Mincho/serif typeface — elegant yet powerful, with thick outlines or drop shadows for readability',
          sub: 'medium-weight Mincho/serif, refined and readable (noticeably lighter than main text)',
          other: 'legible Mincho/serif, regular weight',
        },
        'rounded-gothic': {
          main: 'bold rounded sans-serif typeface (like Zen Maru Gothic, M PLUS Rounded, Kosugi Maru) — warm, friendly, and approachable. Medium-bold weight with soft rounded corners, NOT sharp or rigid',
          sub: 'medium-weight rounded sans-serif, gentle and approachable (lighter than main)',
          other: 'soft rounded sans-serif, light weight',
        },
        'light-mincho': {
          main: 'thin-to-light weight Mincho/serif typeface — refined, elegant, and feminine. Generous letter-spacing for editorial/magazine feel. NOT heavy or shouty',
          sub: 'thin Mincho/serif with wide tracking, delicate and graceful',
          other: 'thin serif, minimal and understated',
        },
        handwritten: {
          main: 'natural handwritten-style Japanese font (like a marker brush or casual pen stroke) — warm, human, authentic. Irregular strokes with character, NOT mechanical or rigid',
          sub: 'light handwritten-style, casual and relaxed',
          other: 'casual handwritten or handdrawn style, light weight',
        },
      };
      const f = fontMap[fontStyle];
      const mainSuffix = mainWeightOverride ? ` [MANDATORY weight override: ${mainWeightOverride}]` : '';
      const subSuffix = subWeightOverride ? ` [MANDATORY weight override: ${subWeightOverride}]` : '';
      lines.push(`- Main text「${mainText}」: ${f.main}${mainSuffix}`);
      if (subText) {
        lines.push(`- Sub text「${subText}」: ${f.sub}${subSuffix}`);
      }
      if (plain.length > 0) {
        lines.push(`- Other text: ${f.other}`);
      }
    } else {
      // 自動モード — ムードに基づくフォント選択
      const mainSuffix = mainWeightOverride ? ` [MANDATORY weight override: ${mainWeightOverride}]` : '';
      const subSuffix = subWeightOverride ? ` [MANDATORY weight override: ${subWeightOverride}]` : '';
      lines.push(`- Main text「${mainText}」: ${mood.fontMain}${mainSuffix}`);
      if (subText) {
        lines.push(`- Sub text「${subText}」: ${mood.fontSub}${subSuffix}`);
      }
      if (plain.length > 0) {
        lines.push(`- Other text: ${mood.fontOther}`);
      }
    }
    if (buttons.length > 0) {
      lines.push(`- Button (CTA) text: bold sans-serif, white text on a rounded filled button with a small arrow (→ or ←) at its LEFT or RIGHT edge (e.g. 「今すぐ確認する →」). The arrow MUST always be present`);
      lines.push(`- Button (CTA) position: the CTA button MUST be the BOTTOM-MOST text element — placed below all other text (headline, subheading, supporting texts)`);
      lines.push(`- [CRITICAL] Button color MUST be a HIGH-CONTRAST COMPLEMENTARY accent color that POPS against the background — NEVER a tint/shade of the background color. The button is the most important interactive element and must visually stand out as the second most eye-catching thing after the main text. Use these explicit rules:`);
      lines.push(`  - Cool background (blue / teal / cyan / purple / green) → use a WARM button color: vivid orange (#ff6b1a / #f97316), red-orange, or warm yellow`);
      lines.push(`  - Warm background (red / orange / yellow / brown / pink) → use a COOL button color: vivid blue, cyan, or teal`);
      lines.push(`  - Neutral background (white / gray / beige / black) → use a vivid orange, red, or magenta button`);
      lines.push(`  - FORBIDDEN: button color in the same hue family as the background (e.g. light blue button on blue background, pink button on red background)`);
    }
    if (badges.length > 0) {
      lines.push(`- Badge text: bold sans-serif, compact rounded-rectangle background with vivid accent color. Small size, like a label tag`);
    }
    if (ribbons.length > 0) {
      lines.push(`- Ribbon text: bold text on a ribbon/sash/banner decoration. Ribbon should have folded edges and a vivid accent color`);
    }
    if (circles.length > 0) {
      lines.push(`- Circle text: bold text centered inside a filled circle. Circle should use a vivid accent color with white or contrasting text`);
    }
    if (autoDecor.length > 0) {
      lines.push(`- Decorated text: choose the most visually effective decoration (badge, ribbon, circle, or button) based on the text content and overall design`);
    }
    if (hasAnyAnnotation) {
      lines.push(`- Annotation text: extremely small (about 1/8 of main text height, near the legible minimum), thin/regular weight sans-serif, neutral gray color (around #777-#999). It is a quiet disclaimer/footnote — never bold, never decorated, never inside a button or badge. Pinned to a corner with small margin from the edge`);
    }
  }

  // ==================== BACKGROUND / SCENE ====================
  if (isStructuredPrompt) {
    const raw = customPrompt.trim();
    const colorSectionContent = extractSection(raw, '配色');
    if (colorSectionContent) {
      const bgLine = colorSectionContent.match(/背景[：:]\s*(.+)/);
      const accentLine = colorSectionContent.match(/アクセント[：:]\s*(.+)/);
      const textColorLine = colorSectionContent.match(/文字[：:]\s*(.+)/);
      lines.push(``, `# Background / Scene`);
      if (bgLine) {
        lines.push(`- Background: ${bgLine[1].trim()}`);
      }
      if (accentLine) {
        lines.push(`- Accent decoration: ${accentLine[1].trim()}`);
      }
      if (textColorLine) {
        lines.push(`- Text decoration: ${textColorLine[1].trim()}`);
      }
    }
  }

  // ==================== LAYOUT ====================
  lines.push(``, `# Layout`);

  if (isStructuredPrompt) {
    const raw = customPrompt.trim();
    const keepSections = fontOverride
      ? ['人物', 'レイアウト', 'スタイル']
      : ['人物', 'フォント', 'レイアウト', 'スタイル'];
    const sectionRegex = /^(テキスト|配色|人物|フォント|レイアウト|スタイル)\n/gm;
    const sections: { name: string; start: number }[] = [];
    let match;
    while ((match = sectionRegex.exec(raw)) !== null) {
      sections.push({ name: match[1], start: match.index });
    }
    const cleanedParts: string[] = [];
    for (let i = 0; i < sections.length; i++) {
      if (keepSections.includes(sections[i].name)) {
        const end = i + 1 < sections.length ? sections[i + 1].start : raw.length;
        cleanedParts.push(raw.slice(sections[i].start, end).trim());
      }
    }
    const cleanedCustom = cleanedParts.join('\n\n');
    lines.push(`[IMPORTANT] Apply the following design specifications as top priority.${mainColor ? ` Use primary color ${mainColor}.` : ''}`);
    lines.push(cleanedCustom);
  } else {
    // ==================== ZONE STRUCTURE（MANDATORY 3-zone vertical layout）====================
    // 「タイトル / 本文 / CTA」の3ゾーンを明確に分離する指示。
    // これが無いとAIは全要素を中央に積み重ねて「浮いた」デザインを作りがち。
    // 特に「装飾のない平文が下部に浮く」ケースではコンテナで囲う必要があるが、
    // ボタン/バッジ/リボン/丸囲みなど既に装飾済みの要素がある場合は外枠不要（二重枠になる）。
    // [IMPORTANT] 指示内の名称（headline / body / cta など）は構造説明用の比喩であり、
    // バナー内のテキストとして描画してはいけない。英語ラベルを大文字で書くとAIが文字化するので避ける。
    lines.push(`- Organize the composition into three vertically stacked sections from top to bottom, each section serving a distinct role. These section names are for your internal reasoning only — DO NOT render these section labels or any English category words as visible text in the banner:`);
    lines.push(`  - Top section: the main headline, large heavy weight, full-width or upper-center`);
    lines.push(`  - Middle section: the sub text and supporting content (numbered lists, bullets, descriptions, secondary copy)`);
    lines.push(`  - Bottom section: the closing call-to-action, button, badge, or final accent texts`);
    lines.push(`- Each section must have visible breathing room (whitespace or a thin separator line) between it and the next. Sections must not bleed into each other`);

    // 装飾済み要素の有無で枠指示を切り替える
    const hasDecoratedExtras =
      buttons.length + badges.length + ribbons.length + circles.length + autoDecor.length > 0;
    if (hasDecoratedExtras) {
      lines.push(`- The bottom section contains decorated elements (buttons, badges, ribbons, or circles) — these elements are already self-contained visual units. Do NOT wrap them in an additional outer frame, outer panel, or outer rounded rectangle (this would create redundant nested framing). Just arrange the decorated elements with clean spacing`);
    } else {
      lines.push(`- [CRITICAL — closing message framing] The bottom section contains free-flowing closing copy (not decorated elements). Because plain text at the bottom tends to float and look unintentional, wrap the closing copy in a visible container: a rounded rectangle with either (a) a visible 2-4px border in a contrasting color, or (b) a contrasting background fill (darker or lighter than the surrounding background), with internal padding (8-16px). Plain floating text at the bottom with no container is forbidden`);
    }
    lines.push(`- [ABSOLUTE RULE] The ONLY text that must appear in the banner is the Japanese copy provided in this prompt (main text, sub text, extra texts). Do NOT add any English words, section titles, category labels, or placeholder text anywhere in the image`);

    lines.push(`- Text direction: horizontal (left to right)`);
    lines.push(`- Text placement: main text large, centered or upper-center, spanning most of the width`);
    if (mainText && mainText.length >= 6) {
      lines.push(`- Main text is long — split into 2 lines, each using 80%+ of the image width`);
    }
    lines.push(`- Size ratio: main title dominates the image. Sub text is about 1/3 the size`);

    // ==================== TEXT EMPHASIS（メリハリ）====================
    // テキストごとに具体的な助詞・強調語を抽出してAIに明示する。
    // 抽象指示（"particles should be smaller"）はAIに無視されがちなので、
    // どの文字をどう扱うかを「この通りやれ」と渡すアプローチ。
    const emphasisDirectives: string[] = [];
    const mainDirective = buildEmphasisDirective(mainText, 'Main text');
    if (mainDirective) emphasisDirectives.push(mainDirective);
    const subDirective = buildEmphasisDirective(subText, 'Sub text');
    if (subDirective) emphasisDirectives.push(subDirective);
    extraTexts.forEach((et, i) => {
      const d = buildEmphasisDirective(et.text, `Extra text ${i + 1}`);
      if (d) emphasisDirectives.push(d);
    });

    if (emphasisDirectives.length > 0) {
      lines.push(``, `# Text emphasis (MANDATORY visual hierarchy)`);
      lines.push(`The following typography directives are CRITICAL — applying them is what separates a flat design from a professional Japanese banner. Render every character at the specified size. Uniform-sized text is FORBIDDEN.`);
      emphasisDirectives.forEach(d => lines.push(d));
    } else {
      // フォールバック: 旧来の抽象指示
      lines.push(`- [IMPORTANT] Japanese typography rule: particles/connectors (で、を、の、に、は、が、と、も、へ、から、なら、って) should be rendered at ~60-70% the size of surrounding kanji/key words to create visual rhythm`);
    }
    if (wantsPerson) {
      lines.push(`- Person: include a theme-appropriate person. Freely choose their position (left, right, center, etc.) for the best composition`);
      lines.push(`- If text and person compete for space, slightly reduce person size rather than cutting off text`);
    } else if (personMode === 'none') {
      lines.push(`- [REQUIRED] Do NOT include any people, persons, human figures, faces, hands, or body parts anywhere in the image. This is a no-person design`);
    }
    lines.push(`- Decorations: ${mood.decoration}`);
    // [B] 背景あしらいの抑制：以前は「3-6個のアイコンを散らせ」だったが、
    // それが視覚ノイズを生み「ダサいバナー」の主因になっていた。
    // 背景は静かに保ち、テクスチャやグラデで奥行きを出すのが今っぽいデザイン。
    lines.push(`- Background: keep the background CALM and UNCLUTTERED. Do NOT scatter multiple decorative icons, doodles, or motifs across empty spaces — this creates visual noise and makes the banner look amateurish. If background interest is needed, use subtle texture, soft gradient, or a single unobtrusive graphic element instead of multiple scattered icons`);
    lines.push(`- When using ribbons, banners, or badges as decoration, text MUST fit properly inside the decoration. Text must not overflow or misalign with its decoration`);
    // [C] テキストの余白ルール：端に詰めすぎない・他要素との呼吸を確保
    lines.push(`- Text breathing room (MANDATORY): every text element must have clear empty space around it. Text must NEVER touch or nearly touch the image edge — maintain at least 8-10% margin between any text and the image boundary. Text must also have visible spacing from adjacent elements (other text, person, decorations). Cramped text filling every pixel is forbidden`);
  }

  // Reference image / logo
  if (isAssetRef) {
    lines.push(`- [REQUIRED] Use the attached image as the main visual. Do not ignore or replace it`);
    lines.push(`- [CRITICAL] Reproduce the asset EXACTLY as photographed — same shape, colors, proportions, and every character of any text printed on it (book cover, obi/band, package label). Do NOT redraw, restyle, reinterpret, or "improve" it to match the design theme`);
    lines.push(`- Text printed ON the asset lives only inside the asset itself. Do NOT re-render it anywhere else in the design as separate banner text`);
    if (wantsPerson) {
      lines.push(`- [CRITICAL] Keep the person from the attached image exactly as-is: same face, hair, skin, clothes, gender, age. Do not replace with AI-generated person`);
    } else {
      lines.push(`- [REQUIRED] Use the subject from the attached image (product, logo, material) as-is`);
    }
  } else if (isStyleRef) {
    lines.push(`- [STYLE REFERENCE] The attached image is a STYLE REFERENCE ONLY. Match its overall aesthetic: color palette, mood, lighting, typography style, composition rhythm, and design language`);
    lines.push(`- [CRITICAL] Do NOT copy, trace, or reproduce any specific objects, people, faces, products, logos, brand marks, or text from the reference image. Generate fresh, original content that merely shares the same visual style`);
    lines.push(`- Treat the reference as inspiration for "how it should feel and look", not "what it should contain"`);
  }

  if (hasLogo) {
    const posMap = { 'top-left': 'top-left', 'top-right': 'top-right', 'bottom-left': 'bottom-left', 'bottom-right': 'bottom-right' } as const;
    const pos = posMap[logoPosition ?? 'bottom-right'];
    const safeAreaNoteA = hasValidCustomSize(formData)
      ? ' The corner refers to the FINAL cropped image — i.e. the corner of the central region that survives the crop described in the size section, NOT the corner of the raw canvas.'
      : '';
    lines.push(`- The real logo will be composited at ${pos} programmatically after generation. Reserve that corner — roughly 22% of the width × 16% of the height — as plain background with no elements on top.${safeAreaNoteA}`);
    lines.push(`- [ABSOLUTE] Do NOT render ANY logo, brand mark, emblem, monogram, icon, pictogram, symbol, watermark, or placeholder "LOGO" text anywhere in the entire image. Zero brand marks. Zero pictograms near the CTA. The real logo is composited later — do not pre-draw or hint at one`);
  } else {
    lines.push(`- [ABSOLUTE] Do NOT render ANY logo, brand mark, emblem, monogram, watermark, or placeholder "LOGO" text anywhere in the image. No hallucinated brand symbols next to CTAs or in corners`);
  }

  // ==================== SIZE ====================
  lines.push(``, `# Size`);
  if (hasValidCustomSize(formData)) {
    const frame = mapFormToEngineSize(formData);
    const [fw, fh] = frame.split('x').map(Number);
    const targetRatio = formData.customWidth / formData.customHeight;
    const ratioLabel = targetRatio.toFixed(2);
    // クロップで捨てられる帯の割合を実数で伝える（"safe area"だけでは守られない実測があったため）
    const frameRatio = fw / fh;
    let cutLine: string;
    if (targetRatio > frameRatio) {
      const visibleH = fw / targetRatio;
      const cutPct = Math.round(((fh - visibleH) / 2 / fh) * 100);
      cutLine = `- [CRITICAL — CROP WARNING] The TOP ${cutPct}% and BOTTOM ${cutPct}% of the canvas WILL BE CUT OFF and thrown away. Anything placed there (text, bands, badges, footers) will be DESTROYED. Those two horizontal strips must be pure background only. Compose the ENTIRE design — including any top banner strip and bottom footer strip — inside the middle ${100 - 2 * Math.round(((fh - visibleH) / 2 / fh) * 100)}% of the canvas height.`;
    } else {
      const visibleW = fh * targetRatio;
      const cutPct = Math.round(((fw - visibleW) / 2 / fw) * 100);
      cutLine = `- [CRITICAL — CROP WARNING] The LEFT ${cutPct}% and RIGHT ${cutPct}% of the canvas WILL BE CUT OFF and thrown away. Anything placed there will be DESTROYED. Those two vertical strips must be pure background only. Compose the ENTIRE design inside the middle ${100 - 2 * cutPct}% of the canvas width.`;
    }
    lines.push(`- Final delivery size: ${dims.width}x${dims.height}px (aspect ${ratioLabel}:1). The generation frame is ${frame.replace('x', '×')}px and the final image will be CENTER-CROPPED to that aspect.`);
    lines.push(cutLine);
  } else {
    lines.push(`- Aspect ratio: ${aspectRatio} (${dims.width}x${dims.height}px)`);
  }

  // ==================== STYLE ====================
  if (!isStructuredPrompt) {
    lines.push(``, `# Style`);
    lines.push(`- ${mood.style}`);
    lines.push(`- Theme: ${mood.theme}`);
    lines.push(`- Background: ${mood.background}`);
    lines.push(`- Apply appropriate text effects (shadows, outlines, glow) to ensure readability against the background`);

    // イラスト系の判定 → ソーシャルゲーム風アニメ塗りで色をクリーンに
    const allText = [mainText, subText, ...extraTexts.map(t => t.text), customPrompt].filter(Boolean).join(' ');
    const isIllustStyle = /イラスト|アニメ|マンガ|漫画|キャラ|ゲーム|配信|実況|vtuber|ソシャゲ/i.test(allText)
      || ['cute', 'entertainment'].includes(mood.id);
    if (isIllustStyle) {
      lines.push(`- Coloring: use social-game / anime-style cel shading with vivid, saturated, clean colors. No muddy or desaturated tones`);
    }
  }

  // ==================== RULES ====================
  lines.push(``, `# Rules`);
  lines.push(`- Render all Japanese text with 100% accuracy — every kanji, kana, and character must be pixel-perfect. This is the #1 priority`);
  lines.push(`- When breaking Japanese text into multiple lines, break at natural word/phrase boundaries (e.g. 「夏期講習｜募集」「先着15名様｜入学金無料」). NEVER break in the middle of a word or between a kanji compound (e.g. 「夏期講｜習募集」is WRONG)`);
  lines.push(`- Each text element appears exactly once. Total count: ${allTexts.length}`);
  lines.push(`- Text is always in the foreground — never hidden behind people or decorations`);
  if (wantsPerson) {
    lines.push(`- [CRITICAL] Text must NEVER overlap the person's face. Overlapping the body slightly is OK, but the face must always be fully visible and unobstructed`);
  }
  lines.push(`- All elements must be at least 5% inward from image edges`);
  if (isAssetRef) {
    lines.push(`- The attached image content must be included in the banner`);
    if (wantsPerson) {
      lines.push(`- Do not alter the face or appearance of the person in the attached image`);
    }
  } else if (isStyleRef) {
    lines.push(`- The attached image's content (specific objects/people/text) must NOT appear in the banner — only its visual style should be borrowed`);
  }
  lines.push(`- When using ribbons, banners, or badge decorations, text must fit properly inside them`);
  lines.push(`- Achieve the quality of a professional Japanese YouTube thumbnail / advertising banner`);
  lines.push(`- [CRITICAL] Use neutral/cool white balance (~5500-6500K daylight). NO warm yellow/sepia/orange color cast. Whites must render as pure #ffffff white. Skin tones must be natural, not yellow-shifted. If the scene is warm-toned, still keep the overall color balance neutral and clean`);

  return lines.join('\n');
}

/** Extract section content from structured prompt */
function extractSection(raw: string, sectionName: string): string | null {
  const sectionRegex = /^(テキスト|配色|人物|フォント|レイアウト|スタイル)\n/gm;
  const sections: { name: string; start: number }[] = [];
  let match;
  while ((match = sectionRegex.exec(raw)) !== null) {
    sections.push({ name: match[1], start: match.index });
  }
  for (let i = 0; i < sections.length; i++) {
    if (sections[i].name === sectionName) {
      const contentStart = sections[i].start + sectionName.length + 1;
      const end = i + 1 < sections.length ? sections[i + 1].start : raw.length;
      return raw.slice(contentStart, end).trim();
    }
  }
  return null;
}

/** 季節 → 配色・モチーフのガイド（season軸のリカラー用）。 */
const SEASON_PALETTE: Record<string, string> = {
  '春': 'soft pastel pink & peach, fresh light green, pale yellow; cherry-blossom / new-leaf floral motifs',
  '夏': 'cool aqua & teal, crisp white, fresh green with vivid accents; morning-glory / sunflower / water motifs',
  '秋': 'warm amber, terracotta, mustard and deep red; maple / ginkgo / harvest floral motifs',
  '冬': 'cool blue-grey & navy, snow white, silver; camellia / pine / subtle warm spice accents',
};

/**
 * 勝ちフォーマット直系「編集（clone）」用プロンプト。
 * 添付の勝ちCR画像をそのまま土台にし、指定した「1軸」だけを変える img2img 編集を指示する。
 *   - variationAxis='copy'（既定）: コピー文言だけ差し替え（書籍・レイアウト・配色は維持）
 *   - 'season' : コピー据え置き、背景＋装飾の色を季節パレットへ（variationDetail=季節名）
 *   - 'taste'  : コピー・レイアウト据え置き、画風（テイスト）ごと描き直す（variationDetail=画風）
 *   - 'background': 書籍・コピー据え置き、背景パターンを替える（variationDetail=指示）
 * いずれも書籍/商品写真とレイアウトは保持（＝勝ちの要因を維持）。
 */
export function buildWinningClonePrompt(formData: BannerFormData): string {
  const { mainText, subText, extraTexts } = formData;
  const extras = extraTexts.filter((t) => t.text.trim());
  const axis = formData.variationAxis ?? 'copy';
  const detail = formData.variationDetail?.trim();

  const lines: string[] = [];
  const swapPersons = !!formData.variationSwapPersons;

  // ===== 人物も別人に描き換える（見た目替えのオプション。配置・役割・感情は維持） =====
  const pushSwapPersonsBlock = () => {
    if (!swapPersons) return;
    lines.push('', '# ALSO replace the people:');
    lines.push('- REPLACE every person/character with a DIFFERENT-looking individual: different face, hairstyle, and clothing.');
    lines.push("- Keep each person's position, size, pose, role and emotional expression the same as the original (worried stays worried, cheerful stays cheerful), and keep the same demographic (age range / gender) so the ad's story is unchanged.");
  };

  // ===== 共通: 何を絶対に保持するか =====
  const keepIdentical = (includeCopy: boolean, includeColor: boolean) => {
    lines.push('', '# Keep IDENTICAL — do NOT alter:');
    lines.push('- The photographed book / product exactly as shown (same cover art, same object). Do NOT redraw, restyle, or replace it.');
    lines.push("- The book cover's OWN text (it is part of the real product photo).");
    lines.push('- The overall layout, composition, and the position of every element.');
    lines.push('- Every decorative badge / ribbon / circle (e.g. 「女性限定」「参加無料」): shape and position.');
    lines.push('- The aspect ratio and framing.');
    lines.push('- The relative light/dark MOOD CONTRAST between zones: if the original contrasts a dark/negative area against a bright/positive area (problem vs solution, before vs after), that duality is a core part of the winning pattern. NEVER flatten both zones into one uniform mood.');
    if (includeColor) lines.push('- All colors, gradients, and the background palette.');
    if (includeCopy) lines.push('- ALL Japanese copy text — keep every headline / sub / badge wording exactly as in the original. Do NOT rewrite any text.');
  };

  if (axis === 'copy') {
    lines.push('You are EDITING the attached high-performing Japanese ad image. Reproduce it FAITHFULLY and change ONLY the promotional copy text. This is an A/B test of the proven winning creative — the visuals must stay the same.');
    keepIdentical(false, true);
    lines.push('', '# Replace ONLY the large promotional banner copy (the headline band / overlay text), keeping the original font style, weight, color and placement zone:');
    if (mainText) lines.push(`- New headline (largest banner copy): 「${mainText}」`);
    if (subText) lines.push(`- New sub copy: 「${subText}」`);
    extras.forEach((et, i) => {
      const inDeco = et.decoration && et.decoration !== 'none' && et.decoration !== 'auto'
        ? `（existing ${et.decoration}-style element の中の文字を差し替え）`
        : '';
      lines.push(`- Supporting ${i + 1}: 「${et.text}」${inDeco}`);
    });
    lines.push('Render every kanji and kana with 100% accuracy. Match the original headline typography.');
    lines.push('', '# Forbidden');
    lines.push('- Do NOT change the layout, move elements, or resize the book photo.');
    lines.push('- Do NOT add new objects, new people, English text, or extra decorations.');
    lines.push('- Do NOT alter the book cover artwork or its text. Do NOT change the color palette.');
  } else if (axis === 'season') {
    const season = detail && SEASON_PALETTE[detail] ? detail : '夏';
    const palette = SEASON_PALETTE[season];
    lines.push(`You are EDITING the attached high-performing Japanese ad image to make a SEASONAL color variant for ${season}. Keep EVERYTHING the same except recolor the background and decorative florals to the season's palette. This is the client's proven A/B pattern (same design, seasonal recolor).`);
    keepIdentical(true, false);
    lines.push('', `# Recolor ONLY the background and floral/decorative elements to a ${season} palette:`);
    lines.push(`- Target palette & motifs: ${palette}.`);
    lines.push('- Apply the new palette to the background gradient, the corner floral decorations, and the badge accent tints — keep the badges\' shape/position and their text.');
    lines.push('- Keep the book photo, the layout, and ALL text exactly as in the original.');
    lines.push('', '# Forbidden');
    lines.push('- Do NOT rewrite or move any text. Do NOT redraw the book. Do NOT change the layout or add new objects.');
  } else if (axis === 'taste') {
    const taste = detail || 'a clearly different illustration style';
    lines.push('You are EDITING the attached high-performing Japanese ad image to make an ART-STYLE (taste) variant. Keep the layout, composition and every word of copy identical, but redraw the artwork in a different visual taste so the ad instantly feels fresh at a glance (anti creative-fatigue A/B test of the same proven message).');
    keepIdentical(true, false);
    lines.push('', `# Redraw the ENTIRE artwork in this taste: ${taste}`);
    lines.push('- Restyle the characters, decorations and background into the new taste CONSISTENTLY — the style change must be obvious at a glance.');
    lines.push("- Keep every element's position, size and role identical (same layout skeleton), and keep the light/dark zone contrast between the negative and positive sides.");
    lines.push('- If the original contains an actual PHOTOGRAPH of a product/book, keep that photo untouched — restyle only the illustrated/designed parts around it.');
    pushSwapPersonsBlock();
    lines.push('', '# Forbidden');
    lines.push('- Do NOT rewrite or move any text. Do NOT change the layout or aspect ratio. Do NOT drop any badge, ribbon or CTA.');
  } else {
    // background
    const bg = detail || 'a clean alternative background pattern that still feels cohesive with the brand';
    lines.push('You are EDITING the attached high-performing Japanese ad image to make a BACKGROUND variant. Keep the book, badges, layout and all copy the same; change only the background.');
    keepIdentical(true, false);
    lines.push('', `# Change ONLY the background to: ${bg}`);
    lines.push('- The background change must be immediately noticeable when compared side-by-side with the original — this is an A/B test OF the background. A subtle tint shift is NOT enough; replace the background clearly.');
    lines.push("- Apply the new background theme SEPARATELY per zone, matching each zone's original mood: if the original has a dark/negative side and a bright/positive side, render the new background dark & heavy on the negative side and bright & hopeful on the positive side. Do NOT paint both sides with one uniform background.");
    lines.push('- Keep the book photo, badges, layout, and ALL text exactly as in the original. Ensure text stays fully readable over the new background.');
    pushSwapPersonsBlock();
    lines.push('', '# Forbidden');
    lines.push('- Do NOT rewrite or move text. Do NOT redraw the book. Do NOT change the layout.');
  }

  return lines.join('\n');
}

/**
 * GPT Image 2 用の最小プロンプト構築。
 * GPT Image 2 は Gemini と違い「集客LPテンプレ」を忠実に再現してしまう傾向があるため、
 * 装飾・mood・3ゾーン強制などの強い指示を意図的に外し、モデルのeditorial感に任せる。
 */
export function buildGptImage2Prompt(
  formData: BannerFormData,
  translatedCustomPrompt?: string,
): string {
  const {
    mainText, subText, subTextDecoration, extraTexts, mainColor, aspectRatio,
    fontStyle, customPrompt, referenceImageBase64, referenceImageMode,
    logoImageBase64, logoPosition,
  } = formData;
  // 人物: personMode 優先、未指定なら hasPersons からフォールバック
  const personMode = formData.personMode ?? (formData.hasPersons ? 'yes' : 'auto');
  const wantsPerson = personMode === 'yes';
  const effectiveCustomPrompt = applyMainColorToCustomPrompt(scrubStaleQuotedTexts((translatedCustomPrompt ?? customPrompt).trim(), { mainText, subText, extraTexts }), mainColor);
  const hasReferenceImage = !!referenceImageBase64;
  // clone はこのビルダーに来る前に generate-core で専用処理される。来た場合は asset 扱い。
  const refMode: 'style' | 'asset' = referenceImageMode === 'style' ? 'style' : 'asset';
  const isStyleRef = hasReferenceImage && refMode === 'style';
  const isAssetRef = hasReferenceImage && refMode === 'asset';
  const hasLogo = !!logoImageBase64;
  const dims = getBannerDimensions(formData);
  const extras = extraTexts.filter(t => t.text.trim());

  const lines: string[] = [];

  lines.push(`Create a high-quality Japanese promotional banner. Design it with confident editorial taste — let the composition breathe and trust your own visual judgment for layout, decoration, and hierarchy.`);

  // ==================== TEXT ====================
  const allTexts: string[] = [];
  if (mainText) allTexts.push(mainText);
  if (subText) allTexts.push(subText);
  extras.forEach(et => allTexts.push(et.text));

  lines.push(``, `# Texts to include (Japanese, each exactly once)`);
  if (mainText) lines.push(`- Headline (largest): 「${mainText}」`);
  if (subText) {
    let hint = '';
    if (subTextDecoration === 'annotation') {
      hint = ' (render as a tiny gray disclaimer / footnote in a corner — extremely small font, neutral gray ~#777-#999, no background, no decoration)';
    } else if (subTextDecoration === 'button') {
      hint = ' (render as a CTA button — see CTA button rule below)';
    } else if (subTextDecoration && subTextDecoration !== 'none' && subTextDecoration !== 'auto') {
      hint = ` (loose hint: present this on a small ${subTextDecoration}-like accent if it fits the design)`;
    }
    lines.push(`- Subheading: 「${subText}」${hint}`);
  }
  let hasButtonCta = subTextDecoration === 'button';
  extras.forEach((et, i) => {
    let deco = '';
    if (et.decoration === 'annotation') {
      deco = ' (render as a tiny gray disclaimer / footnote in a corner — extremely small font, neutral gray ~#777-#999, no background, no decoration)';
    } else if (et.decoration === 'button') {
      hasButtonCta = true;
      deco = ' (render as a CTA button — see CTA button rule below)';
    } else if (et.decoration && et.decoration !== 'none' && et.decoration !== 'auto') {
      deco = ` (loose hint: ${et.decoration}-like accent if it fits)`;
    }
    lines.push(`- Supporting ${i + 1}: 「${et.text}」${deco}`);
  });
  lines.push(`Total text elements: ${allTexts.length}. Each must appear exactly once. Render every kanji and kana with 100% accuracy.`);

  // CTAボタンのルール（必須）。loose hint ではなく確定指示として扱う。
  if (hasButtonCta) {
    lines.push(``, `# CTA button rule (MANDATORY)`);
    lines.push(`- Render the CTA text on a rounded, filled, high-contrast button.`);
    lines.push(`- Position: the CTA button MUST be the BOTTOM-MOST text element — placed below all other text (headline, subheading, supporting texts).`);
    lines.push(`- Arrow (REQUIRED): the button MUST always have a small arrow (→ or ←) at its LEFT or RIGHT edge. Never render the CTA button without an arrow.`);
  }

  // ==================== USER CUSTOM ====================
  if (effectiveCustomPrompt) {
    lines.push(``, `# User design direction (highest priority)`);
    lines.push(`[TEXT AUTHORITY] The ONLY texts allowed to appear in the image are the ones listed in "# Texts to include" above. Any other quoted words inside this design direction are style references from a previous design — apply their styling (color / weight / placement) to the corresponding CURRENT text, and NEVER render the old quoted words themselves.`);
    // フォームでメインカラーが指定されている場合はカスタム指示内の色より優先する（Issue #28）。
    // プロンプトジェネレーター由来の指示は元画像の色をhexで具体指定してくるため、
    // 明示的に上書きしないとフォームの色変更が一切効かない。
    // mainColor='' はAIおまかせ＝上書きなし（手書きカスタム指示の色を壊さない）。
    if (mainColor) {
      lines.push(`[COLOR OVERRIDE — READ FIRST] The user explicitly set the primary/accent color to ${mainColor}. If any color mentioned below (including specific hex codes) conflicts with it, ${mainColor} WINS. Recolor accent bands, badges, buttons, icons, ribbons, and colored keyword/highlight text to ${mainColor} (use lighter/darker shades of ${mainColor} where variation is needed). Keep neutral elements (white/black/gray backgrounds and body text) as specified below.`);
    }
    lines.push(effectiveCustomPrompt);
  }

  // ==================== COLOR / FONT (light hints only) ====================
  const fontMap: Record<string, string> = {
    gothic: 'bold Gothic / sans-serif',
    mincho: 'bold Mincho / serif',
    'rounded-gothic': 'bold rounded sans-serif',
    'light-mincho': 'thin elegant Mincho / serif',
    handwritten: 'natural handwritten Japanese',
  };
  const hints: string[] = [];
  if (mainColor) hints.push(`Primary color: ${mainColor}`);
  if (fontStyle && fontStyle !== 'auto' && fontMap[fontStyle]) {
    hints.push(`Headline typeface: ${fontMap[fontStyle]}`);
  }
  if (wantsPerson) hints.push(`Include a theme-appropriate person`);
  else if (personMode === 'none') hints.push(`No people: do NOT include any person, human figure, face, or body part anywhere`);
  if (hints.length > 0) {
    lines.push(``, `# Light hints`);
    hints.forEach(h => lines.push(`- ${h}`));
  }

  // ==================== REFERENCE / LOGO ====================
  if (isAssetRef) {
    lines.push(``, `# Reference image`);
    lines.push(`- The attached image is the main visual asset. Use the subject (product / person / material) as-is.`);
    lines.push(`- [CRITICAL] Reproduce the asset EXACTLY as photographed — same shape, colors, proportions, and every character of any text printed on it (book cover, obi/band, package label). Do NOT redraw, restyle, reinterpret, or "improve" it to match the design theme.`);
    lines.push(`- Text printed ON the asset lives only inside the asset itself. Do NOT re-render it anywhere else in the design as separate banner text.`);
    if (wantsPerson) {
      lines.push(`- Keep the person from the attached image exactly as-is: same face, hair, skin, clothes.`);
    }
  } else if (isStyleRef) {
    lines.push(``, `# Style reference`);
    lines.push(`- Match the attached image's overall aesthetic (palette, mood, typography style, composition).`);
    lines.push(`- Do NOT copy specific objects, faces, products, logos, or text from the reference.`);
  }

  if (hasLogo) {
    const pos = logoPosition ?? 'bottom-right';
    lines.push(``, `# Logo placement`);
    const safeAreaNote = hasValidCustomSize(formData)
      ? ' The corner refers to the FINAL cropped image — i.e. the corner of the central region that survives the crop described in # Size, NOT the corner of the raw canvas.'
      : '';
    lines.push(`- The real logo image will be composited at the ${pos} corner after generation. Reserve that corner — roughly 22% of the width × 16% of the height — as CLEAN BACKGROUND ONLY: no text, no color bands, no badges, no graphics.${safeAreaNote}`);
    lines.push(`- Do NOT render any logo, brand mark, emblem, or placeholder "LOGO" text anywhere.`);
  } else {
    lines.push(``, `# Logos`);
    lines.push(`- Do NOT render any logo, brand mark, emblem, monogram, watermark, or placeholder "LOGO" text anywhere.`);
  }

  // ==================== SIZE ====================
  lines.push(``, `# Size`);
  if (hasValidCustomSize(formData)) {
    const frame = mapFormToEngineSize(formData);
    const [fw, fh] = frame.split('x').map(Number);
    const targetRatio = formData.customWidth / formData.customHeight;
    const ratioLabel = targetRatio.toFixed(2);
    // クロップで捨てられる帯の割合を実数で伝える（"safe area"だけでは守られない実測があったため）
    const frameRatio = fw / fh;
    let cutLine: string;
    if (targetRatio > frameRatio) {
      const visibleH = fw / targetRatio;
      const cutPct = Math.round(((fh - visibleH) / 2 / fh) * 100);
      cutLine = `- [CRITICAL — CROP WARNING] The TOP ${cutPct}% and BOTTOM ${cutPct}% of the canvas WILL BE CUT OFF and thrown away. Anything placed there (text, bands, badges, footers) will be DESTROYED. Those two horizontal strips must be pure background only. Compose the ENTIRE design — including any top banner strip and bottom footer strip — inside the middle ${100 - 2 * Math.round(((fh - visibleH) / 2 / fh) * 100)}% of the canvas height.`;
    } else {
      const visibleW = fh * targetRatio;
      const cutPct = Math.round(((fw - visibleW) / 2 / fw) * 100);
      cutLine = `- [CRITICAL — CROP WARNING] The LEFT ${cutPct}% and RIGHT ${cutPct}% of the canvas WILL BE CUT OFF and thrown away. Anything placed there will be DESTROYED. Those two vertical strips must be pure background only. Compose the ENTIRE design inside the middle ${100 - 2 * cutPct}% of the canvas width.`;
    }
    lines.push(`- Final delivery size: ${dims.width}x${dims.height}px (aspect ${ratioLabel}:1). The generation frame is ${frame.replace('x', '×')}px and the final image will be CENTER-CROPPED to that aspect.`);
    lines.push(cutLine);
  } else {
    lines.push(`- Aspect ratio: ${aspectRatio} (${dims.width}x${dims.height}px)`);
  }

  // ==================== RULES (minimal) ====================
  lines.push(``, `# Rules`);
  lines.push(`- Render every Japanese character pixel-perfect. Text accuracy is the #1 priority.`);
  lines.push(`- Break long Japanese headlines at natural phrase boundaries, never inside a word.`);
  lines.push(`- Neutral / cool white balance (~5500K daylight). No warm yellow / sepia color cast.`);
  lines.push(`- Do NOT add any English category labels, section titles, or placeholder text.`);
  lines.push(`- Final output should feel like a polished professional Japanese ad creative — not a generic AI seminar template.`);

  return lines.join('\n');
}


/**
 * カスタム指示内の「旧テキスト引用」を無効化する（Issue #30）。
 * プロンプトジェネレーター由来の指示は元バナーの文言を「…」引用で含むため、
 * フォームのテキストを書き換えても旧文言がそのまま描画されることがある。
 * - {{メインテキスト}}/{{サブテキスト}} は現行テキストへ実体化
 * - 現行のどのテキストの部分文字列でもない引用は「読み替え」マーカーへ置換
 */
export function scrubStaleQuotedTexts(
  custom: string,
  texts: { mainText: string; subText: string; extraTexts: { text: string }[] },
): string {
  if (!custom.trim()) return custom;
  const oneLine = (t: string) => t.replace(/\s+/g, ' ').trim();
  let out = custom
    .replace(/\{\{メインテキスト\}\}/g, `「${oneLine(texts.mainText)}」`)
    .replace(/\{\{サブテキスト\}\}/g, `「${oneLine(texts.subText)}」`);

  const norm = (t: string) => t.replace(/\s+/g, '').toLowerCase();
  const currentTexts = [texts.mainText, texts.subText, ...texts.extraTexts.map(e => e.text)]
    .filter(Boolean)
    .map(norm);
  out = out.replace(/「([^「」\n]{2,60})」/g, (m, q) => {
    const nq = norm(q);
    if (!nq) return m;
    // 現行テキストのどれかに含まれる引用は生きた参照として残す
    return currentTexts.some(t => t.includes(nq) || nq.includes(t)) ? m : '「(旧デザインの文言 — 描画禁止。現在のテキスト一覧の対応する要素に読み替える)」';
  });
  return out;
}

/**
 * カスタム指示内の「色指定」をフォームのメインカラーへ機械的に置き換える（Issue #28 強化）。
 * プロンプトでの上書き"お願い"だけではモデルが部分的にしか従わない実測があったため、
 * 渡す前にテキスト自体を書き換えて矛盾を消す。
 * - 白/黒/グレー系（低彩度）のhexは中立色として残す（背景・本文文字を壊さない）
 * - 「濃い緑色（#2e8b57）」のような色名＋hexの組は丸ごと「メインカラー（#xxx）」へ
 */
export function applyMainColorToCustomPrompt(custom: string, mainColor: string): string {
  if (!custom.trim() || !mainColor) return custom;

  const isNeutralHex = (hex: string): boolean => {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (h.length < 6) return true;
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    return max - min <= 28; // ほぼ無彩色（白・黒・グレー）
  };

  // 色語は明示リストに限定する（範囲マッチだと「提案力」等の周辺文字まで食った実測があるため）
  const MOD = '(?:濃い|淡い|明るい|暗い|深い|薄い|ダーク|ライト)?';
  const WORD =
    '(?:緑|赤|青|黄|橙|桃|紫|茶|金|銀|紺|水色|黄緑|グリーン|レッド|ブルー|イエロー|オレンジ|ピンク|パープル|ブラウン|ゴールド|シルバー|ネイビー|ベージュ|エメラルド|ターコイズ|マゼンタ|ワインレッド)';
  const HEX = '(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})';

  // 1) 「(修飾語)色名(色)?（#hex）」の組を丸ごと置換（例: 濃い緑色（#2e8b57）→ メインカラー（#D8A997））
  let out = custom.replace(
    new RegExp(MOD + WORD + '色?[（(]' + HEX + '[）)]', 'g'),
    (m, hex) => (isNeutralHex(hex) ? m : `メインカラー（${mainColor}）`),
  );
  // 2) 組にならなかった裸のhexは hex 部分だけ置換
  out = out.replace(/#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}/g, hex => (isNeutralHex(hex) ? hex : mainColor));
  // 3) hexを伴わない色語（「濃い緑色の円形バッジ」等）も置換（白黒グレー系は語リスト外なので対象外）
  out = out.replace(new RegExp(MOD + WORD + '(?:色|系)?', 'g'), 'メインカラー');
  return out;
}

/** Map aspect ratio to OpenAI API size parameter */
export function mapAspectRatioToSize(aspectRatio: string): '1024x1024' | '1536x1024' | '1024x1536' {
  switch (aspectRatio) {
    case '16:9':
    case '4:3':
      return '1536x1024';
    case '9:16':
    case '3:4':
      return '1024x1536';
    default:
      return '1024x1024';
  }
}

/**
 * フォーム全体からエンジン生成フレームを決める（Issue #29）。
 * custom はカスタム比率に最も近いフレーム（横長/縦長/正方形）を選ぶ。
 * 生成後に postProcess で正確な customWidth×customHeight に中央クロップされる。
 */
export function mapFormToEngineSize(
  formData: Pick<BannerFormData, 'aspectRatio' | 'customWidth' | 'customHeight'>,
): '1024x1024' | '1536x1024' | '1024x1536' {
  if (hasValidCustomSize(formData)) {
    const ratio = formData.customWidth / formData.customHeight;
    if (ratio >= 1.2) return '1536x1024';
    if (ratio <= 1 / 1.2) return '1024x1536';
    return '1024x1024';
  }
  return mapAspectRatioToSize(formData.aspectRatio);
}
