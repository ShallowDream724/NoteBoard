import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DrawioEditor } from '@/features/drawio/DrawioEditor';
import { getEditorCapabilities, resetEditorRegistryForTest } from '@/core/editor/editorRegistry';
import { useDocumentStore } from '@/stores/documentStore';
import { useWindowStore } from '@/stores/windowStore';
import { saveDocument } from '@/features/editor-code/orchestration/saveDocument';
import { showToast } from '@/stores/toastStore';
import { exportBlobWithDialog, buildExportFileName } from '@/features/export/chartExport';

vi.mock('@/components/Tooltip', () => ({ Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/features/export/chartExport', () => ({ exportBlobWithDialog: vi.fn(), buildExportFileName: vi.fn() }));
vi.mock('@/features/editor-code/orchestration/saveDocument', () => ({ saveDocument: vi.fn() }));
vi.mock('@/stores/toastStore', () => ({ showToast: vi.fn() }));

const ORIGIN = 'https://embed.diagrams.net', KEY = 'C:/test/local.drawio';
let host: HTMLDivElement, root: Root;
function seed(key = KEY, content = '<mxfile>local</mxfile>') {
  useDocumentStore.getState().upsertFromPayload({ key, displayName: 'local.drawio', dirPath: 'C:/test', kind: 'drawio', language: 'xml', content, encoding: 'utf8', eol: 'lf', size: content.length, mtime: 0, readonly: false });
}
function send(frame: HTMLIFrameElement, data: unknown, origin = ORIGIN, source = frame.contentWindow) {
  window.dispatchEvent(new MessageEvent('message', { origin, source, data: JSON.stringify(data) }));
}
async function enable() { await act(async () => host.querySelector<HTMLButtonElement>('.nb-btn-primary')!.click()); return host.querySelector('iframe')!; }
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); vi.useFakeTimers(); resetEditorRegistryForTest();
  useDocumentStore.setState({ documents: new Map() }); useWindowStore.setState({ tabs: [], activeKey: null, transferringKeys: [] });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  vi.mocked(buildExportFileName).mockReturnValue('local');
  vi.mocked(exportBlobWithDialog).mockResolvedValue(true);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('keeps local content and flush available without loading a remote frame or starting a timeout', async () => {
  seed(KEY, '');
  const listen = vi.spyOn(window, 'addEventListener');
  await act(async () => root.render(<DrawioEditor docKey={KEY} />));
  expect(host.querySelector('iframe')).toBeNull();
  expect(listen.mock.calls.some(call => call[0] === 'message')).toBe(false);
  expect((await getEditorCapabilities(KEY)!.flush('save'))?.content).toBe('');
  expect(getEditorCapabilities(KEY)!.canSuspend()).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(16000));
  expect(host.textContent).toContain('启用在线编辑');
  expect(host.textContent).not.toContain('检查网络');
  expect(useDocumentStore.getState().getDocument(KEY)?.content).toBe('');
});

it('accepts only the enabled frame at its exact origin and targets every outgoing message there', async () => {
  seed(); await act(async () => root.render(<DrawioEditor docKey={KEY} />));
  const frame = await enable(), post = vi.spyOn(frame.contentWindow!, 'postMessage');
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
  expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
  await act(async () => { send(frame, { event: 'init' }, 'https://example.com'); send(frame, { event: 'init' }, ORIGIN, window); });
  expect(post).not.toHaveBeenCalled();
  await act(async () => { send(frame, { event: 'configure' }); send(frame, { event: 'init' }); });
  expect(JSON.parse(String(post.mock.calls.at(-1)![0]))).toMatchObject({ action: 'load', xml: '<mxfile>local</mxfile>' });
  for (const call of post.mock.calls) expect(call[1]).toBe(ORIGIN);
  await act(async () => { send(frame, { event: 'autosave', xml: '<mxfile>spoof</mxfile>' }, 'null'); send(frame, { event: 'autosave', xml: { bad: true } }); });
  expect(useDocumentStore.getState().getDocument(KEY)?.content).toBe('<mxfile>local</mxfile>');
  await act(async () => send(frame, { event: 'autosave', xml: '<mxfile>local</mxfile>' }));
  expect(useDocumentStore.getState().getDocument(KEY)?.isDirty).toBe(false);
  await act(async () => send(frame, { event: 'autosave', xml: '<mxfile>edited</mxfile>' }));
  expect(useDocumentStore.getState().getDocument(KEY)?.isDirty).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(16000));
  expect(host.textContent).not.toContain('检查网络');
});

it('resets consent and aborts pending captures on a document change, ignoring the old frame', async () => {
  seed(); seed('C:/test/next.drawio', '<mxfile>next</mxfile>');
  await act(async () => root.render(<DrawioEditor docKey={KEY} />));
  const frame = await enable(); await act(async () => send(frame, { event: 'init' }));
  const capture = getEditorCapabilities(KEY)!.flush('evict');
  await act(async () => root.render(<DrawioEditor docKey="C:/test/next.drawio" />));
  expect(await capture).toBeNull(); expect(host.querySelector('iframe')).toBeNull();
  await act(async () => send(frame, { event: 'autosave', xml: '<mxfile>stale</mxfile>' }));
  expect(useDocumentStore.getState().getDocument(KEY)?.content).toBe('<mxfile>local</mxfile>');
  expect((await getEditorCapabilities('C:/test/next.drawio')!.flush('save'))?.content).toBe('<mxfile>next</mxfile>');
});

it('reconnects with a new frame and aborts pending captures from the previous frame', async () => {
  seed(); await act(async () => root.render(<DrawioEditor docKey={KEY} />));
  const frame = await enable(); await act(async () => send(frame, { event: 'init' }));
  const capture = getEditorCapabilities(KEY)!.flush('evict');
  await act(async () => frame.dispatchEvent(new Event('error', { bubbles: true })));
  expect(host.querySelector<HTMLButtonElement>('button[aria-label="导出为 SVG 矢量图"]')!.disabled).toBe(true);
  const reconnect = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('重新连接'))!;
  await act(async () => reconnect.click());
  expect(await capture).toBeNull();
  const next = host.querySelector('iframe')!; expect(next).not.toBe(frame);
  await act(async () => send(frame, { event: 'autosave', xml: '<mxfile>stale</mxfile>' }));
  expect(useDocumentStore.getState().getDocument(KEY)?.content).toBe('<mxfile>local</mxfile>');
  await act(async () => send(next, { event: 'init' }));
  expect(host.querySelector<HTMLButtonElement>('button[aria-label="导出为 SVG 矢量图"]')!.disabled).toBe(false);
});

it('announces save success only after a successful result and suppresses late messages after a switch', async () => {
  seed(); await act(async () => root.render(<DrawioEditor docKey={KEY} />));
  const frame = await enable(); await act(async () => send(frame, { event: 'init' }));
  vi.mocked(saveDocument).mockResolvedValueOnce(false);
  await act(async () => send(frame, { event: 'save', xml: '<mxfile>new</mxfile>' }));
  expect(showToast).not.toHaveBeenCalled();
  vi.mocked(saveDocument).mockResolvedValueOnce(true);
  await act(async () => send(frame, { event: 'save', xml: '<mxfile>new</mxfile>' }));
  expect(showToast).toHaveBeenCalledWith('Draw.io 图表已保存');
  vi.mocked(showToast).mockClear();
  let finish!: (saved: boolean) => void;
  vi.mocked(saveDocument).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => send(frame, { event: 'save', xml: '<mxfile>new</mxfile>' }));
  seed('C:/test/next.drawio');
  await act(async () => root.render(<DrawioEditor docKey="C:/test/next.drawio" />));
  await act(async () => { finish(true); await Promise.resolve(); });
  expect(showToast).not.toHaveBeenCalled();
});

it('opens an image export dialog only for the matching requested format and request ID', async () => {
  seed(); await act(async () => root.render(<DrawioEditor docKey={KEY} />));
  const frame = await enable(), post = vi.spyOn(frame.contentWindow!, 'postMessage');
  await act(async () => send(frame, { event: 'init' }));
  await act(async () => send(frame, { event: 'export', format: 'svg', data: '<svg/>' }));
  expect(exportBlobWithDialog).not.toHaveBeenCalled();
  const button = host.querySelector<HTMLButtonElement>('button[aria-label="导出为 SVG 矢量图"]')!;
  await act(async () => button.click());
  const request = JSON.parse(String(post.mock.calls.at(-1)![0]));
  expect(request).toMatchObject({ action: 'export', format: 'svg', requestId: expect.any(String) });
  const count = post.mock.calls.length;
  await act(async () => button.click()); expect(post.mock.calls.length).toBe(count);
  await act(async () => {
    send(frame, { event: 'export', format: 'png', data: '<svg/>', message: request });
    send(frame, { event: 'export', format: 'svg', data: '<svg/>', message: { ...request, requestId: 'stale' } });
  });
  expect(exportBlobWithDialog).not.toHaveBeenCalled();
  await act(async () => send(frame, { event: 'export', format: 'svg', data: '<svg/>', message: request }));
  expect(exportBlobWithDialog).toHaveBeenCalledOnce();
  expect(exportBlobWithDialog).toHaveBeenCalledWith(expect.any(Blob), 'local.svg', expect.any(Array));
  await act(async () => send(frame, { event: 'export', format: 'svg', data: '<svg/>', message: request }));
  expect(exportBlobWithDialog).toHaveBeenCalledOnce();
  await act(async () => button.click());
  const expired = JSON.parse(String(post.mock.calls.at(-1)![0]));
  await act(async () => vi.advanceTimersByTimeAsync(30001));
  await act(async () => send(frame, { event: 'export', format: 'svg', data: '<svg/>', message: expired }));
  expect(exportBlobWithDialog).toHaveBeenCalledOnce();
});
