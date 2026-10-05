// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ImageViewer } from '../../src/features/image-viewer/ImageViewer';
import { SvgSourceViewer, SVG_SOURCE_MAX_READ_BYTES, type SvgSourceViewerHandle } from '../../src/features/image-viewer/SvgSourceViewer';
import type { DocumentPayload } from '../../src/core/ipc/types';
import { getEditorCapabilities, resetEditorRegistryForTest } from '../../src/core/editor/editorRegistry';

const mocks = vi.hoisted(() => ({
  read: vi.fn(), open: vi.fn(), grammar: vi.fn(), clipboard: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => path }));
vi.mock('../../src/core/ipc/commands', () => ({ readDocument: mocks.read, openWithDefaultApp: mocks.open }));
vi.mock('../../src/features/editor-code/languages', () => ({ loadLanguageExtension: mocks.grammar }));
vi.mock('../../src/features/session/editorSuspension', () => ({ takeViewState: () => null }));
vi.mock('../../src/stores/toastStore', () => ({ showToast: vi.fn() }));
vi.mock('../../src/components/Tooltip', () => ({ Tooltip: ({ children }: { children: ReactNode }) => children }));

const source = '<svg xmlns="http://www.w3.org/2000/svg">\n<script>window.executed = true</script>\n<text>原文</text>\n</svg>';
function payload(content: string | null = source): DocumentPayload {
  return { key: '/diagram.svg', displayName: 'diagram.svg', dirPath: '/', kind: 'image', language: 'xml',
    content, encoding: 'utf8', eol: 'lf', size: 120, mtime: 1, readonly: true };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}

let host: HTMLDivElement;
let root: Root;
let unmounted: boolean;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: mocks.clipboard } });
  mocks.read.mockResolvedValue(payload());
  mocks.open.mockResolvedValue(undefined);
  mocks.grammar.mockResolvedValue([]);
  mocks.clipboard.mockResolvedValue(undefined);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  unmounted = false;
});
afterEach(async () => {
  if (!unmounted) await act(async () => root.unmount());
  host.remove();
  resetEditorRegistryForTest();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function waitForEditor(): Promise<EditorView> {
  await act(async () => {
    await vi.waitFor(() => expect(host.querySelector('.cm-editor')).not.toBeNull());
  });
  return EditorView.findFromDOM(host.querySelector('.cm-editor')!)!;
}
async function click(label: string) {
  await act(async () => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());
}

it('offers source only for SVG and does not read ordinary image content', async () => {
  await act(async () => root.render(<ImageViewer docKey="image" filePath="/photo.png" />));
  expect(host.querySelector('[aria-label="查看 SVG 源码"]')).toBeNull();
  expect(mocks.read).not.toHaveBeenCalled();
  await act(async () => root.render(<ImageViewer docKey="image" filePath="/diagram.SVG" />));
  expect(host.querySelector('[aria-label="查看 SVG 源码"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="编辑图片"]')).not.toBeNull();
  expect(mocks.read).not.toHaveBeenCalled();
});

it('switches to readonly source without recreating the image or losing its transform', async () => {
  await act(async () => root.render(<ImageViewer docKey="image" filePath="/diagram.svg" />));
  const image = host.querySelector('img')!;
  for (const label of ['放大', '顺时针旋转 90°', '水平翻转']) await click(label);
  const transform = image.style.transform;
  await click('查看 SVG 源码');
  const view = await waitForEditor();
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith('/diagram.svg', 2 * 1024 * 1024);
  expect(view.state.readOnly).toBe(true);
  expect(view.state.facet(EditorView.editable)).toBe(false);
  expect(host.querySelector('.cm-content')?.getAttribute('aria-readonly')).toBe('true');
  expect(host.querySelector('img')).toBe(image);
  expect(getEditorCapabilities('image')?.captureViewState?.()).toMatchObject({ kind: 'image', scale: 1.25, rotation: 90, flipH: true });
  expect(await getEditorCapabilities('image')?.flush('save')).toMatchObject({ content: null, readonly: true });
  const destroy = vi.spyOn(view, 'destroy');
  await click('查看图片');
  expect(destroy).toHaveBeenCalledOnce();
  expect(host.querySelector('.cm-editor')).toBeNull();
  expect(host.querySelector('img')).toBe(image);
  expect(image.style.transform).toBe(transform);
  expect(host.querySelector('[aria-label="编辑图片"]')).not.toBeNull();
  await click('查看 SVG 源码');
  await waitForEditor();
  expect(mocks.read).toHaveBeenCalledTimes(2);
});

it('keeps XML as text, blocks document changes, and supports selection, copy, wrapping, and find', async () => {
  const viewerRef: { current: SvgSourceViewerHandle | null } = { current: null };
  await act(async () => root.render(<SvgSourceViewer filePath="/diagram.svg" viewerRef={viewerRef} />));
  const view = await waitForEditor();
  expect(view.state.doc.toString()).toBe(source);
  expect(mocks.grammar).toHaveBeenCalledWith('xml');
  expect(host.querySelector('.cm-content svg, .cm-content script')).toBeNull();
  expect(host.querySelector('.cm-lineNumbers')).not.toBeNull();
  await act(async () => view.dispatch({ changes: { from: 0, insert: 'edited' } }));
  expect(view.state.doc.toString()).toBe(source);
  await act(async () => view.dispatch({ selection: { anchor: 1, head: 4 } }));
  expect(viewerRef.current?.getSelectedText()).toBe('svg');
  await click('复制源码');
  expect(mocks.clipboard).toHaveBeenCalledWith('svg');
  await act(async () => view.dispatch({ selection: { anchor: 0 } }));
  await click('复制源码');
  expect(mocks.clipboard).toHaveBeenLastCalledWith(source);
  expect(view.contentDOM.classList.contains('cm-lineWrapping')).toBe(true);
  await click('自动换行');
  expect(view.contentDOM.classList.contains('cm-lineWrapping')).toBe(false);
  await click('查找源码');
  expect(host.querySelector('input[aria-label="查找"]')).not.toBeNull();
  expect(host.querySelector('input[name="replace"]')).toBeNull();
  await act(async () => root.unmount());
  unmounted = true;
  expect(viewerRef.current).toBeNull();
});

it('ignores a late bounded IPC response after unmount', async () => {
  const read = deferred<DocumentPayload>();
  mocks.read.mockReturnValue(read.promise);
  await act(async () => root.render(<SvgSourceViewer filePath="/diagram.svg" />));
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith('/diagram.svg', SVG_SOURCE_MAX_READ_BYTES);
  await act(async () => root.unmount());
  unmounted = true;
  await act(async () => read.resolve(payload()));
  expect(host.querySelector('.cm-editor')).toBeNull();
  expect(mocks.grammar).not.toHaveBeenCalled();
});

it('destroys the mounted editor and ignores a late XML grammar result', async () => {
  const grammar = deferred<never[]>();
  mocks.grammar.mockReturnValue(grammar.promise);
  await act(async () => root.render(<SvgSourceViewer filePath="/diagram.svg" />));
  const view = await waitForEditor();
  const dispatch = vi.spyOn(view, 'dispatch');
  const destroy = vi.spyOn(view, 'destroy');
  await act(async () => root.unmount());
  unmounted = true;
  await act(async () => grammar.resolve([]));
  expect(destroy).toHaveBeenCalledOnce();
  expect(dispatch).not.toHaveBeenCalled();
});

it.each([
  ['oversized', '文件大小已超过读取限制: 2097153 字节', 'SVG 文件超过 2 MiB'],
  ['unreadable', 'permission denied', '无法读取 SVG 源码'],
])('explains %s source and offers the default application', async (_reason, failure, message) => {
  mocks.read.mockRejectedValue(failure);
  await act(async () => root.render(<SvgSourceViewer filePath="/diagram.svg" />));
  expect(host.textContent).toContain(message);
  expect(host.querySelector('.cm-editor')).toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('.svg-source-message button')!.click());
  expect(mocks.open).toHaveBeenCalledWith('/diagram.svg');
});

it('does not turn a null source payload into editable or misleading content', async () => {
  mocks.read.mockResolvedValue(payload(null));
  await act(async () => root.render(<SvgSourceViewer filePath="/diagram.svg" />));
  expect(host.textContent).toContain('无法读取 SVG 源码');
  expect(host.querySelector('.cm-editor')).toBeNull();
});
