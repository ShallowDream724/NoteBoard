// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadImageResource } from '../../src/features/image-editor/resources';

describe('image edit resource ownership', () => {
  let images: HTMLImageElement[], bitmap: { close: ReturnType<typeof vi.fn> }, autoLoad: boolean;
  beforeEach(() => {
    images = []; bitmap = { close: vi.fn() }; autoLoad = true;
    vi.stubGlobal('Image', function () {
      const image = document.createElement('img');
      Object.defineProperties(image, { naturalWidth: { value: 8192 }, naturalHeight: { value: 4096 } });
      Object.defineProperty(image, 'src', { set: () => { if (autoLoad) queueMicrotask(() => image.dispatchEvent(new Event('load'))); } });
      vi.spyOn(image, 'removeAttribute');
      images.push(image);
      return image;
    });
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(['source'], { type: 'image/png' })) }));
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:editor') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('keeps a bounded active preview and decodes full resolution only on request', async () => {
    const preview = await loadImageResource('asset://original');
    expect([preview.width, preview.height, preview.pixelWidth, preview.pixelHeight]).toEqual([8192, 4096, 2048, 1024]);
    expect(createImageBitmap).toHaveBeenCalledWith(images[0], { resizeWidth: 2048, resizeHeight: 1024, resizeQuality: 'high' });
    expect(images[0].removeAttribute).toHaveBeenCalledWith('src');
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
    const original = await preview.getOriginal();
    expect([original.pixelWidth, original.pixelHeight]).toEqual([8192, 4096]);
    expect(original.image).toBe(images[1]);
    expect(fetch).toHaveBeenCalledOnce();
    original.dispose();
    expect(images[1].removeAttribute).toHaveBeenCalledWith('src');
    preview.dispose(); preview.dispose();
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(preview.disposed).toBe(true);
    expect(() => preview.image).toThrow('已释放');
    await expect(preview.getOriginal()).rejects.toThrow('已释放');
  });

  it('cleans a preview bitmap that completes after cancellation', async () => {
    let complete!: (value: ImageBitmap) => void;
    vi.mocked(createImageBitmap).mockReturnValue(new Promise(resolve => { complete = resolve; }));
    const controller = new AbortController(), loading = loadImageResource(new Blob(['source']), controller.signal);
    await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledOnce());
    controller.abort(); complete(bitmap as unknown as ImageBitmap);
    await expect(loading).rejects.toMatchObject({ name: 'AbortError' });
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(images[0].removeAttribute).toHaveBeenCalledWith('src');
  });

  it('aborts a pending HTML decoder and revokes its temporary URL', async () => {
    autoLoad = false;
    const controller = new AbortController(), loading = loadImageResource(new Blob(['source']), controller.signal);
    controller.abort();
    await expect(loading).rejects.toMatchObject({ name: 'AbortError' });
    expect(images[0].removeAttribute).toHaveBeenCalledWith('src');
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it('reports source failures and makes no alternative cross-origin request', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(loadImageResource('https://example.invalid/private.png')).rejects.toThrow('无法读取原图');
    expect(fetch).toHaveBeenCalledOnce();
    expect(images).toHaveLength(0);
  });
});
