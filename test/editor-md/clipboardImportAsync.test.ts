import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { ClipboardImport, clipboardImportTiming, importClipboardSnapshot, TABLE_SELECTION_MIME } from '../../src/features/editor-md/clipboard/clipboardImport';
import { readClipboardSnapshot, pasteFromSystemClipboard } from '../../src/features/editor-md/clipboard/systemClipboard';
import { registerMdTipTapEditor } from '../../src/features/editor-md/editorInstances';
import { useDocumentStore, type Document } from '../../src/stores/documentStore';
import { useWindowStore, type Tab } from '../../src/stores/windowStore';

vi.mock('../../src/features/editor-md/imagePaste', () => ({ handlePastedImageFiles: vi.fn() }));
class WorkerMock {
  static instances: WorkerMock[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminate = vi.fn(); postMessage = vi.fn();
  constructor() { WorkerMock.instances.push(this); }
  respond(text: string) { this.onmessage?.({ data: { ok: true, result: { content: [{ type: 'paragraph', content: [{ type: 'text', text }] }], nodes: 2, diagnostics: [] } } } as MessageEvent); }
}
const key = 'untitled:clipboard-test'; let editor: Editor, unregister: () => void;
const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
function setClipboard(value: unknown) { Object.defineProperty(navigator, 'clipboard', { value, configurable: true }); }
beforeEach(() => {
  WorkerMock.instances = []; vi.stubGlobal('Worker', WorkerMock);
  useDocumentStore.setState({ documents: new Map([[key, { key, dirPath: '' } as Document]]) });
  useWindowStore.setState({ activeKey: key, tabs: [{ key, viewMode: 'visual' } as Tab] });
  editor = new Editor({ extensions: [...buildDocumentExtensions(), ClipboardImport.configure({ docKey: key })], content: '<p>abcd</p>' });
  unregister = registerMdTipTapEditor(key, editor); editor.commands.setTextSelection(3);
});
afterEach(() => { unregister(); editor.destroy(); useDocumentStore.setState({ documents: new Map() }); useWindowStore.setState({ activeKey: null, tabs: [] }); if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor); else Reflect.deleteProperty(navigator, 'clipboard'); vi.unstubAllGlobals(); });
function pasteLarge() {
  const raw = '<!--' + 'padding'.repeat(5000) + '--><p>large</p>';
  const event = { clipboardData: { types: ['text/html'], getData: () => raw }, preventDefault: vi.fn() } as unknown as ClipboardEvent;
  editor.view.someProp('handleDOMEvents', handlers => handlers.paste?.(editor.view, event));
  return WorkerMock.instances.at(-1)!;
}
describe('asynchronous rich paste ownership', () => {
  it('responds with a mapped placeholder, preserves original target through typing, and commits once', async () => {
    const worker = pasteLarge(); expect(worker).toBeDefined(); expect(editor.view.dom.textContent).toContain('正在粘贴');
    editor.commands.insertContentAt(1, 'X'); editor.commands.setTextSelection(1);
    worker.respond('PASTE'); await vi.waitFor(() => expect(editor.state.doc.textContent).toBe('XabPASTEcd'));
    expect(editor.view.dom.textContent).not.toContain('正在粘贴'); expect(worker.terminate).toHaveBeenCalledOnce();
    expect(clipboardImportTiming()).toMatchObject({ asynchronous: true });
    editor.commands.undo(); expect(editor.state.doc.textContent).toBe('Xabcd');
  });
  it('Escape terminates worker and removes placeholder without a content undo entry', async () => {
    const worker = pasteLarge(); editor.view.someProp('handleKeyDown', handler => handler(editor.view, new KeyboardEvent('keydown', { key: 'Escape' })));
    await vi.waitFor(() => expect(worker.terminate).toHaveBeenCalledOnce());
    expect(editor.state.doc.textContent).toBe('abcd'); expect(editor.view.dom.textContent).not.toContain('正在粘贴');
    expect(editor.can().undo()).toBe(false);
  });
  it('switching files cancels permanently even when the same file becomes active again', async () => {
    const worker = pasteLarge(); useWindowStore.setState({ activeKey: 'other' }); useWindowStore.setState({ activeKey: key });
    await vi.waitFor(() => expect(worker.terminate).toHaveBeenCalledOnce());
    expect(editor.state.doc.textContent).toBe('abcd');
  });
  it('menu snapshot reads rich HTML without decoding the redundant PNG', async () => {
    const getType = vi.fn(async (type: string) => ({ text: async () => type === 'text/html' ? '<p>rich</p>' : 'rich' }));
    setClipboard({ read: async () => [{ types: ['text/html', 'image/png', 'text/plain'], getType }] });
    const snapshot = await readClipboardSnapshot();
    expect(snapshot.formats['text/html']).toBe('<p>rich</p>'); expect(snapshot.files).toEqual([]);
    expect(getType).not.toHaveBeenCalledWith('image/png');
  });
  it('plain menu paste preserves literal tags and maps the selection while clipboard read awaits', async () => {
    let resolve!: (value: string) => void;
    setClipboard({ readText: () => new Promise<string>(done => { resolve = done; }) });
    const pending = pasteFromSystemClipboard(editor, true);
    editor.commands.insertContentAt(1, 'X'); editor.commands.setTextSelection(1);
    resolve('<b>literal</b>'); await pending;
    expect(editor.state.doc.textContent).toBe('Xab<b>literal</b>cd');
    expect(editor.state.doc.firstChild?.firstChild?.marks).toEqual([]);
  });
  it('large explicit text snapshot takes the cancellable worker path', async () => {
    importClipboardSnapshot(editor.view, { formats: { 'text/plain': 'literal\n'.repeat(5000) } }, true);
    const worker = WorkerMock.instances.at(-1)!;
    expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: 'text' }));
    editor.view.someProp('handleKeyDown', handler => handler(editor.view, new KeyboardEvent('keydown', { key: 'Escape' })));
    await vi.waitFor(() => expect(worker.terminate).toHaveBeenCalledOnce());
  });
  it('large TSV is classified in Worker before any synchronous matrix construction', async () => {
    importClipboardSnapshot(editor.view, { formats: { 'text/plain': 'A\tB\tC\tD\n'.repeat(10_000) } });
    const worker = WorkerMock.instances.at(-1)!;
    expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: 'text', inferTable: true }));
    expect(editor.state.doc.textContent).toBe('abcd');
    editor.view.someProp('handleKeyDown', handler => handler(editor.view, new KeyboardEvent('keydown', { key: 'Escape' })));
    await vi.waitFor(() => expect(worker.terminate).toHaveBeenCalledOnce());
  });
  it('large custom table MIME also crosses the Worker boundary before JSON parsing', async () => {
    importClipboardSnapshot(editor.view, { formats: { [TABLE_SELECTION_MIME]: '{"largeInvalidPayload":"' + 'x'.repeat(30_000) + '"}' } });
    const worker = WorkerMock.instances.at(-1)!;
    expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: 'table' }));
    expect(editor.state.doc.textContent).toBe('abcd');
    editor.view.someProp('handleKeyDown', handler => handler(editor.view, new KeyboardEvent('keydown', { key: 'Escape' })));
    await vi.waitFor(() => expect(worker.terminate).toHaveBeenCalledOnce());
  });
});
