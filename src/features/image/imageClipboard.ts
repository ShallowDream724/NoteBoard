import { copyPngImage } from '../../core/ipc/commands';

interface ImageSize { readonly width: number; readonly height: number }

const mimeByExtension: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
};

async function sourceBlob(src: string, localFilePath?: string): Promise<Blob> {
  try {
    const response = await fetch(src, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('无法读取图片');
    return await response.blob();
  } catch (error) {
    if (!localFilePath) throw error;
    const { readFile } = await import('@tauri-apps/plugin-fs');
    const extension = localFilePath.split('.').pop()?.toLowerCase() ?? '';
    return new Blob([await readFile(localFilePath)], { type: mimeByExtension[extension] || '' });
  }
}

async function pngFromSource(src: string, expectedSize: ImageSize, localFilePath?: string): Promise<Blob> {
  // Displayed asset: URLs may taint canvases. A Blob URL decoded from source bytes is origin-clean.
  const blob = await sourceBlob(src, localFilePath);
  const url = URL.createObjectURL(blob);
  let decoded: HTMLImageElement | null = null;
  try {
    decoded = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('无法解码图片'));
      image.src = url;
    });
    if (decoded.naturalWidth !== expectedSize.width || decoded.naturalHeight !== expectedSize.height) {
      throw new Error('图片已变化，请重新打开后复制');
    }
    const canvas = document.createElement('canvas');
    try {
      canvas.width = expectedSize.width;
      canvas.height = expectedSize.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('无法创建 2D 上下文');
      context.drawImage(decoded, 0, 0);
      return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(result => result ? resolve(result) : reject(new Error('无法编码图片')), 'image/png');
      });
    } finally {
      // Release full-resolution pixels before either clipboard write can block.
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    if (decoded) decoded.src = '';
    URL.revokeObjectURL(url);
  }
}

/** Copy original image pixels as PNG; caller owns UI feedback and duplicate-click control. */
export async function copyImageSource(src: string, expectedSize: ImageSize, localFilePath?: string): Promise<void> {
  const png = await pngFromSource(src, expectedSize, localFilePath);
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('浏览器图片剪贴板不可用');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  } catch {
    await copyPngImage(new Uint8Array(await png.arrayBuffer()));
  }
}
