import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { ImageNode } from '../../src/features/editor-md/documentNodes';
import { ImageCollection, ImageSlot } from '../../src/features/editor-md/rich-content/schema';

type WindowState = { activeKey: string | null; tabs: { key: string; viewMode: string | null }[]; isWindowClosing: boolean; pendingCloseKeys: string[]; transferringKeys: string[] };
type OpenRequest = { key: string; src: string; onSave(blob: Blob, metadata: { extension: 'png' | 'jpg' | 'webp'; mimeType: string; width: number; height: number }, signal?: AbortSignal): Promise<boolean | void> };
const mock = vi.hoisted(() => ({
  docKey: 'C:/notes/note.nb', directory: 'C:/notes', exists: true, generation: 1, revision: 0,
  editor: null as Editor | null, uiLoaded: 0,
  window: { activeKey: 'C:/notes/note.nb', tabs: [{ key: 'C:/notes/note.nb', viewMode: 'visual' }], isWindowClosing: false, pendingCloseKeys: [], transferringKeys: [] } as WindowState,
  documents: new Set<() => void>(), windows: new Set<(state: WindowState, previous: WindowState) => void>(),
  editorListeners: new Set<(key: string, editor: Editor) => void>(),
  open: vi.fn<(request: OpenRequest) => void>(), suspend: vi.fn(), discard: vi.fn(),
  publish: vi.fn(), stage: vi.fn(), picker: vi.fn(), write: vi.fn(), emit: vi.fn(), toast: vi.fn(), queue: vi.fn(),
}));
vi.mock('../../src/features/image-editor/index', () => { mock.uiLoaded++; return { openImageEditor: mock.open, suspendImageEditor: mock.suspend, discardImageEditor: mock.discard }; });
vi.mock('../../src/stores/documentStore', () => ({ useDocumentStore: {
  getState: () => ({ hasDocument: (key: string) => mock.exists && key === mock.docKey, getDocument: (key: string) => mock.exists && key === mock.docKey ? { key, dirPath: mock.directory } : undefined }),
  subscribe: (listener: () => void) => { mock.documents.add(listener); return () => mock.documents.delete(listener); },
} }));
vi.mock('../../src/stores/windowStore', () => ({ useWindowStore: {
  getState: () => ({ ...mock.window, isTransferring: () => false, getTab: (key: string) => mock.window.tabs.find(tab => tab.key === key) }),
  subscribe: (listener: (state: WindowState, previous: WindowState) => void) => { mock.windows.add(listener); return () => mock.windows.delete(listener); },
} }));
vi.mock('../../src/features/session/documentSession', () => ({ getSessionGeneration: () => mock.generation, isClosing: () => false,
  enqueueDocumentWrite: (key: string, writer: () => Promise<unknown>) => { mock.queue(key); return Promise.resolve().then(writer); },
}));
vi.mock('../../src/core/editor/editorRegistry', () => ({ getDocumentRevision: () => mock.revision }));
vi.mock('../../src/features/editor-md/editorInstances', () => ({
  getMdTipTapEditor: () => mock.editor,
  subscribeMdTipTapEditors: (listener: (key: string, editor: Editor) => void) => { mock.editorListeners.add(listener); return () => mock.editorListeners.delete(listener); },
}));
vi.mock('../../src/features/editor-md/imageAssetStorage', () => ({ publishImageAsset: mock.publish, storeTransientImage: mock.stage }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: mock.picker }));
vi.mock('../../src/core/ipc/commands', () => ({ writeImageEdit: mock.write }));
vi.mock('../../src/core/emitter', () => ({ emit: mock.emit, on: vi.fn(), off: vi.fn() }));
vi.mock('../../src/stores/toastStore', () => ({ showToast: mock.toast }));
vi.mock('../../src/features/explorer/refreshAfterWrite', () => ({ refreshExplorerAfterWrite: async () => {} }));
vi.mock('../../src/features/explorer/directoryWatcher', () => ({ noteSelfWrite: vi.fn() }));

import { editDocumentImage, editImageFile } from '../../src/features/image-editor/integration';

const original = { src: './img/original.png', width: '75%', align: 'right', caption: 'caption', alt: 'alt', title: 'title' };
const metadata = { extension: 'png' as const, mimeType: 'image/png', width: 80, height: 60 };
const imageBlob = (read = Promise.resolve(new Uint8Array([1, 2, 3]).buffer)) => ({ arrayBuffer: () => read }) as Blob;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function updateWindow(patch: Partial<WindowState>) { const previous = mock.window; mock.window = { ...previous, ...patch }; for (const listener of [...mock.windows]) listener(mock.window, previous); }
const imagePositions = () => { const result: number[] = []; mock.editor!.state.doc.descendants((node, pos) => { if (node.type.name === 'image') result.push(pos); }); return result; };
const request = () => mock.open.mock.calls.at(-1)![0];
function makeEditor(content: object = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'text' }] }, { type: 'image', attrs: original }] }) {
  return new Editor({ extensions: [StarterKit, ImageNode, ImageCollection, ImageSlot], content });
}
beforeEach(() => {
  vi.clearAllMocks(); mock.docKey = 'C:/notes/note.nb'; mock.directory = 'C:/notes'; mock.exists = true; mock.generation = 1; mock.revision = 0;
  mock.window = { activeKey: mock.docKey, tabs: [{ key: mock.docKey, viewMode: 'visual' }], isWindowClosing: false, pendingCloseKeys: [], transferringKeys: [] };
  mock.editor = makeEditor(); mock.publish.mockResolvedValue('./img/edited.png'); mock.stage.mockResolvedValue('C:/recovery/.noteboard-assets/edited.png');
  mock.write.mockResolvedValue({ ok: true }); mock.picker.mockResolvedValue(null);
});
afterEach(() => {
  mock.exists = false; [...mock.documents].forEach(listener => listener()); mock.editor?.destroy();
  expect(mock.documents.size).toBe(0); expect(mock.windows.size).toBe(0); expect(mock.editorListeners.size).toBe(0);
});

describe('document image editor integration', () => {
  it('loads the editor only on demand, keeps the target through earlier edits, and saves one reversible attribute edit', async () => {
    expect(mock.uiLoaded).toBe(0);
    await editDocumentImage(mock.editor!, mock.docKey, imagePositions()[0], 'asset://original');
    const key = request().key;
    mock.editor!.commands.insertContentAt(1, 'prefix');
    mock.editor!.view.dispatch(mock.editor!.state.tr.setNodeAttribute(imagePositions()[0], 'caption', 'latest caption').setNodeAttribute(imagePositions()[0], 'width', '50%'));
    await editDocumentImage(mock.editor!, mock.docKey, imagePositions()[0], 'asset://original');
    expect(request().key).toBe(key);
    expect(await request().onSave(imageBlob(), metadata)).toBe(true);
    expect(mock.publish).toHaveBeenCalledWith('', new Uint8Array([1, 2, 3]), 'png', mock.docKey);
    expect(mock.queue).toHaveBeenCalledWith(mock.docKey);
    expect(mock.editor!.state.doc.nodeAt(imagePositions()[0])!.attrs).toMatchObject({ ...original, src: './img/edited.png', caption: 'latest caption', width: '50%' });
    mock.editor!.commands.undo();
    expect(mock.editor!.state.doc.nodeAt(imagePositions()[0])!.attrs).toMatchObject({ ...original, caption: 'latest caption', width: '50%' });
    expect(mock.editor!.state.doc.firstChild!.textContent).toBe('prefixtext');
  });
  it('writes untitled document edits into durable recovery assets', async () => {
    mock.docKey = 'untitled:note'; mock.directory = ''; mock.window = { ...mock.window, activeKey: mock.docKey, tabs: [{ key: mock.docKey, viewMode: 'visual' }] };
    await editDocumentImage(mock.editor!, mock.docKey, imagePositions()[0], 'asset://original');
    await request().onSave(imageBlob(), metadata);
    expect(mock.publish).not.toHaveBeenCalled();
    expect(mock.stage).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), 'image-edited.png', 'image/png');
  });
  it.each(['grid', 'carousel'])('replaces only the selected %s image and retains its slot caption', async layout => {
    mock.editor!.commands.setContent({ type: 'doc', content: [{ type: 'imageCollection', attrs: { layout }, content: [
      { type: 'imageSlot', content: [{ type: 'image', attrs: original }, { type: 'paragraph', content: [{ type: 'text', text: 'slot caption' }] }] },
      { type: 'imageSlot', content: [{ type: 'image', attrs: { src: './img/other.png' } }] },
    ] }] });
    await editDocumentImage(mock.editor!, mock.docKey, imagePositions()[0], 'asset://original');
    expect(await request().onSave(imageBlob(), metadata)).toBe(true);
    const collection = mock.editor!.state.doc.firstChild!;
    expect(collection.attrs.layout).toBe(layout);
    expect(collection.firstChild!.firstChild!.attrs).toMatchObject({ ...original, src: './img/edited.png' });
    expect(collection.firstChild!.lastChild!.textContent).toBe('slot caption');
    expect(collection.lastChild!.firstChild!.attrs.src).toBe('./img/other.png');
  });
  it('does not persist or mutate after the original image is deleted while reading export bytes', async () => {
    await editDocumentImage(mock.editor!, mock.docKey, imagePositions()[0], 'asset://original');
    const bytes = deferred<ArrayBuffer>(), pending = request().onSave(imageBlob(bytes.promise), metadata);
    const at = imagePositions()[0]; mock.editor!.commands.deleteRange({ from: at, to: at + 1 });
    bytes.resolve(new ArrayBuffer(1)); expect(await pending).toBe(false);
    expect(mock.publish).not.toHaveBeenCalled(); expect(mock.discard).toHaveBeenCalledWith(request().key);
  });
  it('rejects a replacement even if the replacement uses the same source', async () => {
    await editDocumentImage(mock.editor!, mock.docKey, imagePositions()[0], 'asset://original');
    const save = request().onSave;
    const at = imagePositions()[0]; mock.editor!.view.dispatch(mock.editor!.state.tr.replaceWith(at, at + 1, mock.editor!.schema.nodes.image.create({ ...original, alt: 'replacement' })));
    expect(await save(imageBlob(), metadata)).toBe(false);
    expect(mock.publish).not.toHaveBeenCalled();
  });
  it('does not apply a late asset write after replacement or session close', async () => {
    await editDocumentImage(mock.editor!, mock.docKey, imagePositions()[0], 'asset://original');
    const write = deferred<string>(); mock.publish.mockReturnValueOnce(write.promise);
    const pending = request().onSave(imageBlob(), metadata);
    await vi.waitFor(() => expect(mock.publish).toHaveBeenCalledOnce());
    mock.generation++; [...mock.documents].forEach(listener => listener());
    write.resolve('./img/late.png'); expect(await pending).toBe(false);
    expect(mock.editor!.state.doc.nodeAt(imagePositions()[0])!.attrs.src).toBe(original.src);
  });
  it('retains draft identity on tab switch and cancels an export even after the original tab is active again', async () => {
    await editDocumentImage(mock.editor!, mock.docKey, imagePositions()[0], 'asset://original');
    const key = request().key, bytes = deferred<ArrayBuffer>(), pending = request().onSave(imageBlob(bytes.promise), metadata);
    updateWindow({ activeKey: 'other' }); updateWindow({ activeKey: mock.docKey });
    bytes.resolve(new ArrayBuffer(1)); expect(await pending).toBe(false);
    expect(mock.suspend).toHaveBeenCalled(); expect(mock.discard).not.toHaveBeenCalled();
    await editDocumentImage(mock.editor!, mock.docKey, imagePositions()[0], 'asset://original'); expect(request().key).toBe(key);
  });
  it('does not replace the document image after the dialog aborts during an asset write', async () => {
    await editDocumentImage(mock.editor!, mock.docKey, imagePositions()[0], 'asset://original');
    const write = deferred<string>(), abort = new AbortController(); mock.publish.mockReturnValueOnce(write.promise);
    const pending = request().onSave(imageBlob(), metadata, abort.signal);
    await vi.waitFor(() => expect(mock.publish).toHaveBeenCalledOnce());
    abort.abort(); write.resolve('./img/cancelled.png');
    expect(await pending).toBe(false);
    expect(mock.editor!.state.doc.nodeAt(imagePositions()[0])!.attrs.src).toBe(original.src);
    expect(mock.editor!.can().undo()).toBe(false);
  });
  it('preserves a recipe through view recycling and refuses to rebind it across an untracked source edit', async () => {
    await editDocumentImage(mock.editor!, mock.docKey, imagePositions()[0], 'asset://original');
    const key = request().key, content = mock.editor!.getJSON(); mock.editor!.destroy();
    expect(mock.discard).not.toHaveBeenCalled();
    mock.editor = makeEditor(content); [...mock.editorListeners].forEach(listener => listener(mock.docKey, mock.editor!));
    await editDocumentImage(mock.editor!, mock.docKey, imagePositions()[0], 'asset://original'); expect(request().key).toBe(key);
    mock.editor.destroy(); mock.revision++; mock.editor = makeEditor(content);
    [...mock.editorListeners].forEach(listener => listener(mock.docKey, mock.editor!));
    expect(mock.discard).toHaveBeenCalledWith(key);
    await editDocumentImage(mock.editor!, mock.docKey, imagePositions()[0], 'asset://original'); expect(request().key).not.toBe(key);
  });
  it('leaves document content intact when resource persistence fails', async () => {
    await editDocumentImage(mock.editor!, mock.docKey, imagePositions()[0], 'asset://original');
    mock.publish.mockRejectedValueOnce(new Error('disk full'));
    await expect(request().onSave(imageBlob(), metadata)).rejects.toThrow('disk full');
    expect(mock.editor!.state.doc.nodeAt(imagePositions()[0])!.attrs.src).toBe(original.src);
    expect(mock.editor!.can().undo()).toBe(false);
  });
});

describe('standalone image Save As', () => {
  it('defaults to an edited copy and treats native picker cancellation as no mutation', async () => {
    await editImageFile(mock.docKey, 'C:/pictures/photo.jpg', 'asset://photo', 'photo.jpg');
    expect(await request().onSave(imageBlob(), metadata)).toBe(false);
    expect(mock.picker).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: 'C:/pictures/photo-edited.png' }));
    expect(mock.write).not.toHaveBeenCalled();
  });
  it('writes bytes only to the explicit chosen path and refreshes the source after overwrite', async () => {
    await editImageFile(mock.docKey, 'C:/pictures/photo.png', 'asset://photo', 'photo.png');
    mock.picker.mockResolvedValueOnce('C:/pictures/photo.png');
    expect(await request().onSave(imageBlob(), metadata)).toBe(true);
    expect(mock.write).toHaveBeenCalledWith('C:/pictures/photo.png', new Uint8Array([1, 2, 3]));
    expect(mock.emit).toHaveBeenCalledWith('image-file-restored', { path: 'C:/pictures/photo.png' });
  });
  it('reports failed native writes without successful-save feedback or source refresh', async () => {
    await editImageFile(mock.docKey, 'C:/pictures/photo.png', 'asset://photo', 'photo.png');
    mock.picker.mockResolvedValueOnce('C:/pictures/photo.png'); mock.write.mockResolvedValueOnce({ ok: false, error: { kind: 'disk-full' } });
    await expect(request().onSave(imageBlob(), metadata)).rejects.toThrow('disk-full');
    expect(mock.emit).not.toHaveBeenCalled(); expect(mock.toast).not.toHaveBeenCalled();
  });
});
