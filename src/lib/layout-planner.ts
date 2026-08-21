import { BannerFormData, getBannerDimensions, DesignPlan, DesignElement, DecorationStyle } from './types';

export function buildLayoutPrompt(formData: BannerFormData): string {
  const dims = getBannerDimensions(formData);

  const textItems: string[] = [];
  if (formData.mainText) textItems.push(`- HEADLINE (most important, largest): "${formData.mainText}"`);
  if (formData.subText) textItems.push(`- SUBTEXT (secondary importance): "${formData.subText}"`);
  formData.extraTexts.forEach((et, i) => {
    if (et.text) textItems.push(`- EXTRA${i + 1} (supporting info): "${et.text}"`);
  });

  return `You are a bold, energetic Japanese advertising designer known for high-impact banner designs.

Canvas: ${dims.width}x${dims.height}px
Brand color: ${formData.mainColor}

Text elements to design:
${textItems.join('\n')}

Return ONLY valid JSON (no markdown, no explanation).

Decoration types:
- "none": Plain text with thick stroke. Use for BIG headlines.
- "ribbon": Ribbon shape with pointed ends. For promotions, benefits.
- "highlight": Rounded rectangle fill. For CTAs, dates, sub-info.
- "arrow": Arrow-shaped ribbon. For directional callouts.
- "badge": Filled circle. ONLY for 1-4 character labels (特典, NEW, etc).
- "circle": Circle outline. For short numbers/labels.

JSON format:
{
  "elements": [
    {
      "id": "main",
      "text": "ウィンターバーゲン",
      "x": ${Math.round(dims.width / 2)},
      "y": ${Math.round(dims.height * 0.45)},
      "fontSize": 110,
      "fontWeight": "bold",
      "color": "#ffffff",
      "rotation": 0,
      "letterSpacing": 4,
      "decoration": "none",
      "decorationColor": "#FF4444",
      "stroke": true,
      "strokeColor": "${formData.mainColor}",
      "strokeWidth": 6,
      "shadow": true,
      "shadowColor": "rgba(0,0,0,0.7)"
    }
  ]
}

CRITICAL DESIGN RULES — follow these strictly:

**HEADLINE IMPACT (most important):**
- fontSize MUST be 90-130px for 1024px canvas. Go BIG. Fill the width.
- If headline is long (6+ chars), it can span multiple visual lines — just make the fontSize huge.
- ALWAYS white (#ffffff) text color with thick colored stroke (strokeWidth: 5-8, strokeColor: brand color or dark color).
- This makes text pop against ANY background.

**VISUAL HIERARCHY:**
- Headline should visually dominate — at least 2.5x the fontSize of other elements.
- Secondary text: 28-40px with ribbon or highlight decoration.
- Small supporting text: 18-26px.

**DECORATIONS — use them aggressively:**
- At least 50% of non-headline elements should have a decoration (ribbon, highlight, badge, arrow).
- Ribbon color should be vibrant and contrasting (not the same as background).
- Badge is perfect for short urgency words: 完売必至, 特典, NEW, 限定, etc.
- Highlight for medium-length text that needs emphasis.

**COLOR & CONTRAST:**
- Headline: ALWAYS white text + colored or dark stroke. Never dark text on photo.
- Decoration fills: Use bright, saturated colors. Not muted, not semi-transparent.
- Text on decorations: white on dark decoration, or dark on bright decoration.
- Minimum 4:1 contrast ratio between text and its background.

**POSITIONING:**
- Center the headline (x = ${Math.round(dims.width / 2)}).
- Spread other elements to fill the canvas — use top, bottom, and sides.
- Short badge/circle items work well in corners.
- Keep 40px+ margin from canvas edges.

Return ONLY the JSON.`;
}

const VALID_DECORATIONS: DecorationStyle[] = ['none', 'ribbon', 'badge', 'highlight', 'arrow', 'circle'];

export function parseLayoutResponse(json: string, formData: BannerFormData): DesignPlan {
  try {
    let cleaned = json.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(cleaned);

    if (!parsed.elements || !Array.isArray(parsed.elements)) {
      throw new Error('Invalid layout: missing elements array');
    }

    const dims = getBannerDimensions(formData);
    const elements: DesignElement[] = parsed.elements.map((el: Record<string, unknown>, i: number) => ({
      id: String(el.id || `el-${i}`),
      text: String(el.text || ''),
      x: Math.min(Math.max(Number(el.x) || dims.width / 2, 0), dims.width),
      y: Math.min(Math.max(Number(el.y) || dims.height / 2, 0), dims.height),
      fontSize: Math.min(Math.max(Number(el.fontSize) || 40, 12), 200),
      fontWeight: el.fontWeight === 'bold' ? 'bold' as const : 'normal' as const,
      color: String(el.color || '#ffffff'),
      rotation: Math.min(Math.max(Number(el.rotation) || 0, -30), 30),
      letterSpacing: Math.min(Math.max(Number(el.letterSpacing) || 0, -5), 30),
      decoration: VALID_DECORATIONS.includes(el.decoration as DecorationStyle)
        ? (el.decoration as DecorationStyle)
        : 'none',
      decorationColor: String(el.decorationColor || formData.mainColor),
      stroke: Boolean(el.stroke),
      strokeColor: String(el.strokeColor || '#000000'),
      strokeWidth: Math.min(Math.max(Number(el.strokeWidth) || 2, 0), 10),
      shadow: el.shadow !== false,
      shadowColor: String(el.shadowColor || 'rgba(0,0,0,0.5)'),
    }));

    return { elements: elements.filter(el => el.text.trim()) };
  } catch {
    return createFallbackPlan(formData);
  }
}

export function createFallbackPlan(formData: BannerFormData, options?: { align?: 'center' | 'left' }): DesignPlan {
  const dims = getBannerDimensions(formData);
  const elements: DesignElement[] = [];
  const align = options?.align ?? 'center';

  const xPos = align === 'left' ? dims.width * 0.28 : dims.width / 2;

  if (formData.mainText) {
    elements.push({
      id: 'main',
      text: formData.mainText,
      x: xPos,
      y: dims.height * 0.32,
      fontSize: 80,
      fontWeight: 'bold',
      color: '#333333',
      rotation: 0,
      letterSpacing: 0,
      decoration: 'none',
      decorationColor: formData.mainColor,
      stroke: false,
      strokeColor: '#000000',
      strokeWidth: 0,
      shadow: false,
      shadowColor: 'rgba(0,0,0,0.2)',
    });
  }

  if (formData.subText) {
    elements.push({
      id: 'sub',
      text: formData.subText,
      x: xPos,
      y: dims.height * 0.58,
      fontSize: 48,
      fontWeight: 'bold',
      color: '#ffffff',
      rotation: 0,
      letterSpacing: 2,
      decoration: 'highlight',
      decorationColor: '#d4a08a',
      stroke: false,
      strokeColor: '#000000',
      strokeWidth: 0,
      shadow: false,
      shadowColor: 'rgba(0,0,0,0.3)',
    });
  }

  formData.extraTexts.forEach((et, i) => {
    if (et.text) {
      elements.push({
        id: et.id,
        text: et.text,
        x: xPos,
        y: dims.height * 0.76 + i * dims.height * 0.08,
        fontSize: 36,
        fontWeight: 'normal',
        color: '#333333',
        rotation: 0,
        letterSpacing: 0,
        decoration: 'none',
        decorationColor: formData.mainColor,
        stroke: false,
        strokeColor: '#000000',
        strokeWidth: 0,
        shadow: false,
        shadowColor: 'rgba(0,0,0,0.3)',
      });
    }
  });

  return { elements };
}
