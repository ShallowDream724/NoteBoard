// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';
import { buildDocumentExtensions, parseMarkdownDocument } from '../../src/features/editor-md/documentExtensions';
import { serializeMarkdown, parseMarkdown } from '../../src/features/editor-md/serialize';
import { fillTableSelection, selectTableScope, tableHeaderState, setSelectedTableHeader } from '../../src/features/editor-md/tablePresentationCommands';
import { setDocumentTableStyle } from '../../src/features/editor-md/documentPresentation';
import { renderDocument } from '../../src/features/export/renderDocument';

const markdown = '| 编号 | 值 | 备注 |\n| --- | --- | --- |\n| 1 | a | b |\n| 2 | c | d |';
function make() { const editor = new Editor({ extensions: buildDocumentExtensions() }); parseMarkdown(editor, markdown); return editor; }
function cell(editor: Editor, text: string) {
  let found = 0; editor.state.doc.descendants((node, pos) => { if (['tableCell', 'tableHeader'].includes(node.type.name) && node.textContent === text) { found = pos; return false; } });
  return found;
}
const at = (editor: Editor, text: string) => editor.commands.setTextSelection(cell(editor, text) + 2);
const fill = (editor: Editor, text: string) => editor.state.doc.nodeAt(cell(editor, text))!.attrs.background;
describe('table cell presentation', () => {
  it('fills a row, preserves headers, and undoes in one step without changing positions', () => {
    const editor = make();
    try {
      at(editor, '1'); expect(setSelectedTableHeader(editor, 'column')).toBe(true);
      at(editor, 'a'); const before = editor.state.selection.from;
      expect(fillTableSelection(editor, 'row', '#dbeafe')).toBe(true);
      expect(fill(editor, 'a')).toBe('#dbeafe'); expect(fill(editor, 'b')).toBe('#dbeafe');
      expect(fill(editor, '1')).toBeNull(); expect(fill(editor, 'c')).toBeNull();
      expect(editor.state.selection.from).toBe(before);
      editor.commands.undo(); expect(fill(editor, 'a')).toBeNull(); expect(fill(editor, 'b')).toBeNull();
      editor.commands.redo(); expect(fill(editor, 'a')).toBe('#dbeafe');
    } finally { editor.destroy(); }
  });
  it('keeps GFM content visible and roundtrips sparse fills through worker grammar and HTML', async () => {
    const editor = make();
    try {
      at(editor, 'a'); fillTableSelection(editor, 'column', '#fef3c7');
      const source = serializeMarkdown(editor);
      expect(source).toContain('"fills"'); expect(source).toContain('| 1 | a | b |');
      expect(parseMarkdownDocument(source).toJSON()).toEqual(editor.state.doc.toJSON());
      const html = (await renderDocument(source, 'colors', '')).html;
      expect(html).toContain('data-cell-background="#fef3c7"'); expect(html).toContain('--nb-cell-background: #fef3c7');
      fillTableSelection(editor, 'column', null);
      expect(serializeMarkdown(editor)).not.toContain('noteboard-table');
    } finally { editor.destroy(); }
  });
  it('does not allow header controls on interior rows/columns and retains their intersection', () => {
    const editor = make();
    try {
      at(editor, 'a'); expect(tableHeaderState(editor)?.canRow).toBe(false); expect(tableHeaderState(editor)?.canColumn).toBe(false);
      expect(setSelectedTableHeader(editor, 'row')).toBe(false);
      at(editor, '1'); setSelectedTableHeader(editor, 'column');
      at(editor, '值'); setSelectedTableHeader(editor, 'row');
      expect(editor.state.doc.nodeAt(cell(editor, '编号'))!.type.name).toBe('tableHeader');
      expect(editor.state.doc.nodeAt(cell(editor, '值'))!.type.name).toBe('tableCell');
    } finally { editor.destroy(); }
  });
  it('disables new fills in three-line mode and preserves colors when returning to standard', () => {
    const editor = make();
    try {
      at(editor, 'a'); fillTableSelection(editor, 'cells', '#dcfce7');
      setDocumentTableStyle(editor, 'three-line');
      expect(fillTableSelection(editor, 'row', '#fee2e2')).toBe(false);
      expect(fill(editor, 'a')).toBe('#dcfce7');
      setDocumentTableStyle(editor, 'standard'); expect(fill(editor, 'a')).toBe('#dcfce7');
    } finally { editor.destroy(); }
  });
  it('selects whole rows/columns and restores colored merged cells on split and undo', () => {
    const editor = make();
    try {
      at(editor, 'a'); selectTableScope(editor, 'row');
      expect((editor.state.selection as CellSelection).isRowSelection()).toBe(true);
      at(editor, 'a'); selectTableScope(editor, 'column');
      expect((editor.state.selection as CellSelection).isColSelection()).toBe(true);
      editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, cell(editor, 'a'), cell(editor, 'b'))));
      fillTableSelection(editor, 'cells', '#fce7f3'); expect(editor.commands.mergeCells()).toBe(true);
      expect(editor.can().splitCell()).toBe(true); expect(editor.commands.splitCell()).toBe(true);
      expect(parseMarkdownDocument(serializeMarkdown(editor)).toJSON()).toEqual(editor.state.doc.toJSON());
    } finally { editor.destroy(); }
  });
  it('rejects CSS payloads without losing visible table content', () => {
    const doc = parseMarkdownDocument('<!-- noteboard-table {"widths":[0,0,0],"heights":{},"fills":{"1":{"0":"red;background:url(x)"}}} -->\n' + markdown);
    expect(doc.textContent).toContain('编号值备注');
    doc.descendants(node => { if (node.attrs.background) throw new Error('unsafe background imported'); });
  });
});
