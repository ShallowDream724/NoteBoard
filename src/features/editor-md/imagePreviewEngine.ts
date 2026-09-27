import { inspectPreviewImage } from './imagePreviewFormat';

export interface ImagePreviewResult { blob: Blob; width: number; height: number }

/** Runs inside a worker. Browser display originals, document sources and export
 * bytes never pass through this derived preview encoder. */
export async function createDisplayImagePreview(blob: Blob, targetWidth: number): Promise<ImagePreviewResult | null> {
  const info = await inspectPreviewImage(blob);
  if (!info || info.width * info.height <= 4 * 1024 * 1024 || info.width <= targetWidth * 1.5) return null;
  let width = Math.min(info.width, targetWidth), height = Math.max(1, Math.round(info.height * width / info.width));
  // A 4096px square/landscape preview must remain usable. Very tall images
  // reduce proportionally to a bounded preview rather than loading the much
  // larger original just because a derived resource exceeded the budget.
  const ratio = Math.min(1, Math.sqrt(64 * 1024 * 1024 / (width * height * 4)));
  width = Math.max(1, Math.floor(width * ratio));
  height = Math.max(1, Math.floor(height * ratio));
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return null;
  let bitmap: ImageBitmap | null = null, canvas: OffscreenCanvas | null = null;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image', resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
    // A browser that applies EXIF/resize in a different order must keep its
    // original image path rather than stretch a mismatched preview bitmap.
    if (bitmap.width !== width || bitmap.height !== height) return null;
    canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close(); bitmap = null;
    const result = await canvas.convertToBlob({ type: 'image/png' });
    return { blob: result, width, height };
  } finally {
    bitmap?.close();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}
