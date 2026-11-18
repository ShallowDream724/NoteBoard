import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/Tooltip';
import * as ipc from '@/core/ipc/commands';
import { TipTapEditor } from '@/features/editor-md/TipTapEditor';
import { getMdSourceView, getMdTipTapEditor } from '@/features/editor-md/editorInstances';
import { saveDocument } from '@/features/editor-code/orchestration/saveDocument';
import { getCurrentDocumentHistoryContent } from '@/features/history/documentHistory';
import { useDocumentStore } from '@/stores/documentStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useWindowStore } from '@/stores/windowStore';

// Exercise both editor kernels, shared history and the manual/automatic write queue.
// Only the native filesystem boundary is replaced.
vi.mock('@/core/ipc/commands', async original => ({
  ...await original<typeof import('@/core/ipc/commands')>(),
  writeDocument: vi.fn().mockResolvedValue({ ok: true, size: 1, mtime: 1, error: null }),
  deleteStagedFile: vi.fn().mockResolvedValue(undefined),
  setDocumentDirty: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  document.elementFromPoint = () => null;
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

const original = [
  'Setext title', '============', '', '',
  'A <mark>highlight</mark>, __bold__, and &amp;.  ', 'Change A here.', '',
  '+   [label][id]', '', "[id]: <https://example.org> 'title'", '', '',
].join('\n');

it.each(['visual', 'source'] as const)('keeps the exact Markdown source through %s-first open, save, mode switches and history', async initialMode => {
  const key = `C:\\notes\\${initialMode}-source-save.md`;
  const settings = useSettingsStore.getState().settings;
  useSettingsStore.setState({ settings: { ...settings, editor: { ...settings.editor, defaultViewMode: initialMode } } });
  const doc = useDocumentStore.getState().upsertFromPayload({
    key, kind: 'markdown', displayName: 'test.md', dirPath: 'C:\\notes', language: 'markdown',
    content: original, encoding: 'utf8', eol: 'lf', size: original.length, mtime: 0, readonly: false,
  });
  useDocumentStore.setState(state => ({ documents: new Map(state.documents).set(key, { ...doc, savePolicy: 'auto' }) }));
  useWindowStore.getState().openTab({
    key, kind: 'markdown', path: key, displayName: 'test.md', language: 'markdown', viewMode: null,
    isDirty: false, isPreview: false, externalStatus: null, isDetached: false,
  });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const press = async (target: HTMLElement, key: string) => act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true }));
  });
  const save = async (expected: string) => {
    await act(async () => { expect(await saveDocument(key)).toBe(true); });
    expect(ipc.writeDocument).toHaveBeenLastCalledWith(key, expected, 'utf8', 'lf');
    expect(useDocumentStore.getState().getDocument(key)?.isDirty).toBe(false);
  };
  try {
    await act(async () => { root.render(<TooltipProvider><TipTapEditor docKey={key} /></TooltipProvider>); });
    if (initialMode === 'visual') {
      await vi.waitFor(() => expect(getMdTipTapEditor(key)).toBeTruthy());
      expect(useDocumentStore.getState().getDocument(key)?.baselineContent).toBe(original);
      await save(original);
      await press(getMdTipTapEditor(key)!.view.dom, '/');
    }
    const source = getMdSourceView(key)!;
    expect(source.state.doc.toString()).toBe(original);
    const at = original.indexOf('A here');
    const edit = async (letter: string) => act(async () => {
      source.dispatch({ changes: { from: at, to: at + 1, insert: letter }, userEvent: 'input.type' });
    });
    const manual = original.replace('A here', 'B here');
    await edit('B');
    await save(manual);
    await press(source.contentDOM, '/');
    await vi.waitFor(() => expect(getMdTipTapEditor(key)).toBeTruthy());
    const visual = getMdTipTapEditor(key)!;
    await save(manual);
    await press(visual.view.dom, 'z');
    expect(getCurrentDocumentHistoryContent(key)).toBe(original);
    await save(original);
    await press(visual.view.dom, 'y');
    await press(visual.view.dom, '/');
    expect(source.state.doc.toString()).toBe(manual);
    await edit('C');
    await press(source.contentDOM, '/');
    const automatic = original.replace('A here', 'C here');
    await act(async () => {
      await vi.waitFor(() => expect(ipc.writeDocument).toHaveBeenLastCalledWith(key, automatic, 'utf8', 'lf'), { timeout: 3000 });
    });
    expect(useDocumentStore.getState().getDocument(key)?.baselineContent).toBe(automatic);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    useDocumentStore.getState().remove(key);
    useSettingsStore.setState({ settings });
  }
});
