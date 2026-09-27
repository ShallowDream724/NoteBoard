import { getOutputSize, validateImageEditRecipe } from './geometry';
import type { ImageEditRecipe } from './model';
import { renderImageEditAsync } from './renderer';
import { loadImageResource, releaseCanvas, throwIfImageEditAborted, type ImageResource } from './resources';

export type ImageExportMimeType = 'image/png' | 'image/jpeg' | 'image/webp';
export interface ImageExportOptions {
  readonly mimeType?: ImageExportMimeType;
  /** JPEG/WebP only, in the range 0..1. */
  readonly quality?: number;
  /** Explicit resize; one dimension preserves aspect ratio. Omit both for full size. */
  readonly width?: number;
  readonly height?: number;
  readonly signal?: AbortSignal;
  /** User explicitly accepted the estimated large-export memory requirement. */
  readonly allowLargeExport?: boolean;
}
export const IMAGE_EXPORT_LIMITS = Object.freeze({ maxDimension: 32767, maxPixels: 268435456, largeExportBytes: 512 * 1024 * 1024, webpMaxDimension: 16383 });
export class LargeImageExportConfirmationError extends Error {
  readonly estimatedBytes: number;
  constructor(estimatedBytes: number) {
    super(`本次导出预计至少需要 ${Math.ceil(estimatedBytes / 1024 / 1024)} MiB 像素内存，编码器还会占用额外内存。确认后可按完整分辨率继续。`);
    this.name = 'LargeImageExportConfirmationError'; this.estimatedBytes = estimatedBytes;
  }
}

export function getImageExportSize(recipe: ImageEditRecipe, options: Pick<ImageExportOptions, 'width' | 'height'> = {}): { width: number; height: number } {
  validateImageEditRecipe(recipe);
  const size = getOutputSize(recipe);
  const width = options.width ?? (options.height !== undefined ? options.height * size.width / size.height : size.width);
  const height = options.height ?? (options.width !== undefined ? options.width * size.height / size.width : size.height);
  if (![width, height].every(value => Number.isFinite(value) && value >= 1)) throw new Error('导出宽高必须为有效的正数');
  return { width: Math.round(width), height: Math.round(height) };
}

export function estimateImageExportMemory(recipe: ImageEditRecipe, options: Pick<ImageExportOptions, 'width' | 'height'> = {}, previewPixels = 0): number {
  const { width, height } = getImageExportSize(recipe, options);
  return (recipe.sourceWidth * recipe.sourceHeight + width * height + previewPixels) * 4;
}

export function assertImageExportCapacity(recipe: ImageEditRecipe, width: number, height: number, previewPixels = 0, allowLargeExport = false, mimeType: ImageExportMimeType = 'image/png'): void {
  const { maxDimension, maxPixels, largeExportBytes, webpMaxDimension } = IMAGE_EXPORT_LIMITS;
  if (width > maxDimension || height > maxDimension || width * height > maxPixels) throw new Error(`导出尺寸 ${width} × ${height} 超过浏览器画布容量（单边最多 ${maxDimension} 像素、总计最多 268435456 像素）。请主动选择较小的导出尺寸。`);
  if (mimeType === 'image/webp' && (width > webpMaxDimension || height > webpMaxDimension)) throw new Error('WebP 格式单边最多 16383 像素，请选择 PNG/JPEG 或主动缩小尺寸');
  const workingBytes = estimateImageExportMemory(recipe, { width, height }, previewPixels);
  if (workingBytes > largeExportBytes && !allowLargeExport) throw new LargeImageExportConfirmationError(workingBytes);
}

function exportInWorker(blob: Blob, recipe: ImageEditRecipe, width: number, height: number, mimeType: ImageExportMimeType, quality: number | undefined, signal?: AbortSignal): Promise<Blob> {
  throwIfImageEditAborted(signal);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' });
    let settled = false;
    const finish = (error: unknown, result?: Blob) => {
      if (settled) return;
      settled = true; signal?.removeEventListener('abort', abort); worker.terminate();
      if (error) reject(error); else resolve(result!);
    };
    const abort = () => finish(new DOMException('图片导出已取消', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ blob?: Blob; error?: string }>) => {
      if (event.data.error) finish(new Error(event.data.error));
      else if (event.data.blob) finish(null, event.data.blob);
      else finish(new Error('图片导出任务返回了无效结果'));
    };
    worker.onerror = event => { event.preventDefault(); finish(new Error('图片导出工作线程失败，请检查可用内存后重试')); };
    try { worker.postMessage({ blob, recipe, width, height, mimeType, quality }); }
    catch (error) { finish(error); }
  });
}

function encodeCanvas(canvas: HTMLCanvasElement, mimeType: ImageExportMimeType, quality: number | undefined, signal?: AbortSignal): Promise<Blob> {
  throwIfImageEditAborted(signal);
  return new Promise<Blob>((resolve, reject) => {
    let settled = false;
    const finish = (error: unknown, blob?: Blob) => {
      if (settled) return;
      settled = true; signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(blob!);
    };
    const abort = () => finish(new DOMException('图片导出已取消', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    try {
      canvas.toBlob(blob => {
        if (!blob || !blob.size) finish(new Error('图片编码失败，画布可能超出当前设备的容量'));
        else if (blob.type !== mimeType) finish(new Error('当前浏览器不支持所选导出格式，请选择 PNG'));
        else finish(null, blob);
      }, mimeType, quality);
    } catch (error) { finish(new Error('无法编码图片，请检查图片来源权限和可用内存', { cause: error })); }
  });
}

/** PNG is lossless for the rendered 8-bit canvas; source HDR/metadata are not retained. */
export async function exportImageEdit(source: ImageResource | string | Blob, recipe: ImageEditRecipe, options: ImageExportOptions = {}): Promise<Blob> {
  const { signal } = options;
  throwIfImageEditAborted(signal);
  const { width, height } = getImageExportSize(recipe, options), mimeType = options.mimeType ?? 'image/png';
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) throw new Error('不支持此图片导出格式');
  if (options.quality !== undefined && (!Number.isFinite(options.quality) || options.quality < 0 || options.quality > 1)) throw new Error('图片质量必须在 0 到 1 之间');
  assertImageExportCapacity(recipe, width, height, 0, options.allowLargeExport, mimeType);
  let ownedPreview: ImageResource | null = null, ownedOriginal: ImageResource | null = null;
  let canvas: HTMLCanvasElement | null = null;
  try {
    const preview = typeof source === 'string' || source instanceof Blob ? (ownedPreview = await loadImageResource(source, signal)) : source;
    if (preview.width !== recipe.sourceWidth || preview.height !== recipe.sourceHeight) throw new Error('原图尺寸已变化，请重新打开编辑器');
    const previewPixels = preview.pixelWidth * preview.pixelHeight;
    assertImageExportCapacity(recipe, width, height, preview.pixelWidth === preview.width && preview.pixelHeight === preview.height ? 0 : previewPixels, options.allowLargeExport, mimeType);
    if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
      return await exportInWorker(preview.getBlob(), recipe, width, height, mimeType, mimeType === 'image/png' ? undefined : options.quality ?? .92, signal);
    }
    const original = preview.pixelWidth === preview.width && preview.pixelHeight === preview.height ? preview : (ownedOriginal = await preview.getOriginal(signal));
    throwIfImageEditAborted(signal);
    canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建导出画布，请缩小导出尺寸或释放内存后重试');
    await renderImageEditAsync(context, original, recipe, { width, height }, signal);
    if (mimeType === 'image/jpeg') {
      context.save();
      try { context.globalCompositeOperation = 'destination-over'; context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height); }
      finally { context.restore(); }
    }
    throwIfImageEditAborted(signal);
    return await encodeCanvas(canvas, mimeType, mimeType === 'image/png' ? undefined : options.quality ?? .92, signal);
  } finally {
    if (canvas) releaseCanvas(canvas);
    ownedOriginal?.dispose();
    ownedPreview?.dispose();
  }
}
