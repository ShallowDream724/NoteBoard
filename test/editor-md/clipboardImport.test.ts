import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor, getSchema } from '@tiptap/core';
import { DOMParser as WorkerDOMParser } from 'linkedom';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { normalizeClipboardDocument, normalizeClipboardText, safeClipboardUrl, CLIPBOARD_LIMITS } from '../../src/features/editor-md/clipboard/normalize';
import { ClipboardImport, chooseClipboardFormat, DOCUMENT_SLICE_MIME, TABLE_SELECTION_MIME, materializeClipboard, writeDocumentClipboard } from '../../src/features/editor-md/clipboard/clipboardImport';
import { insertVisualImages } from '../../src/features/editor-md/imageInsertionLease';
import { writeTableClipboard, handleTablePaste } from '../../src/features/editor-md/tableClipboard';
import { CellSelection } from '@tiptap/pm/tables';

vi.mock('../../src/features/editor-md/imagePaste', () => ({ handlePastedImageFiles: vi.fn() }));
const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); });
function normalize(html: string) { return normalizeClipboardDocument(new DOMParser().parseFromString(html, 'text/html'), html.length); }
function create(content = '<p>target</p>') { const editor = new Editor({ extensions: [...buildDocumentExtensions(), ClipboardImport.configure({ docKey: 'test.nb' })], content }); editors.push(editor); return editor; }
function clipboard(values: Record<string, string>): ClipboardEvent {
  return { clipboardData: { types: Object.keys(values), getData: (name: string) => values[name] ?? '', setData: (name: string, value: string) => { values[name] = value; } }, preventDefault: vi.fn() } as unknown as ClipboardEvent;
}
function paste(editor: Editor, event: ClipboardEvent) { return editor.view.someProp('handleDOMEvents', handlers => handlers.paste?.(editor.view, event)); }

describe('bounded rich clipboard import', () => {
  it('selects structured/table/HTML before a redundant PNG and explicitly bypasses all with plain paste', () => {
    expect(chooseClipboardFormat(['text/html', 'image/png'])).toBe('html');
    expect(chooseClipboardFormat([DOCUMENT_SLICE_MIME, 'text/html'])).toBe('document');
    expect(chooseClipboardFormat([TABLE_SELECTION_MIME, DOCUMENT_SLICE_MIME, 'text/html'])).toBe('table');
    expect(chooseClipboardFormat([TABLE_SELECTION_MIME, 'text/html', 'image/png'], true)).toBe('text');
  });
  it('maps Office class styles, Chinese/English lists, colors, and links to semantic data', () => {
    const html = `<style>p.MsoNormal {color:rgb(10, 20, 30);text-align:center}.word{font-weight:bold;background-color:#ff0}</style>
      <p class="MsoNormal">中文 <span class="word">Bold</span> <a href="https://example.com">Link</a></p>
      <p style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">1. </span>First</p>
      <p style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">2. </span>第二项</p>`;
    const result = normalize(html), schema = getSchema(buildDocumentExtensions());
    expect(result.content[0].attrs?.textAlign).toBe('center');
    expect(result.content[0].content?.find(node => node.text === 'Bold')?.marks).toEqual(expect.arrayContaining([{ type: 'bold' }, { type: 'highlight', attrs: { color: '#ffff00' } }, { type: 'textColor', attrs: { color: '#0a141e' } }]));
    expect(result.content[1].type).toBe('orderedList');
    const doc = schema.nodeFromJSON({ type: 'doc', content: result.content }); doc.check();
    expect(doc.textContent).toContain('First第二项'); expect(doc.textContent).not.toContain('1.');
  });
  it('preserves Excel merged cells, blank cells, line breaks, background and alignment', async () => {
    const html = '<table><tr><td rowspan="2" style="background:#c00;text-align:right">A<br>B</td><td></td></tr><tr><td>  中文&nbsp;值 </td></tr></table>';
    const result = normalize(html), nodes = await materializeClipboard(result.content, getSchema(buildDocumentExtensions()));
    expect(nodes[0].child(0).child(0).attrs).toMatchObject({ rowspan: 2, background: '#cc0000' });
    expect(nodes[0].child(0).child(0).firstChild?.attrs.textAlign).toBe('right');
    expect(nodes[0].child(0).child(0).firstChild?.child(1).type.name).toBe('hardBreak');
    expect(nodes[0].child(0).child(1).textContent).toBe('');
    const merged = await materializeClipboard(normalize('<table><tr><td rowspan="2">merged</td></tr><tr></tr></table>').content, getSchema(buildDocumentExtensions()));
    expect(merged[0].childCount).toBe(2);
  });
  it('has equivalent browser and worker parsing for fragment input without an html wrapper', () => {
    const html = '<p><strong>你好</strong></p><table><tr><td>Excel</td></tr></table>';
    const workerDoc = new WorkerDOMParser().parseFromString(`<html><body>${html}</body></html>`, 'text/html') as unknown as Document;
    expect(normalizeClipboardDocument(workerDoc, html.length).content).toEqual(normalize(html).content);
  });
  it('strips active content and records unreadable image source without admitting unsafe URLs', () => {
    const result = normalize('<script>alert(1)</script><p onclick="x()">Keep<img src="file:///C:/secret.png" alt="chart"></p><a href="javascript:alert(1)">label</a>');
    expect(JSON.stringify(result.content)).toContain('chart');
    expect(JSON.stringify(result.content)).not.toContain('onclick');
    expect(JSON.stringify(result.content)).not.toContain('javascript:');
    expect(result.diagnostics).toHaveLength(1);
    expect(safeClipboardUrl('data:text/html,abc', true)).toBeNull();
  });
  it('retains rich HTML even when clipboard provides image/png and makes one undo operation', () => {
    const editor = create(); editor.commands.selectAll();
    paste(editor, clipboard({ 'text/html': '<p><strong>rich text</strong></p>', 'image/png': 'present', 'text/plain': 'rich text' }));
    expect(editor.state.doc.textContent).toBe('rich text'); expect(editor.state.doc.firstChild?.firstChild?.marks[0].type.name).toBe('bold');
    editor.commands.undo(); expect(editor.state.doc.textContent).toBe('target');
    editor.commands.redo(); expect(editor.state.doc.textContent).toBe('rich text');
  });
  it('Ctrl+Shift+V inserts plain text while retaining line breaks and bypassing table MIME', () => {
    const editor = create(); editor.commands.selectAll();
    editor.view.someProp('handleKeyDown', handler => handler(editor.view, new KeyboardEvent('keydown', { key: 'V', ctrlKey: true, shiftKey: true })));
    paste(editor, clipboard({ [TABLE_SELECTION_MIME]: '{}', 'text/html': '<p><b>rich</b></p>', 'text/plain': 'plain\nsecond' }));
    expect(editor.state.doc.textContent).toBe('plainsecond'); expect(editor.state.doc.childCount).toBe(2);
    expect(editor.state.doc.firstChild?.firstChild?.marks).toEqual([]);
  });
  it('leaves internal row/column table MIME to existing table semantics', () => {
    const editor = create(), event = clipboard({ [TABLE_SELECTION_MIME]: '{}', 'text/html': '<table><tr><td>x</td></tr></table>' });
    expect(paste(editor, event)).toBeFalsy(); expect(event.preventDefault).not.toHaveBeenCalled();
  });
  it('round-trips native node attrs and remaps annotation references with their body atomically', () => {
    const editor = create();
    if (!editor.schema.nodes.annotationStore) throw new Error('annotation schema missing');
    editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'anchor', marks: [{ type: 'annotationReference', attrs: { id: 'original' } }] }] }, { type: 'annotationStore', content: [{ type: 'annotationBody', attrs: { id: 'original' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'body text' }] }] }] }] });
    editor.commands.setTextSelection({ from: 1, to: 7 }); const values: Record<string, string> = {};
    expect(writeDocumentClipboard(editor.view, clipboard(values), false)).toBe(true);
    const target = create(); target.commands.selectAll(); paste(target, clipboard(values));
    let anchorId: string | undefined; target.state.doc.forEach(node => { if (node.type.name === 'paragraph') anchorId = node.firstChild?.marks[0]?.attrs.id; });
    let store: import('@tiptap/pm/model').Node | undefined; target.state.doc.forEach(node => { if (node.type.name === 'annotationStore') store = node; });
    expect(anchorId).not.toBe('original'); expect(store?.firstChild?.attrs.id).toBe(anchorId);
    expect(store?.textContent).toBe('body text');
    target.commands.undo(); expect(target.state.doc.textContent).toBe('target');
  });
  it('fills raw empty image-slot targets in order, appends capacity, preserves caption and undoes as a unit', () => {
    const editor = create();
    editor.commands.setContent({ type: 'doc', content: [{ type: 'imageCollection', attrs: { layout: 'grid', columns: 2 }, content: [{ type: 'imageSlot', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'caption' }] }] }, { type: 'imageSlot' }] }] });
    insertVisualImages(editor, [{ src: './a.png', alt: 'a' }, { src: './b.png', alt: 'b' }, { src: './c.png', alt: 'c' }], editor.state.selection, 2);
    const collection = editor.state.doc.firstChild!;
    expect(collection.childCount).toBe(3); expect(collection.child(0).firstChild?.attrs.src).toBe('./a.png'); expect(collection.child(0).lastChild?.textContent).toBe('caption'); expect(collection.child(2).firstChild?.attrs.src).toBe('./c.png');
    editor.commands.undo(); expect(editor.state.doc.firstChild?.childCount).toBe(2); expect(editor.state.doc.firstChild?.firstChild?.firstChild?.type.name).toBe('paragraph');
  });
  it('table row paste remaps copied annotation bodies and preserves row insertion with one undo', () => {
    const source = create('<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>');
    source.commands.setContent({ type: 'doc', content: [...source.getJSON().content!, { type: 'annotationStore', content: [{ type: 'annotationBody', attrs: { id: 'cell_note' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'cell explanation' }] }] }] }] });
    source.view.dispatch(source.state.tr.addMark(4, 5, source.schema.marks.annotationReference.create({ id: 'cell_note' })));
    source.view.dispatch(source.state.tr.setSelection(CellSelection.rowSelection(source.state.doc.resolve(2))));
    const values: Record<string, string> = {}; const event = clipboard(values);
    expect(writeTableClipboard(source.view, event, false)).toBe(true);
    const target = create('<table><tr><td>X</td><td>Y</td></tr></table>'); target.commands.setTextSelection(4);
    expect(handleTablePaste(target.view, clipboard(values), source.state.selection.content())).toBe(true);
    let table: import('@tiptap/pm/model').Node | undefined, store: import('@tiptap/pm/model').Node | undefined;
    target.state.doc.forEach(node => { if (node.type.name === 'table') table = node; if (node.type.name === 'annotationStore') store = node; });
    expect(table?.childCount).toBe(2); const reference = table?.firstChild?.firstChild?.firstChild?.firstChild?.marks[0]?.attrs.id;
    expect(reference).toBeTruthy(); expect(reference).not.toBe('cell_note'); expect(store?.firstChild?.attrs.id).toBe(reference);
    target.commands.undo(); expect(target.state.doc.textContent).toBe('XY');
  });
  it('bounds pathological depth and allows a normal 10,000-row spreadsheet', () => {
    expect(() => normalize('<div>'.repeat(CLIPBOARD_LIMITS.depth + 2) + 'deep' + '</div>'.repeat(CLIPBOARD_LIMITS.depth + 2))).toThrow(/嵌套/);
    const html = '<table>' + '<tr><td>row</td><td>value</td></tr>'.repeat(10_000) + '</table>';
    expect(normalize(html).content[0].content).toHaveLength(10_000);
    expect(() => normalize('<table>' + '<tr><td colspan="100">wide</td></tr>'.repeat(1001) + '</table>')).toThrow(/网格过大/);
    expect(normalizeClipboardText('A\tB\tC\tD\n'.repeat(10_000), true).content[0].content).toHaveLength(10_000);
    expect(normalizeClipboardText('const x =\t1;\nconst y =\t2;', true).content[0].type).toBe('paragraph');
    expect(normalizeClipboardText('A\tB\nC\tD', false).content[0].type).toBe('paragraph');
  });
});
