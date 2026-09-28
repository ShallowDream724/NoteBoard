const mimeByExtension: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif', ico: 'image/x-icon', tif: 'image/tiff', tiff: 'image/tiff',
};

function imageMime(bytes: Uint8Array, path: string): string {
  const starts = (...signature: number[]) => signature.every((value, index) => bytes[index] === value);
  const header = String.fromCharCode(...bytes.subarray(0, 40));
  if (starts(137, 80, 78, 71, 13, 10, 26, 10)) return 'image/png';
  if (starts(255, 216, 255)) return 'image/jpeg';
  if (/^GIF8[79]a/.test(header)) return 'image/gif';
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') return 'image/webp';
  if (starts(66, 77)) return 'image/bmp';
  if (starts(0, 0, 1, 0)) return 'image/x-icon';
  if (starts(73, 73, 42, 0) || starts(77, 77, 0, 42)) return 'image/tiff';
  if (header.slice(4, 8) === 'ftyp' && /avif|avis/.test(header.slice(8, 40))) return 'image/avif';
  if (/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(new TextDecoder().decode(bytes.subarray(0, 1024)))) return 'image/svg+xml';
  const mime = mimeByExtension[path.split('.').pop()?.toLowerCase() ?? ''];
  if (!mime) throw new Error('无法识别图片格式');
  return mime;
}

async function dataUrl(bytes: Uint8Array, path: string, signal?: AbortSignal): Promise<string> {
  if (!bytes.length) throw new Error('图片文件为空');
  const mime = imageMime(bytes, path), chunks: string[] = [];
  // A multiple of three keeps base64 padding confined to the final chunk. No
  // image decoding, canvas, or whole-file binary string is needed.
  const chunkSize = 24 * 1024;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    signal?.throwIfAborted();
    chunks.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))));
    if ((offset / chunkSize + 1) % 32 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  signal?.throwIfAborted();
  return `data:${mime};base64,${chunks.join('')}`;
}

/** Read each original once, sequentially, so only one source byte buffer is live. */
export async function portableHtmlAssetUrls(paths: string[], signal?: AbortSignal): Promise<string[]> {
  signal?.throwIfAborted();
  const { readFile } = await import('@tauri-apps/plugin-fs');
  const urls = new Map<string, string>();
  for (const path of paths) {
    signal?.throwIfAborted();
    if (urls.has(path)) continue;
    try {
      const bytes = await readFile(path);
      signal?.throwIfAborted();
      urls.set(path, await dataUrl(bytes, path, signal));
    } catch (error) {
      signal?.throwIfAborted();
      throw new Error(`无法内嵌本地图片“${path}”：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return paths.map(path => urls.get(path)!);
}
