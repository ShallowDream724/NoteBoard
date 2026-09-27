import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inspectPreviewImage } from '../../src/features/editor-md/imagePreviewFormat';
import { createDisplayImagePreview } from '../../src/features/editor-md/imagePreviewEngine';
import { canRequestImagePreview, ImageDisplayPreviewCache, imagePreviewWidth } from '../../src/features/editor-md/imagePreviewCache';

const blob = (parts: BlobPart[]) => new NodeBlob(parts as ConstructorParameters<typeof NodeBlob>[0]) as unknown as Blob;
function png(width: number, height: number, depth = 8, extra = ''): Blob {
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = depth; header[9] = 6;
  const chunk = (kind: string, data = Buffer.alloc(0)) => { const length = Buffer.alloc(4); length.writeUInt32BE(data.length); return Buffer.concat([length, Buffer.from(kind), data, Buffer.alloc(4)]); };
  return blob([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), ...(extra ? [chunk(extra)] : []), chunk('IDAT', Buffer.from([1])), chunk('IEND')]);
}
function jpeg(depth = 8, marker?: number, payload = Buffer.from('unknown'), orientation = 1): Blob {
  const segment = (tag: number, bytes: Buffer) => { const length = Buffer.alloc(2); length.writeUInt16BE(bytes.length + 2); return Buffer.concat([Buffer.from([0xff, tag]), length, bytes]); };
  const frame = Buffer.from([depth, 0x08, 0x70, 0x0f, 0x00, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]);
  const exif = Buffer.alloc(32); exif.write('Exif\0\0II', 0, 'binary'); exif.writeUInt16LE(42, 8); exif.writeUInt32LE(8, 10); exif.writeUInt16LE(1, 14); exif.writeUInt16LE(0x112, 16); exif.writeUInt16LE(3, 18); exif.writeUInt32LE(1, 20); exif.writeUInt16LE(orientation, 24);
  return blob([Buffer.from([0xff, 0xd8]), ...(orientation !== 1 ? [segment(0xe1, exif)] : []), ...(marker ? [segment(marker, payload)] : []), segment(0xc0, frame), Buffer.from([0xff, 0xda, 0, 2, 0xff, 0xd9])]);
}
function webp(flags = 0): Blob {
  const extended = Buffer.alloc(10); extended[0] = flags; extended.writeUIntLE(3839, 4, 3); extended.writeUIntLE(2159, 7, 3);
  const pixels = Buffer.from([0, 0, 0, 0x9d, 1, 0x2a, 0, 15, 0x70, 8]);
  const chunk = (kind: string, bytes: Buffer) => { const length = Buffer.alloc(4); length.writeUInt32LE(bytes.length); return Buffer.concat([Buffer.from(kind), length, bytes]); };
  const chunks = Buffer.concat([chunk('VP8X', extended), chunk('VP8 ', pixels)]);
  const header = Buffer.alloc(12); header.write('RIFF'); header.writeUInt32LE(chunks.length + 4, 4); header.write('WEBP', 8);
  return blob([header, chunks]);
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('display preview format whitelist', () => {
  it('accepts ordinary static 8-bit PNG, JPEG and WebP without decoding', async () => {
    expect(await inspectPreviewImage(png(3840, 2160))).toEqual({ width: 3840, height: 2160, format: 'png' });
    expect(await inspectPreviewImage(jpeg())).toEqual({ width: 3840, height: 2160, format: 'jpeg' });
    expect(await inspectPreviewImage(webp())).toEqual({ width: 3840, height: 2160, format: 'webp' });
  });
  it.each(['acTL', 'fcTL', 'iCCP', 'cICP', 'mDCV', 'cLLI', 'eXIf', 'zXYZ'])('keeps PNG %s metadata on the original decoder', async kind => {
    expect(await inspectPreviewImage(png(3840, 2160, 8, kind))).toBeNull();
  });
  it('keeps high bit depths, animation, color profiles, gain maps, SVG and GIF unchanged', async () => {
    for (const file of [png(3840, 2160, 16), jpeg(12), jpeg(8, 0xe1), jpeg(8, 0xe2), jpeg(8, 0xeb), webp(2), webp(0x20), blob(['GIF89a.....']), blob(['<svg width="4000"/>'])]) {
      expect(await inspectPreviewImage(file)).toBeNull();
    }
  });
  it('uses EXIF-oriented JPEG dimensions and rejects malformed/truncated data', async () => {
    expect(await inspectPreviewImage(jpeg(8, undefined, undefined, 6))).toEqual({ width: 2160, height: 3840, format: 'jpeg' });
    expect(await inspectPreviewImage(png(0, 2160))).toBeNull();
    expect(await inspectPreviewImage(png(3840, 2160).slice(0, 30))).toBeNull();
  });
});

describe('worker preview ownership', () => {
  it('does not decode/re-encode ordinary 1280px images or unknown formats', async () => {
    const decode = vi.fn(); vi.stubGlobal('createImageBitmap', decode);
    expect(await createDisplayImagePreview(png(1280, 720), 1024)).toBeNull();
    expect(await createDisplayImagePreview(png(3840, 2160, 16), 1024)).toBeNull();
    expect(decode).not.toHaveBeenCalled();
  });
  it.each([false, true])('releases bitmap and canvas on encode failure=%s', async fails => {
    const close = vi.fn(), draw = vi.fn(), output = blob(['preview']);
    const decode = vi.fn().mockResolvedValue({ close, width: 1024, height: 576 }); vi.stubGlobal('createImageBitmap', decode);
    const canvases: Array<{ width: number; height: number }> = [];
    vi.stubGlobal('OffscreenCanvas', class {
      constructor(public width: number, public height: number) { canvases.push(this); }
      getContext() { return { drawImage: draw }; }
      async convertToBlob() { if (fails) throw new Error('encode failed'); return output; }
    });
    const operation = createDisplayImagePreview(png(3840, 2160), 1024);
    if (fails) await expect(operation).rejects.toThrow('encode failed');
    else expect(await operation).toEqual({ blob: output, width: 1024, height: 576 });
    expect(decode.mock.calls[0][1]).toMatchObject({ resizeWidth: 1024, resizeHeight: 576, imageOrientation: 'from-image' });
    expect(close).toHaveBeenCalledOnce();
    expect(canvases[0]).toMatchObject({ width: 0, height: 0 });
  });
  it.each([[16384, 9216, 4096, 2304], [16384, 16384, 4096, 4096], [8192, 32768, 2048, 8192]])('keeps a bounded preview of a %i × %i source instead of falling back to the original', async (sourceWidth, sourceHeight, outputWidth, outputHeight) => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async (_blob: Blob, options: ImageBitmapOptions) => ({ close, width: options.resizeWidth, height: options.resizeHeight })));
    vi.stubGlobal('OffscreenCanvas', class {
      constructor(public width: number, public height: number) {}
      getContext() { return { drawImage: vi.fn() }; }
      async convertToBlob() { return blob(['preview']); }
    });
    expect(await createDisplayImagePreview(png(sourceWidth, sourceHeight), 4096)).toMatchObject({ width: outputWidth, height: outputHeight });
    expect(outputWidth * outputHeight * 4).toBeLessThanOrEqual(64 * 1024 * 1024);
    expect(close).toHaveBeenCalledOnce();
  });
});

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  finish(width = 1024, height = 576, bytes = 10) {
    const id = this.postMessage.mock.calls.at(-1)![0].id;
    this.onmessage?.({ data: { id, result: { blob: blob([new Uint8Array(bytes)]), width, height } } } as MessageEvent);
  }
}

describe('preview leases and budgets', () => {
  const workers: FakeWorker[] = [];
  let cache: ImageDisplayPreviewCache;
  beforeEach(() => {
    vi.useFakeTimers(); workers.length = 0;
    let url = 0;
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => `blob:preview-${++url}`), revokeObjectURL: vi.fn() });
    cache = new ImageDisplayPreviewCache(() => { const worker = new FakeWorker(); workers.push(worker); return worker as unknown as Worker; });
  });
  afterEach(() => { cache.dispose(); vi.useRealTimers(); });
  it('shares one decode, revokes only the last lease, and reuses compressed cache with a fresh URL', async () => {
    const first = cache.acquire('https://a/4k.png', 1024), second = cache.acquire('https://a/4k.png', 1024);
    expect(workers[0].postMessage).toHaveBeenCalledOnce(); workers[0].finish();
    expect(await first.result).toBe(await second.result);
    first.release(); expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    second.release(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
    const again = cache.acquire('https://a/4k.png', 1024);
    expect(await again.result).toBe('blob:preview-2');
    expect(workers[0].postMessage).toHaveBeenCalledOnce(); again.release();
  });
  it('runs one decoder and cancels queued/in-flight work when its last view leaves', async () => {
    const first = cache.acquire('https://a/first.png', 1024), queued = cache.acquire('https://a/queued.png', 1024);
    expect(workers[0].postMessage).toHaveBeenCalledOnce(); queued.release(); first.release();
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(await first.result).toBe('https://a/first.png'); expect(await queued.result).toBe('https://a/queued.png');
    const next = cache.acquire('https://a/next.png', 1024); workers[0].finish();
    expect(URL.createObjectURL).not.toHaveBeenCalled(); workers[1].finish();
    expect(await next.result).toBe('blob:preview-1'); next.release();
  });
  it('keeps live 4096px previews beyond the soft budget instead of loading larger originals, then releases them', async () => {
    const leases = [0, 1, 2].map(index => cache.acquire(`https://a/${index}.png`, 4096));
    workers[0].finish(4096, 4096); workers[0].finish(4096, 4096); workers[0].finish(4096, 4096);
    expect(await leases[0].result).toMatch(/^blob:/); expect(await leases[1].result).toMatch(/^blob:/);
    expect(await leases[2].result).toMatch(/^blob:/);
    leases.forEach(lease => lease.release()); vi.advanceTimersByTime(1000);
    expect(workers[0].terminate).toHaveBeenCalledOnce(); vi.advanceTimersByTime(30_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
    const next = cache.acquire('https://a/0.png', 4096);
    expect(workers).toHaveLength(2); next.release();
  });
  it('bounds idle compressed bytes and does not retain inline source documents', async () => {
    for (let index = 0; index < 3; index++) {
      const lease = cache.acquire(`https://a/${index}.png`, 1024); workers[0].finish(1024, 576, 4 * 1024 * 1024); await lease.result; lease.release(); vi.advanceTimersByTime(1);
    }
    const oldest = cache.acquire('https://a/0.png', 1024);
    expect(workers[0].postMessage).toHaveBeenCalledTimes(4); oldest.release();
    const inline = cache.acquire('data:image/png;base64,abc', 1024); workers.at(-1)!.finish(); await inline.result; inline.release();
    const again = cache.acquire('data:image/png;base64,abc', 1024);
    expect(workers.at(-1)!.postMessage).toHaveBeenCalledTimes(2); again.release();
  });
  it('falls back on unavailable worker and on timeout without hanging pending views', async () => {
    const unavailable = new ImageDisplayPreviewCache(() => { throw new Error('no worker'); });
    const fallback = unavailable.acquire('https://a/4k.png', 1024);
    expect(await fallback.result).toBe('https://a/4k.png'); fallback.release(); unavailable.dispose();
    const slow = cache.acquire('https://a/slow.png', 1024); vi.advanceTimersByTime(15_000);
    expect(await slow.result).toBe('https://a/slow.png'); expect(workers[0].terminate).toHaveBeenCalledOnce(); slow.release();
  });
});

it('selects a DPR-aware width without forcing wide displays into a blurry 2048px cap', () => {
  expect(imagePreviewWidth(500, 2)).toBe(1024); expect(imagePreviewWidth(1000, 2)).toBe(2048); expect(imagePreviewWidth(1800, 2)).toBe(3840);
  expect(canRequestImagePreview('https://a/image.gif')).toBe(false); expect(canRequestImagePreview('https://asset.localhost/C%3A/a.png?v=2')).toBe(true);
});
