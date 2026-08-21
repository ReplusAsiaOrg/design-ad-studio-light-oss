import { BannerFormData, getBannerDimensions } from './types';

/**
 * テキスト内容からテーマキーワードを推測する。
 * 実際のテキストは渡さず、英語の抽象的なテーマ記述に変換する。
 */
function inferTheme(formData: BannerFormData): string {
  const all = [formData.mainText, formData.subText, ...formData.extraTexts.map(t => t.text)]
    .filter(Boolean)
    .join(' ');

  if (!all.trim()) return 'modern abstract design';

  // キーワードマッチングで大まかなテーマを推測
  const keywords: [RegExp, string][] = [
    [/講習|塾|学校|進学|受験|入学|学生|教育|授業|スクール/i, 'education, school, learning, academic'],
    [/募集|採用|求人|スタッフ|バイト|パート/i, 'recruitment, hiring, job opportunity'],
    [/セール|割引|%OFF|半額|特価|お得|キャンペーン|無料/i, 'sale, discount, promotion, special offer'],
    [/夏|サマー|summer/i, 'summer, bright, warm season'],
    [/冬|ウィンター|winter/i, 'winter, cool, cold season'],
    [/春|スプリング|spring/i, 'spring, fresh, new beginning'],
    [/秋|オータム|autumn|fall/i, 'autumn, warm colors, harvest'],
    [/食|レストラン|カフェ|グルメ|料理|ランチ|ディナー/i, 'food, restaurant, dining, culinary'],
    [/美容|ヘア|サロン|エステ|ネイル|コスメ/i, 'beauty, salon, cosmetics, wellness'],
    [/医療|クリニック|病院|健康|歯科/i, 'medical, healthcare, clinic, wellness'],
    [/不動産|物件|マンション|住宅|引越/i, 'real estate, housing, property'],
    [/旅行|ツアー|観光|ホテル|トラベル/i, 'travel, tourism, vacation, adventure'],
    [/ウェディング|結婚|ブライダル/i, 'wedding, bridal, celebration, elegant'],
    [/スポーツ|フィットネス|ジム|ヨガ|トレーニング/i, 'sports, fitness, gym, active lifestyle'],
    [/テクノロジー|IT|AI|デジタル|アプリ|web/i, 'technology, digital, innovation, modern'],
    [/音楽|ライブ|コンサート|フェス|DJ/i, 'music, concert, live event, entertainment'],
    [/ファッション|アパレル|コーデ|ブランド/i, 'fashion, apparel, style, trendy'],
    [/デザイン|クリエイティブ|アート/i, 'design, creative, artistic'],
    [/イベント|フェア|展示|オープン/i, 'event, exhibition, fair, opening'],
    [/子供|キッズ|こども|幼児|保育/i, 'children, kids, family, playful'],
  ];

  const matched: string[] = [];
  for (const [regex, theme] of keywords) {
    if (regex.test(all)) {
      matched.push(theme);
    }
  }

  if (matched.length > 0) {
    return matched.slice(0, 3).join(', ');
  }

  return 'modern professional design';
}

export function buildPrompt(formData: BannerFormData): string {
  const { mainColor, aspectRatio, hasPersons, customPrompt } = formData;
  const dims = getBannerDimensions(formData);
  const theme = inferTheme(formData);

  const lines: string[] = [
    `CRITICAL RULE: This image must contain ZERO text, ZERO letters, ZERO numbers, ZERO characters, ZERO words in ANY language. Not even a single character. This is a strict background image only.`,
    ``,
    `Generate a professional, visually striking background wallpaper image for the theme: ${theme}.`,
    ``,
    `Style: Determine the most appropriate visual style automatically — photographic, illustrative, abstract, or mixed media.`,
    `Color: Use ${mainColor} as the primary or accent color. Build a harmonious palette around it.`,
    `Dimensions: ${dims.width}x${dims.height}px (${aspectRatio} aspect ratio).`,
    ``,
    hasPersons
      ? `Include a photorealistic person or people that fit the theme. Position them on one side (left or right third), leaving the center area open and relatively clean.`
      : `Do NOT include any people. Use graphics, patterns, abstract shapes, illustrations, textures, or photography of objects/scenes.`,
    ``,
    `Composition:`,
    `- The center 40-60% must be relatively clean and simple — this area will have text overlaid later by software.`,
    `- Place strong visual elements, decorative graphics, and visual interest around the edges and corners.`,
    `- Create depth and visual hierarchy that draws the eye toward the center.`,
    `- The image should look polished and complete as a standalone background.`,
  ];

  if (customPrompt.trim()) {
    lines.push(
      ``,
      `Additional visual direction: ${customPrompt.trim()}`,
      `(Interpret this as a visual/scene description only. Do NOT render any of these words as visible text in the image.)`,
    );
  }

  lines.push(
    ``,
    `FINAL REMINDER: Absolutely NO text, NO letters, NO numbers, NO writing, NO watermarks, NO logos, NO signatures anywhere in the image. The output must be a pure visual background with zero readable content.`,
  );

  return lines.join('\n');
}
