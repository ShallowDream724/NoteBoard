// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { DocumentCapabilityGuard, transactionAddedCapability } from '../../src/features/document-format/capabilityGuard';
import { initializeEditorDocument, serializeNativeNode } from '../../src/features/editor-md/editorDocumentCodec';
import { setTextColor, setHighlightColor, setParagraphPresentation } from '../../src/features/document-style/documentStyles';
import { runWithDocumentCapability, ensureDocumentCapability } from '../../src/features/document-format/featureGate';
import { registerMdTipTapEditor } from '../../src/features/editor-md/editorInstances';
import { useSettingsStore } from '../../src/stores/settingsStore';
import { formatSupportsCapability, capabilityVisible } from '../../src/features/document-format/capabilities';

const requests = vi.hoisted(() => ({ confirm: vi.fn(), convert: vi.fn() }));
vi.mock('../../src/features/document-format/NativeConversionDialog', () => ({ requestNativeConversion: requests.confirm }));
vi.mock('../../src/features/document-format/convertDocument', () => ({ convertMarkdownToNative: requests.convert }));
const editors: Editor[] = [];
const cleanup: Array<() => void> = [];
function make(format: 'markdown' | 'noteboard' = 'markdown', key?: string, content = '<p>hello world</p>') {
  const editor = new Editor({ extensions: [...buildDocumentExtensions(), DocumentCapabilityGuard], content });
  initializeEditorDocument(editor, format === 'noteboard' ? serializeNativeNode(editor.state.doc) : 'hello world', format, '', key);
  editors.push(editor); return editor;
}
afterEach(() => {
  cleanup.splice(0).forEach(dispose => dispose()); editors.splice(0).forEach(editor => editor.destroy());
  requests.confirm.mockReset(); requests.convert.mockReset();
  useSettingsStore.setState(state => ({ settings: { ...state.settings, editor: { ...state.settings.editor, pureMarkdown: false } } }));
});
describe('document format capabilities', () => {
  it('retains ordinary Markdown and hides only native capabilities for the preference', () => {
    expect(formatSupportsCapability('markdown', 'table')).toBe(true);
    expect(capabilityVisible('image', true)).toBe(true);
    expect(capabilityVisible('gallery', true)).toBe(false);
    expect(formatSupportsCapability('noteboard', 'annotation')).toBe(true);
  });
  it('blocks unowned MD style commands without modifying content, but allows NB', () => {
    const md = make(), native = make('noteboard');
    for (const editor of [md, native]) editor.commands.setTextSelection({ from: 1, to: 6 });
    const before = md.state.doc;
    expect(setTextColor(md, '#2563eb')).toBe(false);
    expect(setHighlightColor(md, '#fef08a')).toBe(false);
    expect(setParagraphPresentation(md, { textAlign: 'center' })).toBe(false);
    expect(md.state.doc.eq(before)).toBe(true);
    expect(setTextColor(native, '#2563eb')).toBe(true);
    expect(native.getAttributes('textColor').color).toBe('#2563eb');
  });
  it('blocks direct highlight, image layout and merged-cell transactions', async () => {
    const editor = make(); editor.commands.setTextSelection({ from: 1, to: 6 });
    const before = editor.state.doc;
    editor.commands.setHighlight({ color: '#fef08a' }); expect(editor.state.doc.eq(before)).toBe(true);
    editor.commands.insertContent({ type: 'image', attrs: { src: 'image.png' } });
    expect(editor.state.doc.textContent).toContain('world');
    const withImage = editor.state.doc;
    let imagePos = -1; withImage.descendants((node, pos) => { if (node.type.name === 'image') imagePos = pos; });
    expect(imagePos).toBeGreaterThanOrEqual(0);
    editor.view.dispatch(editor.state.tr.setNodeAttribute(imagePos, 'width', '50%'));
    expect(editor.state.doc.eq(withImage)).toBe(true);
    const table = make('markdown', undefined, '<table><tr><th>A</th><th>B</th></tr><tr><td>C</td><td>D</td></tr></table>');
    const cells: number[] = []; table.state.doc.descendants((node, pos) => { if (node.type.name === 'tableCell') cells.push(pos); });
    table.view.dispatch(table.state.tr.setSelection(CellSelection.create(table.state.doc, cells[0], cells[1])));
    const tableBefore = table.state.doc;
    table.commands.mergeCells(); expect(table.state.doc.eq(tableBefore)).toBe(true);
    await Promise.resolve(); expect(requests.confirm).not.toHaveBeenCalled();
  });
  it('rejects a direct highlight shortcut at an empty caret before storing a rich typing mark', async () => {
    const editor = make(); editor.commands.setTextSelection(3);
    editor.commands.toggleHighlight({ color: '#fef08a' });
    expect(editor.state.storedMarks?.some(mark => mark.type.name === 'highlight') ?? false).toBe(false);
    editor.commands.insertContent('x');
    expect(editor.state.doc.textContent).toBe('hexllo world');
    await Promise.resolve(); expect(requests.confirm).not.toHaveBeenCalled();
  });
  it('allows typing, basic formatting, default images and ordinary table operations', () => {
    const editor = make();
    editor.commands.insertContent('plain');
    editor.commands.setTextSelection({ from: 1, to: 5 }); editor.commands.toggleBold();
    expect(editor.isActive('bold')).toBe(true);
    const tr = editor.state.tr.insertText('x', 2);
    expect(transactionAddedCapability(tr)).toBeNull();
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
    expect(editor.isActive('table')).toBe(true);
    editor.commands.addRowAfter(); editor.commands.addColumnAfter();
    const tables: number[] = []; editor.state.doc.descendants(node => { if (node.type.name === 'table') tables.push(node.childCount); });
    expect(tables).toEqual([3]);
  });
  it('keeps inherited HTML formatting and history replacement editable', () => {
    const editor = make('markdown', undefined, '<p><span data-text-color="#2563eb">hello</span></p>');
    expect(transactionAddedCapability(editor.state.tr.insertText('x', 3))).toBeNull();
    editor.view.dispatch(editor.state.tr.insertText('x', 3));
    expect(editor.state.doc.textContent).toBe('hexllo');
    editor.view.dispatch(editor.state.tr.addMark(1, 3, editor.schema.marks.highlight.create({ color: '#fef08a' })).setMeta('noteboard-document-replacement', 'history'));
    expect(editor.state.doc.firstChild?.firstChild?.marks.some(mark => mark.type.name === 'highlight')).toBe(true);
  });
  it('cancels conversion without changing the document or selection', async () => {
    const editor = make('markdown', 'C:/note.md'); editor.commands.setTextSelection({ from: 2, to: 6 });
    const before = editor.state.doc, selection = editor.state.selection;
    requests.confirm.mockResolvedValue(null);
    expect(await ensureDocumentCapability(editor, 'textColor')).toBeNull();
    expect(editor.state.doc.eq(before)).toBe(true); expect(editor.state.selection.eq(selection)).toBe(true);
    expect(requests.convert).not.toHaveBeenCalled();
  });
  it('waits for registered NB, restores selection and applies the original action once', async () => {
    const editor = make('markdown', 'C:/note.md'), native = make('noteboard', 'C:/note.nb');
    editor.commands.setTextSelection({ from: 2, to: 6 });
    requests.confirm.mockResolvedValue({ removeMarkdown: false });
    requests.convert.mockResolvedValue('C:/note.nb');
    const action = vi.fn((next: Editor) => setTextColor(next, '#2563eb'));
    expect(runWithDocumentCapability(editor, 'textColor', action)).toBe(false);
    runWithDocumentCapability(editor, 'textColor', action);
    await vi.waitFor(() => expect(requests.convert).toHaveBeenCalledWith('C:/note.md', { removeMarkdown: false }));
    cleanup.push(registerMdTipTapEditor('C:/note.nb', native));
    await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(native.state.selection.from).toBe(2); expect(native.state.selection.to).toBe(6);
    expect(native.getAttributes('textColor').color).toBe('#2563eb');
    expect(editor.getAttributes('textColor').color).toBeUndefined();
  });
  it('does not execute the action if the source changes while confirmation is open', async () => {
    const editor = make('markdown', 'C:/note.md');
    let finish!: (value: { removeMarkdown: boolean }) => void;
    requests.confirm.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const result = ensureDocumentCapability(editor, 'gallery');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    editor.commands.insertContent('new'); finish({ removeMarkdown: false });
    expect(await result).toBeNull(); expect(requests.convert).not.toHaveBeenCalled();
  });
});
