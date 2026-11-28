// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CodeEditor } from '../../src/features/editor-code/CodeEditor';
import { standaloneHtml } from '../../src/features/export/standaloneHtml';
import { useDocumentStore } from '../../src/stores/documentStore';
import { useWindowStore } from '../../src/stores/windowStore';
import { HtmlViewToggle } from '../../src/features/toolbar/HtmlViewToggle';
import { TooltipProvider } from '../../src/components/Tooltip';
import { undoDocumentHistory } from '../../src/features/history/documentHistory';
import * as commands from '../../src/core/ipc/commands';
import * as events from '../../src/core/ipc/events';
import { initShortcuts } from '../../src/core/shortcuts';
import { setShortcutOverrides } from '../../src/core/shortcutBindings';

const path = 'C:\\notes\\page.html';
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  // jsdom supplies no text layout; real geometry is covered by browser QA.
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() });
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  useDocumentStore.setState({ documents: new Map() });
  useWindowStore.setState({ tabs: [], activeKey: null });
  useWindowStore.getState().openTab({ key: path, path, displayName: 'page.html', kind: 'code', language: 'html',
    isDirty: false, isPreview: false, viewMode: 'visual', externalStatus: null, isDetached: false });
  useDocumentStore.getState().upsertFromPayload({ key: path, displayName: 'page.html', dirPath: 'C:\\notes', kind: 'code', language: 'html', content: '<h1>原文</h1>', encoding: 'utf8', eol: 'lf', size: 12, mtime: 1, readonly: false });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setShortcutOverrides({});
});

it('switches the active HTML document with Ctrl+/ and restores editor focus', async () => {
  const dispose = initShortcuts();
  try {
    await act(async () => root.render(<CodeEditor docKey={path} />));
    await act(() => vi.dynamicImportSettled());
    const pressModeShortcut = (target: EventTarget, repeat = false) => act(async () => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: '/', code: 'Slash', ctrlKey: true, bubbles: true, cancelable: true, repeat }));
    });
    await pressModeShortcut(host);
    const content = host.querySelector('.cm-content')!;
    expect(document.activeElement).toBe(content);
    await pressModeShortcut(content, true);
    expect(useWindowStore.getState().getTab(path)?.viewMode).toBe('source');
    await pressModeShortcut(content);
    expect(host.querySelector('iframe')).not.toBeNull();
    expect(useDocumentStore.getState().getDocument(path)?.content).toBe('<h1>原文</h1>');
  } finally {
    dispose();
  }
});

it('uses the configured binding only when the active HTML preview frame has focus', async () => {
  vi.stubGlobal('isTauri', true);
  setShortcutOverrides({ 'markdown.mode': ['Ctrl+Shift+M'] });
  let receiveAccelerator: ((binding: string) => void) | undefined;
  vi.spyOn(events, 'onHtmlPreviewAccelerator').mockImplementation(async callback => {
    receiveAccelerator = callback;
    return () => { receiveAccelerator = undefined; };
  });
  await act(async () => root.render(<CodeEditor docKey={path} />));
  await act(() => vi.dynamicImportSettled());
  await act(async () => receiveAccelerator!('Ctrl+Shift+M'));
  expect(useWindowStore.getState().getTab(path)?.viewMode).toBe('visual');
  host.querySelector('iframe')!.focus();
  await act(async () => receiveAccelerator!('Ctrl+/'));
  expect(useWindowStore.getState().getTab(path)?.viewMode).toBe('visual');
  await act(async () => receiveAccelerator!('Ctrl+Shift+M'));
  expect(useWindowStore.getState().getTab(path)?.viewMode).toBe('source');
});

it('opens an isolated reading preview and refreshes it from unsaved source edits', async () => {
  await act(async () => root.render(<TooltipProvider><HtmlViewToggle docKey={path} /><CodeEditor docKey={path} /></TooltipProvider>));
  await act(() => vi.dynamicImportSettled());
  const frame = host.querySelector<HTMLIFrameElement>('iframe')!;
  expect(frame.getAttribute('sandbox')).toBe('');
  expect(frame.srcdoc).toContain('原文');
  expect(host.querySelector('.cm-editor')).toBeNull();
  expect(host.querySelector('.nb-html-preview-message')).toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="查看 HTML 源码"]')!.click());
  const view = EditorView.findFromDOM(host.querySelector('.cm-editor')!);
  expect(view).not.toBeNull();
  await act(async () => view!.dispatch({ changes: { from: 0, to: view!.state.doc.length, insert: '<h1>新稿</h1>' } }));
  await act(async () => view!.dispatch({ selection: { anchor: 4 } }));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="预览 HTML"]')!.click());
  expect(host.querySelector<HTMLIFrameElement>('iframe')!.srcdoc).toContain('新稿');
  expect(host.querySelector('.cm-editor')).toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="查看 HTML 源码"]')!.click());
  const restored = EditorView.findFromDOM(host.querySelector('.cm-editor')!);
  expect(restored?.state.selection.main.anchor).toBe(4);
  await act(async () => { undoDocumentHistory(path); });
  expect(restored?.state.doc.toString()).toBe('<h1>原文</h1>');
});

it('runs only the reviewed export enhancement inside an isolated preview', async () => {
  useDocumentStore.getState().setContent(path, await standaloneHtml('<article><h1>正文</h1></article>', '文件名'));
  await act(async () => root.render(<CodeEditor docKey={path} />));
  await act(() => vi.dynamicImportSettled());
  const frame = host.querySelector<HTMLIFrameElement>('iframe')!;
  const source = frame.srcdoc;
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
  expect(source).toContain('Content-Security-Policy');
  expect(source).toContain('script-src');
  expect(source).toContain('standaloneEnhancement.runtime.js');
  expect(source).toContain('.export-page-actions{display:none!important}');
  expect(source).toContain('<h1>正文</h1>');
  expect(host.querySelector('.nb-html-preview-message')).toBeNull();
});

it('explains blank canvases and opens the saved file only on request', async () => {
  const open = vi.spyOn(commands, 'openWithDefaultApp').mockResolvedValue();
  const html = '<h1>实时变形</h1><canvas id="preview"></canvas><script>document.querySelector("canvas").getContext("2d");</script>';
  useDocumentStore.getState().setContent(path, html);
  await act(async () => root.render(<CodeEditor docKey={path} />));
  await act(() => vi.dynamicImportSettled());

  const frame = host.querySelector<HTMLIFrameElement>('iframe')!;
  expect(frame.getAttribute('sandbox')).toBe('');
  expect(frame.srcdoc).toBe(html);
  expect(host.querySelector('[role=status]')?.textContent).toContain('画布内容可能为空');
  expect(open).not.toHaveBeenCalled();
  await act(async () => host.querySelector<HTMLButtonElement>('.nb-html-preview-message button')!.click());
  expect(open).toHaveBeenCalledExactlyOnceWith(path);

  await act(async () => useDocumentStore.getState().setExternalStatus(path, 'deleted'));
  const source = host.querySelector<HTMLButtonElement>('.nb-html-preview-message button')!;
  expect(source.textContent).toBe('查看源码');
  await act(async () => source.click());
  expect(useWindowStore.getState().getTab(path)?.viewMode).toBe('source');
  expect(EditorView.findFromDOM(host.querySelector('.cm-editor')!)?.state.doc.toString()).toBe(html);
});

it('retains static markup alongside modules and ignores data and template scripts', async () => {
  const staticHtml = '<h1>标题</h1><script type="application/ld+json">{}</script><template><script>render()</script></template>';
  useDocumentStore.getState().setContent(path, staticHtml);
  await act(async () => root.render(<CodeEditor docKey={path} />));
  await act(() => vi.dynamicImportSettled());
  expect(host.querySelector('.nb-html-preview-message')).toBeNull();

  const html = staticHtml + '<script type="module" src="./app.js"></script>';
  await act(async () => useDocumentStore.getState().setContent(path, html));
  expect(host.querySelector('[role=status]')?.textContent).toContain('脚本生成的内容');
  expect(host.querySelector<HTMLIFrameElement>('iframe')?.srcdoc).toBe(html);
});
