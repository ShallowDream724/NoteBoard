import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

const mock = vi.hoisted(() => ({
  key: 'C:\\notes\\a.md', directory: 'C:\\notes', generation: 1,
  editor: null as unknown as Editor, source: null as EditorView | null, capabilities: {},
  activeKey: 'C:\\notes\\a.md', mode: 'visual', transferring: false,
  documents: new Set<() => void>(), windows: new Set<() => void>(),
  save: vi.fn(), stage: vi.fn(), open: vi.fn(), read: vi.fn(), toast: vi.fn(), queue: vi.fn(), confirm: vi.fn(async () => true), probe: vi.fn(async () => ({ size: 1 })),
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
vi.mock('../../src/core/ipc/commands', () => ({ storeImageAsset: (directory: string, extension: string, bytes: Uint8Array) => directory.includes('.noteboard-assets') ? mock.stage(directory, extension, bytes) : mock.save(directory, extension, bytes), ensureStagingDirectory: async () => 'C:\\recovery', probeDocument: mock.probe }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mock.open, confirm: mock.confirm }));
vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: mock.read }));
vi.mock('../../src/stores/toastStore', () => ({ showToast: mock.toast }));
vi.mock('../../src/features/explorer/refreshAfterWrite', () => ({ refreshExplorerAfterWrite: async () => {} }));
import { handlePastedImageFile, handleImagePathsUsingLease, insertLocalImageWithDialog } from '../../src/features/editor-md/imagePaste';
import { captureSourceImageInsertion, captureVisualImageInsertion } from '../../src/features/editor-md/imageInsertionLease';
import { ImageCollection, ImageSlot } from '../../src/features/editor-md/rich-content/schema';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const file = (bytes: Promise<ArrayBuffer>) => ({ name: 'photo.png', size: 1, arrayBuffer: () => bytes } as File);
const imageCount = () => { let count = 0; mock.editor.state.doc.descendants(node => { if (node.type.name === 'image') count++; }); return count; };
beforeEach(() => {
  vi.clearAllMocks(); mock.key = 'C:\\notes\\a.md'; mock.directory = 'C:\\notes'; mock.generation = 1; mock.activeKey = mock.key; mock.mode = 'visual'; mock.transferring = false;
  mock.editor = new Editor({ extensions: [StarterKit, Image, ImageCollection, ImageSlot], content: '<p>abcd</p>' });
  mock.editor.commands.setTextSelection(3);
  mock.save.mockResolvedValue(`${'a'.repeat(64)}.png`); mock.read.mockResolvedValue(new Uint8Array([1]));
  mock.stage.mockReset().mockResolvedValue(`${'a'.repeat(64)}.png`);
});
afterEach(() => { mock.editor.destroy(); mock.source?.destroy(); mock.source = null; expect(mock.documents.size).toBe(0); expect(mock.windows.size).toBe(0); });

describe('async image insertion ownership', () => {
  it('asks before reading a large clipboard image and leaves no files when cancelled', async () => {
    const read = vi.fn(async () => new ArrayBuffer(1));
    mock.confirm.mockResolvedValueOnce(false);
    await handlePastedImageFile(mock.editor, { name: 'large.png', size: 51 * 1024 * 1024, arrayBuffer: read } as unknown as File, mock.key);
    expect(mock.confirm).toHaveBeenCalledOnce(); expect(read).not.toHaveBeenCalled();
    expect(mock.save).not.toHaveBeenCalled(); expect(imageCount()).toBe(0);
  });
  it('checks native image size through the existing file probe before reading its bytes', async () => {
    mock.probe.mockResolvedValueOnce({ size: 51 * 1024 * 1024 }); mock.confirm.mockResolvedValueOnce(false);
    await handleImagePathsUsingLease(captureVisualImageInsertion(mock.editor, mock.key), ['C:\\pictures\\large.png']);
    expect(mock.probe).toHaveBeenCalledWith('C:\\pictures\\large.png'); expect(mock.read).not.toHaveBeenCalled();
    expect(mock.save).not.toHaveBeenCalled(); expect(imageCount()).toBe(0);
  });
  it('writes an untitled pasted image to durable recovery storage before inserting its path', async () => {
    mock.key = 'untitled:note'; mock.activeKey = mock.key; mock.directory = '';
    await handlePastedImageFile(mock.editor, file(Promise.resolve(new Uint8Array([1, 2]).buffer)), mock.key);
    expect(mock.stage).toHaveBeenCalledWith('C:\\recovery\\.noteboard-assets', 'png', new Uint8Array([1, 2]));
    expect(mock.save).not.toHaveBeenCalled(); expect(imageCount()).toBe(1);
    expect(JSON.stringify(mock.editor.getJSON())).toContain('C:/recovery/.noteboard-assets/');
    expect(JSON.stringify(mock.editor.getJSON())).not.toContain('data:image/');
  });
  it('reports untitled resource write failure without inserting a Base64 fallback', async () => {
    mock.key = 'untitled:note'; mock.activeKey = mock.key; mock.directory = '';
    mock.stage.mockRejectedValue(new Error('disk full'));
    await handlePastedImageFile(mock.editor, file(Promise.resolve(new ArrayBuffer(1))), mock.key);
    expect(imageCount()).toBe(0);
    expect(mock.toast).toHaveBeenCalledWith(expect.stringContaining('disk full'), 'error');
  });
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
    const write = deferred<string>(); mock.save.mockReturnValue(write.promise);
    const pending = handlePastedImageFile(mock.editor, file(Promise.resolve(new ArrayBuffer(1))), mock.key);
    await vi.waitFor(() => expect(mock.save).toHaveBeenCalledOnce());
    mock.transferring = true; mock.windows.forEach(listener => listener());
    write.resolve(`${'a'.repeat(64)}.png`); await pending;
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
  it.each(['grid', 'carousel'])('keeps a pending %s slot target through edits and skips occupied slots for multiple native images', async layout => {
    mock.editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'text' }] }, { type: 'imageCollection', attrs: { layout }, content: [
      { type: 'imageSlot' }, { type: 'imageSlot' }, { type: 'imageSlot', content: [{ type: 'image', attrs: { src: './existing.png' } }] }, { type: 'imageSlot' },
    ] }] });
    const read = deferred<Uint8Array>(); mock.read.mockReturnValueOnce(read.promise);
    const lease = captureVisualImageInsertion(mock.editor, mock.key, 10);
    const pending = handleImagePathsUsingLease(lease, ['C:\\one.png', 'C:\\two.png', 'C:\\three.png']);
    mock.editor.commands.insertContentAt(1, 'prefix'); mock.editor.commands.setTextSelection(1);
    read.resolve(new Uint8Array([1])); await pending;
    const collection = mock.editor.state.doc.child(1);
    expect(collection.child(0).childCount).toBe(0);
    expect(collection.child(1).firstChild?.attrs.alt).toBe('one');
    expect(collection.child(2).firstChild?.attrs.src).toBe('./existing.png');
    expect(collection.child(3).firstChild?.attrs.alt).toBe('two');
    expect(collection.child(4).firstChild?.attrs.alt).toBe('three');
  });
  it('cancels native image insertion when the original empty slot is removed', async () => {
    mock.editor.commands.setContent({ type: 'doc', content: [{ type: 'imageCollection', content: [{ type: 'imageSlot' }, { type: 'imageSlot' }, { type: 'imageSlot' }] }] });
    const read = deferred<Uint8Array>(); mock.read.mockReturnValue(read.promise);
    const pending = handleImagePathsUsingLease(captureVisualImageInsertion(mock.editor, mock.key, 4), ['C:\\one.png']);
    mock.editor.commands.deleteRange({ from: 3, to: 5 });
    read.resolve(new Uint8Array([1])); await pending;
    expect(mock.save).not.toHaveBeenCalled(); expect(imageCount()).toBe(0);
  });
  it('does not overwrite a slot filled while image bytes were pending', async () => {
    mock.editor.commands.setContent({ type: 'doc', content: [{ type: 'imageCollection', content: [{ type: 'imageSlot' }, { type: 'imageSlot' }] }] });
    const read = deferred<Uint8Array>(); mock.read.mockReturnValue(read.promise);
    const pending = handleImagePathsUsingLease(captureVisualImageInsertion(mock.editor, mock.key, 2), ['C:\\one.png']);
    mock.editor.view.dispatch(mock.editor.state.tr.insert(2, mock.editor.schema.nodes.image.create({ src: './concurrent.png' })));
    read.resolve(new Uint8Array([1])); await pending;
    expect(mock.editor.state.doc.firstChild?.firstChild?.firstChild?.attrs.src).toBe('./concurrent.png');
    expect(mock.editor.state.doc.firstChild?.child(1).firstChild?.attrs.alt).toBe('one');
  });
});
