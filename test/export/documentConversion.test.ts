import { afterEach, expect, it, vi } from 'vitest';
import { convertFileSrc } from '@tauri-apps/api/core';
import { readFile } from '@tauri-apps/plugin-fs';
import { prepareDocument, prepareHtmlExport } from '../../src/features/export/documentConversion';
import { renderExportDiagrams } from '../../src/features/export/renderDiagrams';

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: vi.fn((path: string) => `host-specific:${path}`) }));
vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: vi.fn() }));
vi.mock('../../src/features/export/renderDiagrams', () => ({ renderExportDiagrams: vi.fn() }));

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

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.mocked(convertFileSrc).mockReset().mockImplementation(path => `host-specific:${path}`); vi.mocked(readFile).mockReset(); });

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

it('embeds local image originals for HTML even when desktop URLs are unavailable', async () => {
  vi.stubGlobal('Worker', ConversionWorker);
  vi.mocked(convertFileSrc).mockImplementationOnce(() => { throw new Error('desktop URLs unavailable'); });
  vi.mocked(readFile).mockResolvedValue(new Uint8Array([1, 2, 3]));
  const result = prepareHtmlExport('source', 'title', 'C:/docs');
  const worker = ConversionWorker.current;
  worker.emit({ type: 'assets', paths: ['C:/docs/a.png', 'C:/docs/a.png'] });
  await vi.waitFor(() => expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'asset-urls', urls: ['data:image/png;base64,AQID', 'data:image/png;base64,AQID'] }));
  expect(readFile).toHaveBeenCalledOnce();
  expect(convertFileSrc).not.toHaveBeenCalled();
  worker.emit({ type: 'result', result: '<html><img src="data:image/png;base64,AQID"></html>' });
  expect(await result).toContain('data:image/png;base64,AQID');
});

it('cancels HTML asset reads without posting a late result or reading the next image', async () => {
  vi.stubGlobal('Worker', ConversionWorker);
  let finish!: (bytes: Uint8Array) => void;
  vi.mocked(readFile).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const controller = new AbortController();
  const result = prepareHtmlExport('source', 'title', '', controller.signal);
  const worker = ConversionWorker.current;
  worker.emit({ type: 'assets', paths: ['C:/a.png', 'C:/b.png'] });
  await vi.waitFor(() => expect(readFile).toHaveBeenCalledOnce());
  controller.abort();
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  finish(new Uint8Array([1, 2, 3]));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(readFile).toHaveBeenCalledOnce();
  expect(worker.postMessage.mock.calls.some(call => call[0].type === 'asset-urls')).toBe(false);
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it('fails HTML export with a readable image path when the original cannot be read', async () => {
  vi.stubGlobal('Worker', ConversionWorker);
  vi.mocked(readFile).mockRejectedValue(new Error('file missing'));
  const result = prepareHtmlExport('source', 'title', '');
  const worker = ConversionWorker.current;
  worker.emit({ type: 'assets', paths: ['C:/中文 图片.png'] });
  await expect(result).rejects.toThrow('无法内嵌本地图片“C:/中文 图片.png”：file missing');
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it('renders a worker diagram batch in the browser and aborts unfinished rendering with the export', async () => {
  vi.stubGlobal('Worker', ConversionWorker);
  let complete!: (result: { html: string }[]) => void;
  vi.mocked(renderExportDiagrams).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const controller = new AbortController();
  const result = prepareDocument('source', 'title', '', controller.signal);
  const worker = ConversionWorker.current;
  worker.emit({ type: 'diagrams', requests: [{ kind: 'mermaid', code: 'graph LR\nA-->B' }] });
  await vi.waitFor(() => expect(renderExportDiagrams).toHaveBeenCalledOnce());
  const signal = vi.mocked(renderExportDiagrams).mock.calls[0][1]!;
  controller.abort();
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  expect(signal.aborted).toBe(true);
  complete([{ html: '<svg></svg>' }]); await Promise.resolve();
  expect(worker.postMessage.mock.calls.some(call => call[0].type === 'diagram-results')).toBe(false);
  expect(worker.terminate).toHaveBeenCalledOnce();
});
