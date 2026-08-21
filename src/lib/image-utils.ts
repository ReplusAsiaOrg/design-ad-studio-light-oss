import sharp from 'sharp';

type LogoPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/**
 * 複数の参照画像を横に並べて1枚に合成する。
 */
export async function composeReferenceImages(images: string[]): Promise<string> {
  if (images.length === 0) throw new Error('画像がありません');
  if (images.length === 1) return images[0];

  const buffers = images.map(img => {
    const base64Data = img.replace(/^data:image\/\w+;base64,/, '');
    return Buffer.from(base64Data, 'base64');
  });

  const resized = await Promise.all(
    buffers.map(buf => sharp(buf).resize({ height: 512 }).toBuffer({ resolveWithObject: true }))
  );

  const totalWidth = resized.reduce((sum, r) => sum + r.info.width, 0);

  let left = 0;
  const compositeInputs = resized.map(r => {
    const input = { input: r.data, left, top: 0 };
    left += r.info.width;
    return input;
  });

  const composed = await sharp({
    create: { width: totalWidth, height: 512, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite(compositeInputs)
    .png()
    .toBuffer();

  return `data:image/png;base64,${composed.toString('base64')}`;
}

/**
 * 生成済みバナーの上にロゴをそのまま合成する。
 * ロゴは指定位置にマージン付きで配置し、バナー幅の15%程度にリサイズ。
 */
export async function overlayLogo(
  bannerBase64: string,
  logoBase64: string,
  position: LogoPosition = 'bottom-right'
): Promise<string> {
  const bannerData = bannerBase64.replace(/^data:image\/\w+;base64,/, '');
  const logoData = logoBase64.replace(/^data:image\/\w+;base64,/, '');

  const bannerBuffer = Buffer.from(bannerData, 'base64');
  const logoBuffer = Buffer.from(logoData, 'base64');

  const bannerMeta = await sharp(bannerBuffer).metadata();
  const bannerWidth = bannerMeta.width!;
  const bannerHeight = bannerMeta.height!;

  // ロゴをバナー幅の15%にリサイズ（アスペクト比維持）
  const logoMaxWidth = Math.round(bannerWidth * 0.15);
  const resizedLogo = await sharp(logoBuffer)
    .resize({ width: logoMaxWidth, withoutEnlargement: true })
    .toBuffer({ resolveWithObject: true });

  const logoW = resizedLogo.info.width;
  const logoH = resizedLogo.info.height;
  const margin = Math.round(bannerWidth * 0.03);

  let left: number;
  let top: number;

  switch (position) {
    case 'top-left':
      left = margin;
      top = margin;
      break;
    case 'top-right':
      left = bannerWidth - logoW - margin;
      top = margin;
      break;
    case 'bottom-left':
      left = margin;
      top = bannerHeight - logoH - margin;
      break;
    case 'bottom-right':
    default:
      left = bannerWidth - logoW - margin;
      top = bannerHeight - logoH - margin;
      break;
  }

  const result = await sharp(bannerBuffer)
    .composite([{ input: resizedLogo.data, left, top }])
    .png()
    .toBuffer();

  return result.toString('base64');
}

/**
 * 静的背景の上にAI生成イラストを低透明度でオーバーレイ合成する。
 * ピクセル単位で直接ブレンド: result = frame*(1-opacity) + illustration*opacity
 */
export async function overlayIllustration(
  frameBase64: string,
  illustrationBase64: string,
  opacity: number = 0.2
): Promise<string> {
  const frameData = frameBase64.replace(/^data:image\/\w+;base64,/, '');
  const illustrationData = illustrationBase64.replace(/^data:image\/\w+;base64,/, '');

  const frameBuffer = Buffer.from(frameData, 'base64');
  const illustrationBuffer = Buffer.from(illustrationData, 'base64');

  const frameMeta = await sharp(frameBuffer).metadata();
  const width = frameMeta.width!;
  const height = frameMeta.height!;

  // 両画像をRGBAの生ピクセルに変換
  const frameRaw = await sharp(frameBuffer).ensureAlpha().raw().toBuffer();
  const illRaw = await sharp(illustrationBuffer)
    .resize({ width, height, fit: 'cover' })
    .ensureAlpha()
    .raw()
    .toBuffer();

  // ピクセル直接ブレンド
  const inv = 1 - opacity;
  const result = Buffer.alloc(frameRaw.length);
  for (let i = 0; i < frameRaw.length; i += 4) {
    result[i]     = Math.round(frameRaw[i]     * inv + illRaw[i]     * opacity); // R
    result[i + 1] = Math.round(frameRaw[i + 1] * inv + illRaw[i + 1] * opacity); // G
    result[i + 2] = Math.round(frameRaw[i + 2] * inv + illRaw[i + 2] * opacity); // B
    result[i + 3] = 255; // A
  }

  const output = await sharp(result, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();

  return output.toString('base64');
}

/**
 * 画像を指定ピクセルへ正確に合わせる（cover=中央基準で切り出し）。カスタムサイズ用（Issue #29）。
 * 生成エンジンは固定フレームしか出せないため、近い比率で生成した画像をここで最終寸法に揃える。
 */
export async function resizeCoverExact(
  imageBase64: string,
  width: number,
  height: number,
): Promise<string> {
  const data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
  const out = await sharp(Buffer.from(data, 'base64'))
    .resize(width, height, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();
  return out.toString('base64');
}
