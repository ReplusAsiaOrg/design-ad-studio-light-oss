export interface FontOption {
  value: string;
  label: string;
  category: 'sans' | 'serif' | 'display' | 'handwriting';
  googleFont: string;
}

export const FONT_OPTIONS: FontOption[] = [
  { value: 'Noto Sans JP', label: 'Noto Sans JP', category: 'sans', googleFont: 'Noto+Sans+JP:wght@100;300;400;500;700;900' },
  { value: 'Noto Serif JP', label: 'Noto Serif JP', category: 'serif', googleFont: 'Noto+Serif+JP:wght@200;300;400;500;600;700;900' },
  { value: 'M PLUS 1p', label: 'M PLUS 1p', category: 'sans', googleFont: 'M+PLUS+1p:wght@100;300;400;500;700;800;900' },
  { value: 'M PLUS Rounded 1c', label: 'M PLUS Rounded 1c', category: 'sans', googleFont: 'M+PLUS+Rounded+1c:wght@100;300;400;500;700;800;900' },
  { value: 'Zen Kaku Gothic New', label: 'Zen Kaku Gothic New', category: 'sans', googleFont: 'Zen+Kaku+Gothic+New:wght@300;400;500;700;900' },
  { value: 'Zen Maru Gothic', label: 'Zen Maru Gothic', category: 'sans', googleFont: 'Zen+Maru+Gothic:wght@300;400;500;700;900' },
  { value: 'Shippori Mincho', label: 'しっぽり明朝', category: 'serif', googleFont: 'Shippori+Mincho:wght@400;500;600;700;800' },
  { value: 'Zen Old Mincho', label: 'Zen Old Mincho', category: 'serif', googleFont: 'Zen+Old+Mincho:wght@400;500;600;700;900' },
  { value: 'Kosugi Maru', label: '小杉丸ゴシック', category: 'sans', googleFont: 'Kosugi+Maru' },
  { value: 'Sawarabi Gothic', label: 'さわらびゴシック', category: 'sans', googleFont: 'Sawarabi+Gothic' },
];

export const DISPLAY_FONTS: FontOption[] = [
  { value: 'Inter', label: 'Inter', category: 'sans', googleFont: 'Inter:wght@100;300;400;500;600;700;800;900' },
  { value: 'Red Hat Display', label: 'Red Hat Display', category: 'display', googleFont: 'Red+Hat+Display:wght@300;400;500;600;700;800;900' },
  { value: 'Montserrat', label: 'Montserrat', category: 'sans', googleFont: 'Montserrat:wght@100;300;400;500;600;700;800;900' },
  { value: 'Poppins', label: 'Poppins', category: 'sans', googleFont: 'Poppins:wght@100;300;400;500;600;700;800;900' },
  { value: 'Oswald', label: 'Oswald', category: 'display', googleFont: 'Oswald:wght@200;300;400;500;600;700' },
];

export function getAllFonts(): FontOption[] {
  return [...FONT_OPTIONS, ...DISPLAY_FONTS];
}

export function getGoogleFontsUrl(): string {
  const allFonts = getAllFonts();
  const families = allFonts.map(f => `family=${f.googleFont}`).join('&');
  return `https://fonts.googleapis.com/css2?${families}&display=swap`;
}
