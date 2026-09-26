// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { clearBlockTextFormatting, clearCaptionTextFormatting, clearSelectionTextFormatting, supportsBlockTextFormatting } from '../../src/features/editor-md/textFormatting';
import { toggleSelectedCellMark } from '../../src/features/document-style/cellTextStyle';
import { transactionStart } from '../../src/features/editor-md/transactionStart';
import { nativeTestEditor } from './nativeTestEditor';

function create(content: string) { return nativeTestEditor(new Editor({ extensions: buildDocumentExtensions(), content })); }
const table = '<table data-table-align="right"><tr><th><p><b>A</b></p></th><th><p><b>B</b></p></th><th><p><b>C</b></p></th></tr><tr><td><p><b>D</b></p></td><td><p><b>E</b></p></td><td><p><b>F</b></p></td></tr><tr><td><p><b>G</b></p></td><td><p><b>H</b></p></td><td><p><b>I</b></p></td></tr></table>';
describe('clear text presentation without clearing meaning or structure', () => {
  it('keeps heading level, links, and unrelated blocks, undo stays at the operated block', () => {
    const editor = create('<p>old caret</p><h2><a href="https://example.com"><b><i>title</i></b></a></h2><p><b>tail</b></p>');
    try {
      const pos = editor.state.doc.firstChild!.nodeSize, before = editor.state.doc;
      editor.commands.setTextSelection(1);
      expect(clearBlockTextFormatting(editor, pos)).toBe(true);
      const heading = editor.state.doc.nodeAt(pos)!;
      expect(heading.type.name).toBe('heading'); expect(heading.attrs.level).toBe(2);
      expect(heading.firstChild!.marks.map(mark => mark.type.name)).toEqual(['link']);
      expect(editor.state.doc.lastChild).toBe(before.lastChild);
      editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true); expect(editor.state.selection.from).toBe(pos);
    } finally { editor.destroy(); }
  });
  for (const rows of [2, 3]) it(`clears only selected cells across ${rows} rows; retains attributes and cell selection in one undo`, () => {
    const editor = create(table + '<p>tail</p>');
    try {
      const before = editor.state.doc, map = TableMap.get(before.firstChild!);
      const selection = CellSelection.create(before, 1 + map.map[0], 1 + map.map[(rows - 1) * 3 + 1]);
      editor.view.dispatch(editor.state.tr.setSelection(selection));
      expect(clearSelectionTextFormatting(editor)).toBe(true);
      expect(editor.state.selection.eq(selection)).toBe(true);
      editor.state.doc.firstChild!.forEach((row, rowPos, r) => row.forEach((cell, cellPos, c) => {
        expect(cell.attrs).toEqual(before.firstChild!.child(r).child(c).attrs);
        expect(cell.firstChild!.firstChild!.marks.some(mark => mark.type.name === 'bold')).toBe(!(r < rows && c < 2));
      }));
      expect(editor.state.doc.firstChild!.attrs).toEqual(before.firstChild!.attrs);
      editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
    } finally { editor.destroy(); }
  });
  it('preserves merged cells, backgrounds, alignment, and header roles', () => {
    const editor = create('<table><tr><th colspan="2" style="background-color:#ffeeee;text-align:right"><p><strong><u>merged</u></strong></p></th></tr><tr><td><p>x</p></td><td><p>y</p></td></tr></table><p>tail</p>');
    try {
      const before = editor.state.doc, map = TableMap.get(before.firstChild!);
      editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(before, 1 + map.map[0])));
      clearSelectionTextFormatting(editor);
      const cell = editor.state.doc.firstChild!.firstChild!.firstChild!;
      expect(cell.attrs).toEqual(before.firstChild!.firstChild!.firstChild!.attrs);
      expect(cell.type.name).toBe('tableHeader'); expect(cell.firstChild!.firstChild!.marks).toHaveLength(0);
      editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
    } finally { editor.destroy(); }
  });
  it('bulk mark toggles preserve rectangular cell selection and one undo', () => {
    const editor = create(table + '<p>tail</p>');
    try {
      const before = editor.state.doc, map = TableMap.get(before.firstChild!);
      const selection = CellSelection.create(before, 1 + map.map[0], 1 + map.map[7]);
      editor.view.dispatch(editor.state.tr.setSelection(selection));
      expect(toggleSelectedCellMark(editor, 'italic')).toBe(true);
      expect(editor.state.selection.eq(selection)).toBe(true);
      expect(editor.state.doc.firstChild!.firstChild!.child(2).eq(before.firstChild!.firstChild!.child(2))).toBe(true);
      editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
    } finally { editor.destroy(); }
  });
  it('treats caption text separately and preserves caption hyperlinks and image placement', () => {
    const editor = create('<p>before</p>');
    try {
      const image = editor.schema.nodes.image.create({ src: 'test.png', align: 'right', width: '50%', caption: 'caption', captionContent: [{ type: 'text', text: 'caption', marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://example.com' } }] }] });
      editor.commands.insertContent(image.toJSON());
      let pos = 0; editor.state.doc.forEach((node, at) => { if (node.type.name === 'image') pos = at; });
      const before = editor.state.doc;
      expect(clearCaptionTextFormatting(editor, pos)).toBe(true);
      expect(editor.state.doc.nodeAt(pos)!.attrs).toMatchObject({ align: 'right', width: '50%', caption: 'caption' });
      expect(editor.state.doc.nodeAt(pos)!.attrs.captionContent[0].marks).toEqual([{ type: 'link', attrs: { href: 'https://example.com' } }]);
      editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
      expect(supportsBlockTextFormatting(image)).toBe(false);
    } finally { editor.destroy(); }
  });
  it('records the edited text location for mark-only undo, without a full document diff', () => {
    const editor = create('<p>old caret</p><p><b>target</b></p>');
    try {
      const pos = editor.state.doc.firstChild!.nodeSize + 1;
      const tr = editor.state.tr.removeMark(pos, pos + 6, editor.schema.marks.bold);
      expect(transactionStart(tr.mapping.maps, tr.steps)).toBe(pos);
    } finally { editor.destroy(); }
  });
});
