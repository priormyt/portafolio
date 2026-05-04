/**
 * Procesa imágenes en el navegador usando Canvas:
 * - generaPreview(file): redimensiona a 800px y aplica watermark "A" centrada
 * - generaFinal(file):   redimensiona a 2400px sin watermark, calidad alta
 *
 * Devuelve un Blob (JPEG) listo para subir.
 */
window.imageProcessor = {
  async generaPreview(file) {
    return procesar(file, { maxDim: 800, quality: 0.78, watermark: true });
  },
  async generaFinal(file) {
    return procesar(file, { maxDim: 2400, quality: 0.92, watermark: false });
  },
};

async function procesar(file, { maxDim, quality, watermark }) {
  const img = await loadImage(file);
  const { width, height } = scaleTo(img.naturalWidth, img.naturalHeight, maxDim);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas no disponible');

  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);

  if (watermark) {
    drawWatermark(ctx, width, height);
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('No se pudo generar JPEG'));
        else resolve(blob);
      },
      'image/jpeg',
      quality,
    );
  });
}

function scaleTo(w, h, maxDim) {
  if (w <= maxDim && h <= maxDim) return { width: w, height: h };
  const ratio = w > h ? maxDim / w : maxDim / h;
  return { width: Math.round(w * ratio), height: Math.round(h * ratio) };
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo abrir la imagen'));
    img.src = URL.createObjectURL(file);
  });
}

function drawWatermark(ctx, w, h) {
  const fontSize = Math.min(w, h) * 0.45;
  ctx.save();
  ctx.font = `${fontSize}px "Marion", Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(245, 242, 237, 0.30)';
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 8;
  ctx.fillText('A', w / 2, h / 2);
  ctx.restore();
}
