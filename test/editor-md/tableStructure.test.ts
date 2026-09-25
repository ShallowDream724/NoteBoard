import { afterEach, describe, expect, it } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { Slice } from '@tiptap/pm/model';
import { buildDocumentExtensions } from '@/features/editor-md/documentExtensions';
import { tableAxisRange, reorderedTable, moveTableAxis, insertTablePart } from '@/features/editor-md/tableStructure';
import { writeTableClipboard, handleTablePaste } from '@/features/editor-md/tableClipboard';
import { runDiscreteEdit } from '@/features/editor-md/discreteEdit';
import { distributeTableRows } from '@/features/editor-md/tablePresentationCommands';
import { nativeTestEditor } from './nativeTestEditor';

const editors: Editor[] = [];
const cell = (text: string, attrs = {}): JSONContent => ({ type: 'tableCell', attrs, content: [{ type: 'paragraph', content: [{ type: 'text', text, marks: [{ type: 'textColor', attrs: { color: '#e53935' } }] }] }] });
const row = (content: JSONContent[], height = 60): JSONContent => ({ type: 'tableRow', attrs: { height }, content });
const table = (): JSONContent => ({ type: 'table', content: [row([cell('A', { background: '#fff2cc', colwidth: [100] }), cell('B', { colwidth: [200] })], 90), row([cell('C', { colwidth: [100] }), cell('D', { colwidth: [200] })]), row([cell('E', { colwidth: [100] }), cell('F', { colwidth: [200] })])] });
function create(content: JSONContent = table()) { const editor = new Editor({ extensions: buildDocumentExtensions(), content: { type: 'doc', content: [content, { type: 'paragraph' }] } }); editors.push(editor); return nativeTestEditor(editor); }
function selectRow(editor: Editor, index: number) {
  const map = TableMap.get(editor.state.doc.firstChild!);
  const at = (column: number) => editor.state.doc.resolve(1 + map.map[index * map.width + column]);
  editor.view.dispatch(editor.state.tr.setSelection(CellSelection.rowSelection(at(0), at(map.width - 1))));
}
function clipboard() {
  const data = new Map<string, string>();
  return { preventDefault() {}, clipboardData: { setData: (type: string, value: string) => data.set(type, value), getData: (type: string) => data.get(type) ?? '' } } as unknown as ClipboardEvent;
}
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()));
describe('Table structural transactions', () => {
  it('reorders rows and columns with styles, widths and row heights and undoes each move', () => {
    const editor = create(), before = editor.state.doc.toJSON(), original = editor.state.doc.firstChild!;
    expect(moveTableAxis(editor.view, 0, original, 'row', 0, 3)).toBe(true);
    const moved = editor.state.doc.firstChild!;
    expect(moved.textContent).toBe('CDEFAB');
    expect(moved.lastChild?.attrs.height).toBe(90);
    expect(moved.lastChild?.firstChild?.attrs.background).toBe('#fff2cc');
    expect(moved.lastChild?.firstChild?.firstChild?.firstChild?.marks[0].attrs.color).toBe('#e53935');
    expect(moveTableAxis(editor.view, 0, moved, 'column', 0, 2)).toBe(true);
    expect(editor.state.doc.firstChild?.textContent).toBe('DCFEBA');
    editor.commands.undo(); expect(editor.state.doc.firstChild!.eq(moved)).toBe(true);
    editor.commands.undo(); expect(editor.state.doc.toJSON()).toEqual(before);
  });
  it('moves entire merged groups and never cuts through a merged target', () => {
    const editor = create({ type: 'table', content: [
      row([cell('merged', { rowspan: 2 }), cell('B')]), row([cell('D')]), row([cell('E'), cell('F')]),
    ] });
    const source = editor.state.doc.firstChild!;
    expect(tableAxisRange(source, 'row', 1)).toEqual({ from: 0, to: 2 });
    const moved = reorderedTable(source, 'row', 1, 3)!;
    expect(moved.table.textContent).toBe('EFmergedBD');
    expect(TableMap.get(moved.table).problems).toBeNull();
    expect(moved.table.child(1).firstChild!.attrs.rowspan).toBe(2);
    expect(reorderedTable(source, 'row', 0, 1)).toBeNull();
  });
  it('cut row → insert before another row → undo paste → undo cut restores every cell', () => {
    const editor = create(), before = editor.state.doc.toJSON(), event = clipboard();
    selectRow(editor, 0);
    expect(writeTableClipboard(editor.view, event, true)).toBe(true);
    expect(editor.state.doc.firstChild!.textContent).toBe('CDEF');
    selectRow(editor, 1);
    expect(handleTablePaste(editor.view, event, Slice.empty)).toBe(true);
    expect(editor.state.doc.firstChild!.textContent).toBe('CDABEF');
    editor.commands.undo(); expect(editor.state.doc.firstChild!.textContent).toBe('CDEF');
    editor.commands.undo(); expect(editor.state.doc.toJSON()).toEqual(before);
  });
  it('pastes a cut row as its own table into a blank paragraph and keeps undo', () => {
    const editor = create(), event = clipboard();
    selectRow(editor, 0); writeTableClipboard(editor.view, event, true);
    const cut = editor.state.doc.toJSON();
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    expect(handleTablePaste(editor.view, event, Slice.empty)).toBe(true);
    let tables = 0; editor.state.doc.forEach(node => { if (node.type.name === 'table') tables++; });
    expect(tables).toBe(2);
    editor.commands.undo(); expect(editor.state.doc.toJSON()).toEqual(cut);
  });
  it('merge and split form two independent undo steps', () => {
    const editor = create(); selectRow(editor, 1);
    const before = editor.state.doc.toJSON();
    runDiscreteEdit(editor, chain => chain.mergeCells());
    const merged = editor.state.doc.toJSON();
    runDiscreteEdit(editor, chain => chain.splitCell());
    editor.commands.undo(); expect(editor.state.doc.toJSON()).toEqual(merged);
    editor.commands.undo(); expect(editor.state.doc.toJSON()).toEqual(before);
  });
  it('inserts a wider source without dropping destination or source cells', () => {
    const editor = create(), schema = editor.schema;
    const source = schema.nodeFromJSON({ type: 'table', content: [row([cell('X'), cell('Y'), cell('Z')])] });
    const result = insertTablePart(editor.state.doc.firstChild!, source, 'row', 1);
    expect(result.textContent).toBe('ABXYZCDEF');
    expect(TableMap.get(result).width).toBe(3);
    expect(TableMap.get(result).problems).toBeNull();
  });
  it('distributes selected rows in one undoable step without changing cells or selection', () => {
    const editor = create(), before = editor.state.doc.toJSON();
    const dom = editor.view.nodeDOM(0) as HTMLElement;
    const rendered = dom instanceof HTMLTableElement ? dom : dom.querySelector('table')!;
    Array.from(rendered.rows).forEach((row, index) => Object.defineProperty(row, 'offsetHeight', { value: [90, 60, 60][index] }));
    const map = TableMap.get(editor.state.doc.firstChild!);
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.rowSelection(
      editor.state.doc.resolve(1 + map.map[0]), editor.state.doc.resolve(1 + map.map[3]),
    )));
    const selection = editor.state.selection.toJSON(), steps: number[] = [];
    editor.on('transaction', ({ transaction }) => { if (transaction.docChanged) steps.push(transaction.steps.length); });
    expect(distributeTableRows(editor)).toBe(true);
    expect(editor.state.doc.firstChild!.child(0).attrs.height).toBe(75);
    expect(editor.state.doc.firstChild!.child(1).attrs.height).toBe(75);
    expect(editor.state.doc.firstChild!.child(2).attrs.height).toBe(60);
    expect(editor.state.selection.toJSON()).toEqual(selection);
    expect(steps).toEqual([1]);
    editor.commands.undo(); expect(editor.state.doc.toJSON()).toEqual(before);
  });
});
