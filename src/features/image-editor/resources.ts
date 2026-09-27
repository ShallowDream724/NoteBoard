export interface ImageResource {
  /** Decoded preview or original pixels. Throws after disposal. */
  readonly image: CanvasImageSource;
  readonly width: number;
  readonly height: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly disposed: boolean;
  /** Compressed source only, for transfer to the export worker without pixel copies. */
  getBlob(): Blob;
  getOriginal(signal?: AbortSignal): Promise<ImageResource>;
  dispose(): void;
}

export interface LoadImageResourceOptions { readonly maxDimension?: number }
export const DEFAULT_PREVIEW_DIMENSION = 2048;

export function throwIfImageEditAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('图片编辑已取消', 'AbortError');
}

export function releaseCanvas(canvas: HTMLCanvasElement | OffscreenCanvas): void {
  canvas.width = 0;
  canvas.height = 0;
}

function disposeImage(image: CanvasImageSource): void {
  if ('close' in image && typeof image.close === 'function') image.close();
  else if (image instanceof HTMLImageElement) image.removeAttribute('src');
  else if (image instanceof HTMLCanvasElement) releaseCanvas(image);
}

async function loadHtmlImage(blob: Blob, signal?: AbortSignal): Promise<HTMLImageElement> {
  throwIfImageEditAborted(signal);
  const url = URL.createObjectURL(blob), image = new Image();
  image.decoding = 'async';
  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { image.onload = null; image.onerror = null; signal?.removeEventListener('abort', abort); };
      const abort = () => { cleanup(); image.removeAttribute('src'); reject(new DOMException('图片解码已取消', 'AbortError')); };
      image.onload = () => { cleanup(); resolve(); };
      image.onerror = () => { cleanup(); reject(new Error('无法解码图片，请确认文件格式受支持且文件完整')); };
      signal?.addEventListener('abort', abort, { once: true });
      image.src = url;
    });
    throwIfImageEditAborted(signal);
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('图片没有可用的像素尺寸');
    return image;
  } catch (error) {
    image.removeAttribute('src');
    throw error;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function decodeResource(blob: Blob, maxDimension: number, signal?: AbortSignal): Promise<ImageResource> {
  // The temporary HTML decoder supplies orientation-correct dimensions. It is never
  // retained with the bounded bitmap; the compressed Blob is the export source.
  let htmlImage: HTMLImageElement | null = await loadHtmlImage(blob, signal);
  const width = htmlImage.naturalWidth, height = htmlImage.naturalHeight;
  const ratio = Math.min(1, maxDimension / Math.max(width, height));
  const pixelWidth = Math.max(1, Math.round(width * ratio)), pixelHeight = Math.max(1, Math.round(height * ratio));
  let pixels: CanvasImageSource | null = null;
  try {
    if (ratio < 1 && typeof createImageBitmap === 'function') {
      // Decode from the oriented image, avoiding a second EXIF orientation decision.
      pixels = await createImageBitmap(htmlImage, { resizeWidth: pixelWidth, resizeHeight: pixelHeight, resizeQuality: 'high' });
      htmlImage.removeAttribute('src');
      htmlImage = null;
    } else if (ratio < 1) {
      const canvas = document.createElement('canvas');
      canvas.width = pixelWidth; canvas.height = pixelHeight;
      try {
        const context = canvas.getContext('2d');
        if (!context) throw new Error('无法创建图片预览画布');
        context.drawImage(htmlImage, 0, 0, pixelWidth, pixelHeight);
        pixels = canvas;
      } catch (error) { releaseCanvas(canvas); throw error; }
      htmlImage.removeAttribute('src');
      htmlImage = null;
    } else {
      pixels = htmlImage;
      htmlImage = null;
    }
    throwIfImageEditAborted(signal);
  } catch (error) {
    htmlImage?.removeAttribute('src');
    if (pixels) disposeImage(pixels);
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error('图片解码失败，可能超出当前设备的可用内存', { cause: error });
  }
  let compressed: Blob | null = blob;
  return {
    get image() { if (!pixels) throw new Error('图片编辑资源已释放'); return pixels; },
    width, height, pixelWidth, pixelHeight,
    get disposed() { return pixels === null; },
    getBlob() { if (!compressed || !pixels) throw new Error('图片编辑资源已释放'); return compressed; },
    async getOriginal(nextSignal) {
      throwIfImageEditAborted(nextSignal);
      if (!compressed || !pixels) throw new Error('图片编辑资源已释放，请重新打开图片');
      return decodeResource(compressed, Infinity, nextSignal);
    },
    dispose() { if (pixels) disposeImage(pixels); pixels = null; compressed = null; },
  };
}

export async function loadImageResource(src: string | Blob, signal?: AbortSignal, options: LoadImageResourceOptions = {}): Promise<ImageResource> {
  throwIfImageEditAborted(signal);
  const maxDimension = options.maxDimension ?? DEFAULT_PREVIEW_DIMENSION;
  if (!(maxDimension > 0)) throw new Error('图片预览尺寸必须大于零');
  let blob: Blob;
  try {
    if (typeof src === 'string') {
      const response = await fetch(src, { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      blob = await response.blob();
    } else blob = src;
    throwIfImageEditAborted(signal);
  } catch (error) {
    if (signal?.aborted || error instanceof DOMException && error.name === 'AbortError') throw new DOMException('图片加载已取消', 'AbortError');
    throw new Error('无法读取原图，请确认图片文件可用或远程地址允许访问', { cause: error });
  }
  if (!blob.size) throw new Error('图片文件为空');
  return decodeResource(blob, maxDimension, signal);
}
