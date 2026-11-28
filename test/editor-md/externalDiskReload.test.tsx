import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { on, off } from '@/core/emitter';
import { getEditorCapabilities } from '@/core/editor/editorRegistry';
import { readDocument } from '@/core/ipc/commands';
import type { DocumentPayload } from '@/core/ipc/types';
import { encodeNativeDocument, readNativeMetadata, replaceNativeMetadata } from '@/core/nativeDocument';
import { useDocumentStore } from '@/stores/documentStore';
import { useWindowStore } from '@/stores/windowStore';
import { TipTapEditor } from '@/features/editor-md/TipTapEditor';
import { getMdSourceView, getMdTipTapEditor } from '@/features/editor-md/editorInstances';
import { getBaseline } from '@/features/editor-md/serialize';
import { reloadFromDisk } from '@/features/external/externalChangeActions';
import { getDocumentHistoryAvailability, undoDocumentHistory } from '@/features/history/documentHistory';

vi.mock('@/core/ipc/commands', async original => ({
  ...await original<typeof import('@/core/ipc/commands')>(),
  readDocument: vi.fn(),
}));
vi.mock('@/features/editor-md/bubbleMenu', () => ({ EditorBubbleMenu: () => null, TableToolbar: () => null }));
vi.mock('@/features/editor-md/blockDragHandle', () => ({ BlockDragHandle: () => null }));
vi.mock('@/features/editor-md/EditorContextMenu', () => ({ EditorContextMenu: () => null }));
vi.mock('@/features/editor-md/LinkModal', () => ({ LinkModal: () => null }));
vi.mock('@/features/editor-md/MarkdownModeToggle', () => ({ MarkdownModeToggle: () => null }));
vi.mock('@/features/editor-md/markdownAutoSave', () => ({ autoSaveDocument: vi.fn() }));

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  useDocumentStore.getState().clear();
  useWindowStore.setState({ tabs: [], activeKey: null, transferringKeys: [] });
  vi.mocked(readDocument).mockReset();
});

afterEach(() => vi.restoreAllMocks());

function payload(kind: 'markdown' | 'noteboard', text: string, path: string): DocumentPayload {
  const displayName = kind === 'markdown' ? 'reload.md' : 'reload.nb';
  const content = kind === 'markdown' ? text : replaceNativeMetadata(encodeNativeDocument({ type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text }] },
  ] }), { markdown: { path, baselineHash: path, projectionVersion: 1 } });
  return {
    key: `C:\\notes\\${displayName}`, displayName, dirPath: 'C:\\notes', kind, language: 'markdown',
    content, encoding: 'utf8', eol: 'lf', size: content.length, mtime: 1, readonly: false,
  };
}

async function mount(initial: DocumentPayload, mode: 'source' | 'visual') {
  const { key, displayName, kind, language } = initial;
  useDocumentStore.getState().upsertFromPayload(initial);
  useWindowStore.getState().openTab({
    key, displayName, kind, language, path: key, isDirty: false, isPreview: false,
    viewMode: mode, externalStatus: 'clean', isDetached: false,
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(<TipTapEditor docKey={key} />); });
  if (mode === 'visual') await act(async () => { await vi.waitFor(() => expect(getMdTipTapEditor(key)).not.toBeNull()); });
  return async () => {
    await act(async () => { root.unmount(); });
    host.remove();
  };
}

function typeAtStart(key: string, mode: 'source' | 'visual', text: string) {
  if (mode === 'source') getMdSourceView(key)!.dispatch({ changes: { from: 0, insert: text } });
  else getMdTipTapEditor(key)!.view.dispatch(getMdTipTapEditor(key)!.state.tr.insertText(text, 1));
}

function documentText(key: string, mode: 'source' | 'visual') {
  return mode === 'source' ? getMdSourceView(key)!.state.doc.toString() : getMdTipTapEditor(key)!.state.doc.textContent;
}

function markConflict(key: string) {
  useDocumentStore.getState().setExternalStatus(key, 'modified');
  useWindowStore.getState().setTabExternalStatus(key, 'modified');
}

it.each([['markdown', 'source'], ['noteboard', 'source'], ['noteboard', 'visual']] as const)(
  'reload replaces mounted %s in %s mode and resets undo to the disk version', async (kind, mode) => {
    const initial = payload(kind, 'Initial text', 'old.md');
    const disk = { ...payload(kind, 'Disk text', 'new.md'), mtime: 2 };
    const { key } = initial;
    const unmount = await mount(initial, mode);
    const loaded = vi.fn();
    on('document-loaded', loaded);
    try {
      await act(async () => { typeAtStart(key, mode, 'Local '); markConflict(key); });
      expect(documentText(key, mode)).toBe('Local Initial text');
      vi.mocked(readDocument).mockResolvedValue(disk);
      await act(async () => { expect(await reloadFromDisk(key)).toBe(true); });

      expect(documentText(key, mode)).toBe('Disk text');
      expect(useDocumentStore.getState().getDocument(key)).toMatchObject({
        content: disk.content, baselineContent: disk.content, persistedContent: disk.content,
        mtime: disk.mtime, isDirty: false, externalStatus: 'clean',
      });
      expect(useWindowStore.getState().getTab(key)).toMatchObject({ isDirty: false, externalStatus: 'clean' });
      expect(getBaseline(key).getBaseline()).toBe(disk.content);
      expect(getDocumentHistoryAvailability(key)).toEqual({ canUndo: false, canRedo: false });
      expect(loaded).toHaveBeenCalledWith({ key });

      const captured = await getEditorCapabilities(key)!.flush('save');
      expect(captured?.content).toBe(disk.content);
      if (kind === 'noteboard') expect(readNativeMetadata(captured!.content!).markdown?.path).toBe('new.md');
      await act(async () => { typeAtStart(key, mode, 'New '); expect(undoDocumentHistory(key)).toBe(true); });
      expect(documentText(key, mode)).toBe('Disk text');
      expect(useDocumentStore.getState().getDocument(key)?.isDirty).toBe(false);
    } finally {
      off('document-loaded', loaded);
      await unmount();
    }
  },
);

it('keeps new source input and the conflict when the disk read resolves later', async () => {
  const initial = payload('markdown', 'Initial text', 'old.md');
  const { key } = initial;
  const unmount = await mount(initial, 'source');
  try {
    await act(async () => { markConflict(key); });
    let finishRead!: (value: DocumentPayload) => void;
    vi.mocked(readDocument).mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
    const reloading = reloadFromDisk(key);
    await vi.waitFor(() => expect(readDocument).toHaveBeenCalledWith(key));
    await act(async () => { typeAtStart(key, 'source', 'Local '); });
    finishRead(payload('markdown', 'Disk text', 'new.md'));
    expect(await reloading).toBe(false);
    expect(documentText(key, 'source')).toBe('Local Initial text');
    expect(useDocumentStore.getState().getDocument(key)).toMatchObject({
      persistedContent: initial.content, isDirty: true, externalStatus: 'modified',
    });
    expect(useWindowStore.getState().getTab(key)?.externalStatus).toBe('modified');
  } finally { await unmount(); }
});

it('opens the conflict comparison with both versions read-only and returns focus on close', async () => {
  const initial = payload('markdown', 'Initial text', 'old.md');
  const { key } = initial;
  const unmount = await mount(initial, 'source');
  try {
    await act(async () => { typeAtStart(key, 'source', 'Local '); markConflict(key); });
    vi.mocked(readDocument).mockResolvedValue(payload('markdown', 'Disk text', 'new.md'));
    const trigger = document.querySelector<HTMLButtonElement>('.nb-external-change-actions [aria-haspopup="dialog"]')!;
    trigger.focus();
    await act(async () => {
      trigger.click();
      await vi.dynamicImportSettled();
    });
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"] [aria-label="当前编辑内容"]')?.textContent).toBe('Local Initial text'));
    const views = Array.from(document.querySelectorAll('[role="dialog"] [aria-readonly="true"]'));
    expect(views.map(view => view.textContent)).toEqual(['Local Initial text', 'Disk text']);
    expect(views.every(view => view.getAttribute('contenteditable') === 'false')).toBe(true);
    expect(document.querySelector('[role="dialog"] .cm-changedText')).not.toBeNull();
    expect(documentText(key, 'source')).toBe('Local Initial text');
    expect(useDocumentStore.getState().getDocument(key)).toMatchObject({
      persistedContent: initial.content, isDirty: true, externalStatus: 'modified',
    });

    await act(async () => document.querySelector<HTMLButtonElement>('[role="dialog"] [aria-label="关闭"]')!.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(useDocumentStore.getState().getDocument(key)?.externalStatus).toBe('modified');
  } finally { await unmount(); }
});

it('retains the conflict, disk baseline and live source when reading fails', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const initial = payload('markdown', 'Initial text', 'old.md');
  const { key } = initial;
  const unmount = await mount(initial, 'source');
  try {
    await act(async () => { typeAtStart(key, 'source', 'Local '); markConflict(key); });
    vi.mocked(readDocument).mockRejectedValueOnce(new Error('Access denied'));
    await act(async () => { expect(await reloadFromDisk(key)).toBe(false); });
    expect(documentText(key, 'source')).toBe('Local Initial text');
    expect(useDocumentStore.getState().getDocument(key)).toMatchObject({
      persistedContent: initial.content, isDirty: true, externalStatus: 'modified',
    });
    expect(useWindowStore.getState().getTab(key)?.externalStatus).toBe('modified');
  } finally { await unmount(); }
});

it('discards a read from a previous session after the same path reopens', async () => {
  const initial = payload('markdown', 'Initial text', 'old.md');
  const { key } = initial;
  const store = useDocumentStore.getState();
  store.upsertFromPayload(initial);
  markConflict(key);
  let finishRead!: (value: DocumentPayload) => void;
  vi.mocked(readDocument).mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
  const reloading = reloadFromDisk(key);
  await vi.waitFor(() => expect(readDocument).toHaveBeenCalledWith(key));
  store.remove(key);
  store.upsertFromPayload({ ...initial, content: 'New session' });
  markConflict(key);
  finishRead(payload('markdown', 'Old read', 'old.md'));
  expect(await reloading).toBe(false);
  expect(store.getDocument(key)).toMatchObject({ content: 'New session', externalStatus: 'modified' });
});
