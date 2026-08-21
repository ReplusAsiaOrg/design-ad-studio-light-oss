/**
 * クライアント側で画像を自動縮小する（参照画像のアップロード用）。
 *
 * 背景: スクリーンショットは PNG 無圧縮＋画面解像度フル（Retinaで2倍）のため、
 * 見た目の割にファイルが重い（数MB）。重い参照画像をそのまま送ると、本番
 * （サーバーレス関数のリクエストボディ上限 ≒ 6MB）で 413 になり、レスポンスが
 * JSON でないため「Unexpected token ... is not valid JSON」で落ちる。
 *
 * そこで送る前に長辺を抑えて JPEG 圧縮するだけでなく、最終的な data URL の
 * バイト数が maxBytes 以下に収まるまで品質→寸法の順に段階縮小する。
 * 「長辺が小さくても無圧縮 PNG で重い」ケースも確実に上限以下へ落とす。
 *
 * canvas を使うのでブラウザ専用。data URL を受け取り data URL を返す。
 */
export async function downscaleImageDataUrl(
  dataUrl: string,
  maxDim = 1536,
  quality = 0.85,
  // base64 data URL の文字数 ≒ HTTP ボディのバイト数。本番上限6MBに対し余裕をみる。
  maxBytes = 4_500_000,
): Promise<string> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img;
      // 寸法も容量も十分小さければ再エンコード不要でそのまま返す。
      if (Math.max(w, h) <= maxDim && dataUrl.length <= maxBytes) {
        resolve(dataUrl);
        return;
      }

      const render = (scale: number, q: number): string | null => {
        const width = Math.max(1, Math.round(w * scale));
        const height = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        // 透過PNGを白背景に乗せてJPEG化（参照画像に透過は不要なため）
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        try {
          return canvas.toDataURL('image/jpeg', q);
        } catch {
          return null;
        }
      };

      let scale = Math.min(1, maxDim / Math.max(w, h));
      let q = quality;
      let out = render(scale, q);
      if (!out) {
        resolve(dataUrl);
        return;
      }
      // まだ上限超過なら、まず品質を、限界まで下げたら寸法を段階縮小（最大6回）
      let tries = 0;
      while (out.length > maxBytes && tries < 6) {
        if (q > 0.5) {
          q = Math.max(0.5, q - 0.15);
        } else {
          scale *= 0.8;
        }
        const next = render(scale, q);
        if (!next) break;
        out = next;
        tries++;
      }
      resolve(out);
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
