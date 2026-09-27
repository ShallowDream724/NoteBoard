// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageViewer } from '../../src/features/image-viewer/ImageViewer';
import { showToast } from '../../src/stores/toastStore';

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => path }));
vi.mock('../../src/core/ipc/commands', () => ({}));
vi.mock('../../src/features/session/editorSuspension', () => ({ takeViewState: () => null }));
vi.mock('../../src/core/editor/editorRegistry', () => ({ registerEditorCapabilities: () => () => {} }));
vi.mock('../../src/stores/toastStore', () => ({ showToast: vi.fn() }));
vi.mock('../../src/components/Tooltip', () => ({ Tooltip: ({ children }: { children: ReactNode }) => children }));

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
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

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { clipboard: { write, writeText } }));
    vi.stubGlobal('ClipboardItem', class { constructor(public items: Record<string, Blob>) {} });
    write.mockResolvedValue(undefined);
    writeText.mockResolvedValue(undefined);
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

  it('keeps full resolution, coalesces clicks, and releases pixels before clipboard writing completes', async () => {
    const clipboard = deferred();
    write.mockReturnValue(clipboard.promise);
    await act(async () => { button.click(); button.click(); });
    expect(canvases).toHaveLength(1);
    expect([canvases[0].width, canvases[0].height]).toEqual([8192, 4096]);
    expect(drawImage).toHaveBeenCalledWith(host.querySelector('img'), 0, 0);
    const blob = new Blob(['png'], { type: 'image/png' });
    await act(async () => encoders[0](blob));
    expect([canvases[0].width, canvases[0].height]).toEqual([0, 0]);
    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0][0][0]).toMatchObject({ items: { 'image/png': blob } });
    expect(showToast).not.toHaveBeenCalled();
    await act(async () => button.click());
    expect(canvases).toHaveLength(1);
    await act(async () => clipboard.resolve());
    expect(showToast).toHaveBeenCalledWith('图片已复制到剪贴板', 'success');
    await act(async () => button.click());
    expect(canvases).toHaveLength(2);
    await act(async () => encoders[1](blob));
  });

  it.each(['null blob', 'encoding exception', 'drawing exception'])(
    'releases the canvas on %s and waits for path fallback before reporting success', async failure => {
      const fallback = deferred();
      writeText.mockReturnValue(fallback.promise);
      if (failure === 'encoding exception') vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(() => { throw new Error('encode'); });
      if (failure === 'drawing exception') drawImage.mockImplementationOnce(() => { throw new Error('draw'); });
      await act(async () => button.click());
      if (failure === 'null blob') await act(async () => encoders[0](null));
      expect([canvases[0].width, canvases[0].height]).toEqual([0, 0]);
      expect(write).not.toHaveBeenCalled();
      expect(writeText).toHaveBeenCalledWith('/image.png');
      expect(showToast).not.toHaveBeenCalled();
      await act(async () => button.click());
      expect(canvases).toHaveLength(1);
      await act(async () => fallback.resolve());
      expect(showToast).toHaveBeenCalledWith('已复制图片文件完整路径', 'info');
    },
  );

  it('reports failure when both clipboard formats fail, then permits retry', async () => {
    write.mockRejectedValue(new Error('image denied'));
    writeText.mockRejectedValue(new Error('text denied'));
    await act(async () => button.click());
    await act(async () => encoders[0](new Blob(['png'], { type: 'image/png' })));
    expect([canvases[0].width, canvases[0].height]).toEqual([0, 0]);
    expect(showToast).toHaveBeenCalledExactlyOnceWith('复制图片失败', 'error');
    await act(async () => button.click());
    expect(canvases).toHaveLength(2);
    await act(async () => encoders[1](null));
  });
});
