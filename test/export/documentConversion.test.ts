import { afterEach, expect, it, vi } from 'vitest';
import { convertFileSrc } from '@tauri-apps/api/core';
import { prepareDocument } from '../../src/features/export/documentConversion';

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: vi.fn((path: string) => `host-specific:${path}`) }));

class ConversionWorker {
  static current: ConversionWorker;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { ConversionWorker.current = this; }
  emit(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.mocked(convertFileSrc).mockClear(); });

it('maps only asset paths on the host and returns the worker HTML without parsing it', async () => {
  vi.stubGlobal('Worker', ConversionWorker);
  const createElement = vi.spyOn(document, 'createElement');
  const result = prepareDocument('source', 'title', 'C:/docs');
  const worker = ConversionWorker.current;
  worker.emit({ type: 'assets', paths: ['C:/docs/a.png', 'C:/docs/b.png'] });
  expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'asset-urls', urls: ['host-specific:C:/docs/a.png', 'host-specific:C:/docs/b.png'] });
  expect(worker.terminate).not.toHaveBeenCalled();
  const html = '<article><p>noteboard-export-asset:0</p></article>';
  worker.emit({ type: 'result', result: { html, markdown: 'source', items: [] } });
  expect(await result).toEqual({ html, markdown: 'source', items: [], title: 'title', baseDirectory: 'C:/docs' });
  expect(createElement).not.toHaveBeenCalled();
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});

it('abort during the asset handshake terminates once and rejects late completion', async () => {
  vi.stubGlobal('Worker', ConversionWorker);
  const controller = new AbortController();
  const result = prepareDocument('source', 'title', '', controller.signal);
  const worker = ConversionWorker.current, lateMessage = worker.onmessage!;
  worker.emit({ type: 'assets', paths: ['C:/a.png'] });
  controller.abort();
  lateMessage({ data: { type: 'result', result: { html: 'late', markdown: 'source', items: [] } } } as MessageEvent);
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect(worker.onmessage).toBeNull();
});

it('host URL mapping failure rejects and releases the worker', async () => {
  vi.stubGlobal('Worker', ConversionWorker);
  vi.mocked(convertFileSrc).mockImplementationOnce(() => { throw new Error('mapping failed'); });
  const result = prepareDocument('source', 'title', '');
  const worker = ConversionWorker.current;
  worker.emit({ type: 'assets', paths: ['C:/a.png'] });
  await expect(result).rejects.toThrow('mapping failed');
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});
