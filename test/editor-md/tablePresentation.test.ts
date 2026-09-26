// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { buildDocumentExtensions, parseMarkdownDocument } from '../../src/features/editor-md/documentExtensions';
import { parseMarkdown, serializeMarkdown } from '../../src/features/editor-md/serialize';
import { mapModeSelection } from '../../src/features/editor-md/sourcePosition';
import { renderDocument } from '../../src/features/export/renderDocument';
import { documentTableStyle } from '../../src/features/editor-md/documentPresentation';
import { setDocumentTableStyle } from '../../src/features/editor-md/documentPresentationCommands';
import { isTopLevelBlockMoveAllowed } from '../../src/features/editor-md/blockReorder';
import { nativeTestEditor } from './nativeTestEditor';

const source = '| 编号 | 备注 |\n| --- | --- |\n| 1 | target |\n| 2 | last |';
function editorFor(text = source) {
  const editor = new Editor({ extensions: buildDocumentExtensions() }); parseMarkdown(editor, text); return nativeTestEditor(editor);
}
describe('table presentation roundtrip', () => {
  it('keeps the default empty document editable', () => {
    const editor = new Editor({ extensions: buildDocumentExtensions() });
    try { expect(editor.state.doc.firstChild?.type.name).toBe('paragraph'); }
    finally { editor.destroy(); }
  });
  it('changes document presentation while preserving all table nodes and DOM', () => {
    const editor = editorFor(source + '\n\n' + source);
    try {
      const content = editor.state.doc.content.content, dom = [...editor.view.dom.querySelectorAll('table')];
      setDocumentTableStyle(editor, 'three-line');
      content.forEach((node, i) => expect(editor.state.doc.child(i + 1)).toBe(node));
      dom.forEach((node, i) => expect(editor.view.dom.querySelectorAll('table')[i]).toBe(node));
      expect(editor.view.dom.dataset.tableStyle).toBe('three-line');
      const md = serializeMarkdown(editor);
      expect(md.match(/noteboard-document/g)).toHaveLength(1);
      expect(documentTableStyle(parseMarkdownDocument(md))).toBe('three-line');
      expect(isTopLevelBlockMoveAllowed(editor.state.doc, 0, editor.state.doc.content.size)).toBe(false);
      expect(isTopLevelBlockMoveAllowed(editor.state.doc, 1, 0)).toBe(false);
      editor.commands.undo();
      expect(editor.view.dom.dataset.tableStyle).toBe('standard');
    } finally { editor.destroy(); }
  });
  it('keeps widths, minimum row heights, contents and caret positions through source and worker parsing', () => {
    const editor = editorFor();
    try {
      const tr = editor.state.tr;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') tr.setNodeMarkup(pos, undefined, { ...node.attrs, colwidth: [node.textContent === 'target' || node.textContent === '备注' || node.textContent === 'last' ? 260 : 90] });
        if (node.type.name === 'tableRow') tr.setNodeMarkup(pos, undefined, { ...node.attrs, height: 64 });
      });
      editor.view.dispatch(tr); setDocumentTableStyle(editor, 'three-line');
      const expected = editor.state.doc, md = serializeMarkdown(editor);
      expect(md).toContain('noteboard-table');
      expect(parseMarkdownDocument(md).toJSON()).toEqual(expected.toJSON());
      let pos = 0; expected.descendants((node, at) => { if (node.text === 'target') pos = at + 3; });
      expect(mapModeSelection(editor, md, 'source', { anchor: pos, head: pos }).head).toBe(md.indexOf('target') + 3);
      expect(mapModeSelection(editor, md, 'visual', { anchor: md.indexOf('target') + 3, head: md.indexOf('target') + 3 }).head).toBe(pos);
      parseMarkdown(editor, md); expect(editor.state.doc.eq(expected)).toBe(true);
    } finally { editor.destroy(); }
  });
  it('retains merged cells and mixed row/column headers instead of flattening them on style edits', () => {
    const editor = editorFor('<table><tr><th colspan="2">合并</th></tr><tr><th rowspan="2">分组</th><td>A</td></tr><tr><td>B</td></tr></table>');
    try {
      const doc = editor.state.doc;
      expect(parseMarkdownDocument(serializeMarkdown(editor)).toJSON()).toEqual(doc.toJSON());
    } finally { editor.destroy(); }
  });
  it('does not pad a column to the longest cell', () => {
    const long = '内容'.repeat(10000); const editor = editorFor(`| A | B |\n| --- | --- |\n| x | ${long} |`);
    try { const md = serializeMarkdown(editor); expect(md.length).toBeLessThan(long.length + 100); expect(md).not.toMatch(/ {20}|-{20}/); }
    finally { editor.destroy(); }
  });
  it('emits every GFM separator when all rows cover the same merged column', () => {
    const editor = editorFor('<table><tr><th colspan="2">LEFT</th><th>RIGHT</th></tr><tr><td colspan="2">BODY</td><td>TAIL</td></tr></table>');
    try {
      const markdown = serializeMarkdown(editor);
      expect(markdown).toContain('| --- | --- | --- |');
      expect(parseMarkdownDocument(markdown).toJSON()).toEqual(editor.state.doc.toJSON());
    } finally { editor.destroy(); }
  });
  it('keeps source text entered into an old merged placeholder by discarding stale spans', () => {
    const editor = editorFor('<table><tr><th colspan="2">LEFT</th><th>RIGHT</th></tr><tr><td colspan="2">BODY</td><td>TAIL</td></tr></table>');
    try {
      const markdown = serializeMarkdown(editor).replace('| LEFT |  | RIGHT |', '| LEFT | NEW | RIGHT |');
      const reparsed = parseMarkdownDocument(markdown);
      expect(reparsed.textContent).toContain('LEFTNEWRIGHT');
      expect(reparsed.firstChild?.firstChild?.childCount).toBe(3);
    } finally { editor.destroy(); }
  });
  it('ignores invalid dimension metadata without losing table text', () => {
    const editor = editorFor('<!-- noteboard-table {"widths":[80,100],"heights":{},"rows":{"0":{"count":2,"cells":{"0":{"colspan":10000000,"rowspan":1,"header":true}}}}} -->\n' + source);
    try {
      expect(editor.state.doc.textContent).toContain('target');
      const table = editor.state.doc.content.content.find(node => node.type.name === 'table');
      expect(table?.firstChild?.childCount).toBe(2);
    }
    finally { editor.destroy(); }
  });
  it('keeps document style when backspacing at the first visible paragraph', () => {
    const editor = editorFor('first');
    try {
      setDocumentTableStyle(editor, 'three-line'); editor.commands.setTextSelection(2);
      editor.view.someProp('handleKeyDown', handler => handler(editor.view, new KeyboardEvent('keydown', { key: 'Backspace' })));
      expect(documentTableStyle(editor.state.doc)).toBe('three-line'); expect(editor.state.doc.textContent).toBe('first');
    } finally { editor.destroy(); }
  });
  it('exports the same document style, column widths and row height', async () => {
    const editor = editorFor();
    try {
      setDocumentTableStyle(editor, 'three-line');
      const result = await renderDocument(serializeMarkdown(editor), 'table', '');
      expect(result.html).toContain('data-table-style="three-line"');
      expect(result.html).toContain('<thead>');
      expect(result.html).not.toContain('noteboard-document');
    } finally { editor.destroy(); }
  });
});
