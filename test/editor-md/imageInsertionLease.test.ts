import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

const mock = vi.hoisted(() => ({
  key: 'C:\\notes\\a.md', directory: 'C:\\notes', generation: 1,
  editor: null as any, source: null as any, capabilities: {},
  activeKey: 'C:\\notes\\a.md', mode: 'visual', transferring: false,
  documents: new Set<() => void>(), windows: new Set<() => void>(),
  save: vi.fn(), open: vi.fn(), read: vi.fn(), toast: vi.fn(), queue: vi.fn(),
}));
vi.mock('../../src/stores/documentStore', () => ({ useDocumentStore: {
  getState: () => ({ getDocument: (key: string) => key === mock.key ? { key, dirPath: mock.directory } : undefined }),
  subscribe: (listener: () => void) => { mock.documents.add(listener); return () => mock.documents.delete(listener); },
} }));
vi.mock('../../src/stores/windowStore', () => ({ useWindowStore: {
  getState: () => ({ activeKey: mock.activeKey, tabs: [{ key: mock.key, viewMode: mock.mode }], pendingCloseKeys: [], isWindowClosing: false, isTransferring: () => mock.transferring }),
  subscribe: (listener: () => void) => { mock.windows.add(listener); return () => mock.windows.delete(listener); },
} }));
vi.mock('../../src/stores/settingsStore', () => ({ useSettingsStore: { getState: () => ({ settings: { file: { imageDirName: 'img' } } }) } }));
vi.mock('../../src/core/editor/editorRegistry', () => ({ getEditorCapabilities: () => mock.capabilities }));
vi.mock('../../src/features/session/documentSession', () => ({ getSessionGeneration: () => mock.generation, isClosing: () => false,
  enqueueDocumentWrite: (key: string, writer: () => Promise<unknown>) => { mock.queue(key); return Promise.resolve().then(writer); },
}));
vi.mock('../../src/features/editor-md/editorInstances', () => ({ getMdTipTapEditor: () => mock.editor, getMdSourceView: () => mock.source }));
vi.mock('../../src/core/ipc/commands', () => ({ saveBinaryFile: mock.save }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mock.open }));
vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: mock.read }));
vi.mock('../../src/stores/toastStore', () => ({ showToast: mock.toast }));
vi.mock('../../src/features/explorer/refreshAfterWrite', () => ({ refreshExplorerAfterWrite: async () => {} }));
import { handlePastedImageFile, insertLocalImageWithDialog } from '../../src/features/editor-md/imagePaste';
import { captureSourceImageInsertion } from '../../src/features/editor-md/imageInsertionLease';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const file = (bytes: Promise<ArrayBuffer>) => ({ name: 'photo.png', arrayBuffer: () => bytes } as File);
const imageCount = () => { let count = 0; mock.editor.state.doc.descendants((node: any) => { if (node.type.name === 'image') count++; }); return count; };
beforeEach(() => {
  vi.clearAllMocks(); mock.generation = 1; mock.activeKey = mock.key; mock.mode = 'visual'; mock.transferring = false;
  mock.editor = new Editor({ extensions: [StarterKit, Image], content: '<p>abcd</p>' });
  mock.editor.commands.setTextSelection(3);
  mock.save.mockResolvedValue({ ok: true }); mock.read.mockResolvedValue(new Uint8Array([1]));
});
afterEach(() => { mock.editor.destroy(); mock.source?.destroy(); mock.source = null; expect(mock.documents.size).toBe(0); expect(mock.windows.size).toBe(0); });

describe('async image insertion ownership', () => {
  it('does not write or insert after a session changes while reading clipboard bytes', async () => {
    const bytes = deferred<ArrayBuffer>();
    const pending = handlePastedImageFile(mock.editor, file(bytes.promise), mock.key);
    mock.generation++; mock.documents.forEach(listener => listener());
    bytes.resolve(new ArrayBuffer(1)); await pending;
    expect(mock.save).not.toHaveBeenCalled(); expect(imageCount()).toBe(0);
  });
  it('maps the original insertion bookmark through typing and ignores a later cursor move', async () => {
    const bytes = deferred<ArrayBuffer>();
    const pending = handlePastedImageFile(mock.editor, file(bytes.promise), mock.key);
    mock.editor.commands.insertContentAt(1, 'X'); mock.editor.commands.setTextSelection(1);
    bytes.resolve(new ArrayBuffer(1)); await pending;
    expect(mock.queue).toHaveBeenCalledWith(mock.key); expect(imageCount()).toBe(1);
    expect(mock.editor.state.doc.child(0).textContent).toBe('Xab');
  });
  it('retains an already-written file but cannot insert after migration begins', async () => {
    const write = deferred<{ ok: boolean }>(); mock.save.mockReturnValue(write.promise);
    const pending = handlePastedImageFile(mock.editor, file(Promise.resolve(new ArrayBuffer(1))), mock.key);
    await vi.waitFor(() => expect(mock.save).toHaveBeenCalledOnce());
    mock.transferring = true; mock.windows.forEach(listener => listener());
    write.resolve({ ok: true }); await pending;
    expect(imageCount()).toBe(0); expect(mock.toast).toHaveBeenCalledWith(expect.stringContaining('保留'), 'info', 6000);
  });
  it('cancels when the original selected target is deleted while bytes are pending', async () => {
    mock.editor.commands.setTextSelection({ from: 2, to: 4 });
    const bytes = deferred<ArrayBuffer>();
    const pending = handlePastedImageFile(mock.editor, file(bytes.promise), mock.key);
    mock.editor.commands.deleteRange({ from: 2, to: 4 });
    bytes.resolve(new ArrayBuffer(1)); await pending;
    expect(mock.save).not.toHaveBeenCalled(); expect(imageCount()).toBe(0);
  });
  it('invalidates a pending picker when switching away, even after returning to the same tab', async () => {
    const picker = deferred<string>(); mock.open.mockReturnValue(picker.promise);
    const pending = insertLocalImageWithDialog(mock.editor, mock.key);
    mock.activeKey = 'other'; mock.windows.forEach(listener => listener());
    mock.activeKey = mock.key; mock.windows.forEach(listener => listener());
    picker.resolve('C:\\photo.png'); await pending;
    expect(mock.read).not.toHaveBeenCalled(); expect(mock.save).not.toHaveBeenCalled(); expect(imageCount()).toBe(0);
  });
  it('maps source-mode selection without resolving a different source instance after the await', () => {
    mock.mode = 'source'; mock.source = new EditorView({ state: EditorState.create({ doc: 'abcd', selection: { anchor: 2 } }) });
    const lease = captureSourceImageInsertion(mock.source, mock.key)!;
    mock.source.dispatch({ changes: { from: 0, insert: 'X' } }); mock.source.dispatch({ selection: { anchor: 0 } });
    expect(lease.commit({ src: './img/a.png', alt: 'photo' })).toBe(true);
    expect(mock.source.state.doc.toString()).toBe('Xab![photo](<./img/a.png>)cd');
  });
});
