import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { EditorView } from '@tiptap/pm/view';
import { TextSelection } from '@tiptap/pm/state';
import { undo, undoDepth } from '@tiptap/pm/history';
import { buildDocumentExtensions } from '@/features/editor-md/documentExtensions';
import { createAnnotationBodyView, updateAnnotationBodyView } from '@/features/editor-md/annotations/bodyView';
import { DOCUMENT_SLICE_MIME, importClipboardSnapshot } from '@/features/editor-md/clipboard/clipboardImport';
import { normalizeClipboardDocument } from '@/features/editor-md/clipboard/normalize';
import { tableViewportKey } from '@/features/editor-md/tableViewport';
import { ImageNode } from '@/features/editor-md/documentNodes';
import { useDocumentStore, type Document } from '@/stores/documentStore';
import { useWindowStore, type Tab } from '@/stores/windowStore';
import { initShortcuts, registerShortcut } from '@/core/shortcuts';

const io = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('@/core/ipc/commands', async importOriginal => ({ ...await importOriginal<typeof import('@/core/ipc/commands')>(), storeImageAsset: io.save }));
vi.mock('@/features/explorer/refreshAfterWrite', () => ({ refreshExplorerAfterWrite: async () => {} }));

class WorkerMock {
  static instances: WorkerMock[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminate = vi.fn(); postMessage = vi.fn();
  constructor() { WorkerMock.instances.push(this); }
  respond(content: JSONContent[]) { this.onmessage?.({ data: { ok: true, result: { content, nodes: 0, diagnostics: [] } } } as MessageEvent); }
}
let editor: Editor;
const docKey = 'C:\\notes\\body.nb';
let previousDocuments: ReturnType<typeof useDocumentStore.getState>, previousWindows: ReturnType<typeof useWindowStore.getState>;
const views: EditorView[] = [];
const paragraph = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const table = (count: number): JSONContent => ({ type: 'table', content: Array.from({ length: count }, (_, row) => ({
  type: 'tableRow', content: Array.from({ length: 2 }, (_, column) => ({ type: 'tableCell', content: [paragraph(`${row}:${column}`)] })),
})) });
const body = (content: JSONContent[]) => editor.schema.nodes.annotationBody.createChecked({ id: 'body' }, content.map(node => editor.schema.nodeFromJSON(node)));
function create(content = [paragraph('target')], editable = true) {
  const host = document.createElement('div'); host.dataset.editorScroll = 'true'; document.body.append(host);
  const view = createAnnotationBodyView(host, editor, body(content), editable); views.push(view); return view;
}
beforeEach(() => {
  WorkerMock.instances = []; vi.stubGlobal('Worker', WorkerMock);
  vi.spyOn(EditorView.prototype, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });
  previousDocuments = useDocumentStore.getState(); previousWindows = useWindowStore.getState();
  useDocumentStore.setState({ documents: new Map([[docKey, { key: docKey, dirPath: 'C:\\notes' } as Document]]) });
  useWindowStore.setState({ activeKey: docKey, tabs: [{ key: docKey, viewMode: 'visual' } as Tab] });
  io.save.mockReset().mockResolvedValue(`${'a'.repeat(64)}.png`);
  editor = new Editor({ extensions: buildDocumentExtensions({ image: ImageNode.configure({ docKey }) }), content: { type: 'doc', content: [paragraph('Parent document')] } });
});
afterEach(() => {
  for (const view of views.splice(0)) if (!view.isDestroyed) view.destroy();
  editor.destroy(); useDocumentStore.setState(previousDocuments, true); useWindowStore.setState(previousWindows, true);
  document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it('keeps small HTML and text paste synchronous and isolated in the draft history', () => {
  const view = create(), parent = editor.state.doc;
  view.dispatch(view.state.tr.insertText('typed ', 1)); const before = view.state.doc;
  expect(importClipboardSnapshot(view, { formats: { 'text/html': '<p><b>小段说明</b></p>', 'text/plain': '小段说明' } })).toBe(true);
  expect(WorkerMock.instances).toHaveLength(0);
  expect(view.state.doc.textContent).toContain('小段说明');
  let bold = false; view.state.doc.descendants(node => { if (node.marks.some(mark => mark.type.name === 'bold')) bold = true; });
  expect(bold).toBe(true);
  undo(view.state, view.dispatch); expect(view.state.doc.eq(before)).toBe(true);
  expect(importClipboardSnapshot(view, { formats: { 'text/plain': '<literal>' } }, true)).toBe(true);
  expect(view.state.doc.textContent).toContain('<literal>');
  undo(view.state, view.dispatch); expect(view.state.doc.eq(before)).toBe(true);
  expect(editor.state.doc).toBe(parent);
});

it('uses the shared worker and chunked import for large Office HTML and keeps table DOM bounded', async () => {
  const view = create(), parent = editor.state.doc, before = view.state.doc;
  const html = `<table>${Array.from({ length: 600 }, (_, index) => `<tr><td style="mso-number-format:'@'">${index}</td><td><b>解释 ${index}</b></td></tr>`).join('')}</table>`;
  expect(importClipboardSnapshot(view, { formats: { 'text/html': html, 'text/plain': 'Office table' } })).toBe(true);
  const worker = WorkerMock.instances.at(-1)!; expect(worker).toBeDefined();
  expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ raw: html, kind: 'html' }));
  expect(view.state.doc).toBe(before);
  const normalized = normalizeClipboardDocument(new DOMParser().parseFromString(html, 'text/html'), html.length);
  worker.respond(normalized.content);
  await vi.waitFor(() => expect(view.state.doc.textContent).toContain('解释 599'), { timeout: 5000 });
  expect(view.dom.querySelectorAll('tr')).toHaveLength(600);
  expect(view.dom.querySelectorAll('td > p').length).toBeLessThanOrEqual(74);
  expect(view.dom.querySelectorAll('.nb-row-placeholder').length).toBeGreaterThan(500);
  expect(undoDepth(view.state)).toBe(1);
  undo(view.state, view.dispatch); expect(view.state.doc.eq(before)).toBe(true);
  expect(editor.state.doc).toBe(parent);
});

it('strips recursive annotation entities and anchors from native fragments', () => {
  const view = create();
  const raw = JSON.stringify({ version: 1, openStart: 0, openEnd: 0, content: [
    { type: 'paragraph', attrs: { annotationId: 'nested' }, content: [{ type: 'text', text: 'Copied body', marks: [{ type: 'annotationReference', attrs: { id: 'nested' } }, { type: 'bold' }] }] },
    { type: 'annotationStore', content: [{ type: 'annotationBody', attrs: { id: 'nested' }, content: [paragraph('Nested explanation')] }] },
  ] });
  importClipboardSnapshot(view, { formats: { [DOCUMENT_SLICE_MIME]: raw } });
  const json = JSON.stringify(view.state.doc.toJSON());
  expect(view.state.doc.textContent).toContain('Copied body');
  expect(view.state.doc.textContent).not.toContain('Nested explanation');
  expect(json).not.toContain('annotationReference');
  expect(json).not.toContain('annotationStore');
  expect(json).not.toContain('nested');
  expect(json).toContain('bold');
});

it('maps a pending paste inside the draft and cancels it when the view is destroyed', async () => {
  const view = create();
  const snapshot = { formats: { 'text/plain': 'large text\n'.repeat(5000) } };
  importClipboardSnapshot(view, snapshot, true); const worker = WorkerMock.instances.at(-1)!;
  view.dispatch(view.state.tr.insertText('Prefix ', 1)); view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
  worker.respond([paragraph('PASTE')]);
  await vi.waitFor(() => expect(view.state.doc.textContent).toBe('Prefix PASTEtarget'));
  importClipboardSnapshot(view, snapshot, true); const pending = WorkerMock.instances.at(-1)!;
  const saved = view.state.doc; view.destroy();
  expect(pending.terminate).toHaveBeenCalledOnce();
  pending.respond([paragraph('Late result')]);
  await Promise.resolve();
  expect(view.state.doc).toBe(saved);
});

it('cancels a pending paste with Escape without changing draft content or history', async () => {
  const view = create(), before = view.state.doc;
  importClipboardSnapshot(view, { formats: { 'text/html': '<!--' + 'padding'.repeat(5000) + '--><p>large</p>' } });
  const worker = WorkerMock.instances.at(-1)!;
  expect(view.someProp('handleKeyDown', handler => handler(view, new KeyboardEvent('keydown', { key: 'Escape' })))).toBe(true);
  await vi.waitFor(() => expect(worker.terminate).toHaveBeenCalledOnce());
  expect(view.state.doc).toBe(before); expect(undoDepth(view.state)).toBe(0);
});

it('virtualizes read panels and preserves table viewport support after parent body updates', () => {
  const view = create([table(1000)], false);
  expect(view.dom.querySelectorAll('tr')).toHaveLength(1000);
  expect(view.dom.querySelectorAll('td > p')).toHaveLength(72);
  const rows: number[] = []; view.state.doc.firstChild!.forEach((_node, offset) => rows.push(offset + 1));
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, rows[700] + 4)));
  expect(view.nodeDOM(rows[700])?.textContent).toBe('700:0700:1');
  expect(view.dom.querySelectorAll('td > p').length).toBeLessThanOrEqual(74);
  updateAnnotationBodyView(view, body([table(120)]));
  expect(tableViewportKey.getState(view.state)?.rows.size).toBe(120);
  expect(view.dom.querySelectorAll('td > p')).toHaveLength(72);
  expect(view.state.doc.firstChild?.childCount).toBe(120);
});

it('keeps a real Ctrl+Z/redo key event in the draft despite a global history capture listener', () => {
  const view = create(), parent = editor.state.doc, initial = view.state.doc;
  const globalUndo = vi.fn(() => editor.commands.undo());
  const unregister = registerShortcut({ key: 'Ctrl+Z', scope: 'global', description: 'Undo fixture', action: globalUndo });
  const detach = initShortcuts();
  try {
    view.dispatch(view.state.tr.insertText('draft ', 1)); view.focus();
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(view.state.doc.eq(initial)).toBe(true);
    expect(globalUndo).not.toHaveBeenCalled(); expect(editor.state.doc).toBe(parent);
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    expect(view.state.doc.textContent).toBe('draft target');
  } finally { detach(); unregister(); }
});

function delayedBytes() {
  let resolve!: (value: ArrayBuffer) => void;
  const promise = new Promise<ArrayBuffer>(done => { resolve = done; });
  return { promise, resolve };
}
const imageFile = (name: string, bytes: Promise<ArrayBuffer>) => ({ name, type: 'image/png', size: 4, arrayBuffer: () => bytes } as File);
function imageSources(view: EditorView) {
  const sources: string[] = []; view.state.doc.descendants(node => { if (node.type.name === 'image') sources.push(node.attrs.src); }); return sources;
}

it('saves plain clipboard images with the parent document identity and inserts one mapped draft operation', async () => {
  const view = create(), parent = editor.state.doc, bytes = delayedBytes();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)));
  expect(importClipboardSnapshot(view, { formats: {}, files: [imageFile('first.png', bytes.promise), imageFile('second.png', Promise.resolve(new ArrayBuffer(4)))] })).toBe(true);
  view.dispatch(view.state.tr.insertText('X', 1)); view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
  const beforePaste = view.state.doc; bytes.resolve(new ArrayBuffer(4));
  await vi.waitFor(() => expect(imageSources(view)).toHaveLength(2));
  expect(io.save).toHaveBeenCalledTimes(2);
  for (const [path, extension, data] of io.save.mock.calls) { expect(path).toMatch(/^C:[\\/]notes[\\/]/); expect(extension).toBe('png'); expect(data).toBeInstanceOf(Uint8Array); }
  expect(imageSources(view).every(src => src.startsWith('./'))).toBe(true);
  expect(view.state.doc.firstChild?.textContent).toBe('Xta');
  expect(editor.state.doc).toBe(parent);
  undo(view.state, view.dispatch); expect(view.state.doc.eq(beforePaste)).toBe(true);
});

it('does not save or insert clipboard image bytes after the body view unmounts', async () => {
  const view = create(), bytes = delayedBytes();
  importClipboardSnapshot(view, { formats: {}, files: [imageFile('pending.png', bytes.promise)] });
  const before = view.state.doc; view.destroy(); bytes.resolve(new ArrayBuffer(4));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(io.save).not.toHaveBeenCalled(); expect(view.state.doc).toBe(before);
});
