export function chromaKeyTexture(scene, key, { threshold = 220, fadeBand = 20 } = {}) {
  if (!scene.textures.exists(key)) return false;
  const src = scene.textures.get(key).getSourceImage();
  if (!src || !src.width || !src.height) return false;

  const canvas = document.createElement('canvas');
  canvas.width = src.width;
  canvas.height = src.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  const hi = threshold + fadeBand;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const lum = Math.min(r, g, b);
    if (lum >= hi) {
      data[i + 3] = 0;
    } else if (lum >= threshold) {
      const t = (lum - threshold) / fadeBand;
      data[i + 3] = Math.round(data[i + 3] * (1 - t));
    }
  }
  ctx.putImageData(imageData, 0, 0);

  scene.textures.remove(key);
  scene.textures.addCanvas(key, canvas);
  return true;
}

export function chromaKeyAll(scene, keys, opts) {
  for (const key of keys) chromaKeyTexture(scene, key, opts);
}
