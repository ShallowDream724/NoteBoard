// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageViewer } from '../../src/features/image-viewer/ImageViewer';
import { showToast } from '../../src/stores/toastStore';
import { copyPngImage } from '../../src/core/ipc/commands';
import { readFile } from '@tauri-apps/plugin-fs';

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => path }));
vi.mock('../../src/core/ipc/commands', () => ({ copyPngImage: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: vi.fn() }));
vi.mock('../../src/features/session/editorSuspension', () => ({ takeViewState: () => null }));
vi.mock('../../src/core/editor/editorRegistry', () => ({ registerEditorCapabilities: () => () => {} }));
vi.mock('../../src/stores/toastStore', () => ({ showToast: vi.fn() }));
vi.mock('../../src/components/Tooltip', () => ({ Tooltip: ({ children }: { children: ReactNode }) => children }));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(res => { resolve = res; });
  return { promise, resolve };
}

class DecodedImage {
  naturalWidth = 8192;
  naturalHeight = 4096;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private value = '';
  get src() { return this.value; }
  set src(value: string) { this.value = value; if (value) queueMicrotask(() => this.onload?.()); }
}

describe('image clipboard resource lifetime', () => {
  let host: HTMLDivElement;
  let root: Root;
  let button: HTMLButtonElement;
  let canvases: HTMLCanvasElement[];
  let encoders: BlobCallback[];
  const drawImage = vi.fn();
  const write = vi.fn<Clipboard['write']>();
  const writeText = vi.fn<Clipboard['writeText']>();
  const revokeObjectURL = vi.fn();

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { clipboard: { write, writeText } }));
    vi.stubGlobal('ClipboardItem', class { constructor(public items: Record<string, Blob>) {} });
    vi.stubGlobal('Image', DecodedImage);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['source']) }));
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL: vi.fn(() => 'blob:source'), revokeObjectURL }));
    write.mockResolvedValue(undefined);
    vi.mocked(copyPngImage).mockResolvedValue(undefined);
    vi.mocked(readFile).mockResolvedValue(new Uint8Array([1, 2, 3]));
    canvases = [];
    encoders = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      canvases.push(this);
      return { drawImage } as unknown as CanvasRenderingContext2D;
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => { encoders.push(callback); });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<ImageViewer docKey="image" filePath="/image.png" />));
    const img = host.querySelector('img')!;
    Object.defineProperties(img, { naturalWidth: { value: 8192 }, naturalHeight: { value: 4096 } });
    await act(async () => img.dispatchEvent(new Event('load')));
    button = host.querySelector('[aria-label="复制图片"]')!;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('decodes same-origin bytes, coalesces clicks, and releases pixels before clipboard writing completes', async () => {
    const clipboard = deferred();
    write.mockReturnValue(clipboard.promise);
    await act(async () => { button.click(); button.click(); });
    expect(canvases).toHaveLength(1);
    expect([canvases[0].width, canvases[0].height]).toEqual([8192, 4096]);
    const decoded = drawImage.mock.calls[0][0] as DecodedImage;
    expect(decoded).toBeInstanceOf(DecodedImage);
    const blob = new Blob(['png'], { type: 'image/png' });
    await act(async () => encoders[0](blob));
    expect([canvases[0].width, canvases[0].height]).toEqual([0, 0]);
    expect(decoded.src).toBe('');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:source');
    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0][0][0]).toMatchObject({ items: { 'image/png': blob } });
    expect(showToast).not.toHaveBeenCalled();
    await act(async () => button.click());
    expect(canvases).toHaveLength(1);
    await act(async () => clipboard.resolve());
    expect(showToast).toHaveBeenCalledWith('图片已复制到剪贴板', 'success');
  });

  it('uses the native image writer when browser image writing fails', async () => {
    write.mockRejectedValue(new Error('image denied'));
    await act(async () => button.click());
    const png = new Blob(['png'], { type: 'image/png' });
    await act(async () => encoders[0](png));
    expect(copyPngImage).toHaveBeenCalledOnce();
    expect(Array.from(vi.mocked(copyPngImage).mock.calls[0][0])).toEqual(Array.from(new Uint8Array(await png.arrayBuffer())));
    expect(writeText).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledExactlyOnceWith('图片已复制到剪贴板', 'success');
  });

  it('reads local bytes if asset fetch fails before rasterizing', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('asset CORS'));
    await act(async () => button.click());
    expect(readFile).toHaveBeenCalledWith('/image.png');
    expect((vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob).type).toBe('image/png');
    await act(async () => encoders[0](new Blob(['png'], { type: 'image/png' })));
    expect(write).toHaveBeenCalledOnce();
  });

  it('does not replace an unreadable image with its path', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('asset CORS'));
    vi.mocked(readFile).mockRejectedValueOnce(new Error('read denied'));
    await act(async () => button.click());
    expect(write).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledExactlyOnceWith('复制图片失败', 'error');
  });

  it.each(['null blob', 'encoding exception', 'drawing exception'])(
    'reports %s without substituting a path and releases canvas resources', async failure => {
      if (failure === 'encoding exception') vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(() => { throw new Error('encode'); });
      if (failure === 'drawing exception') drawImage.mockImplementationOnce(() => { throw new Error('draw'); });
      await act(async () => button.click());
      if (failure === 'null blob') await act(async () => encoders[0](null));
      expect([canvases[0].width, canvases[0].height]).toEqual([0, 0]);
      expect(writeText).not.toHaveBeenCalled();
      expect(copyPngImage).not.toHaveBeenCalled();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:source');
      expect(showToast).toHaveBeenCalledExactlyOnceWith('复制图片失败', 'error');
    },
  );

  it('reports failure if both image writers fail, then permits retry', async () => {
    write.mockRejectedValue(new Error('image denied'));
    vi.mocked(copyPngImage).mockRejectedValue(new Error('native denied'));
    await act(async () => button.click());
    await act(async () => encoders[0](new Blob(['png'], { type: 'image/png' })));
    expect(writeText).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledExactlyOnceWith('复制图片失败', 'error');
    await act(async () => button.click());
    expect(canvases).toHaveLength(2);
    await act(async () => encoders[1](null));
  });
});
