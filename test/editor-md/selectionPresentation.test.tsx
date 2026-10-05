// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { NodeSelection, type Transaction } from '@tiptap/pm/state';
import { buildDocumentExtensions, parseMarkdownDocument } from '../../src/features/editor-md/documentExtensions';
import { nativeTestEditor } from './nativeTestEditor';
import { AlignmentMenu } from '../../src/features/document-style/AlignmentMenu';
import { selectionPresentation } from '../../src/features/document-style/selectionPresentation';
import { setHighlightColor, setParagraphPresentation, setTextColor } from '../../src/features/document-style/documentStyles';
import { parseNativeNode, serializeNativeNode } from '../../src/features/editor-md/editorDocumentCodec';
import { serializeMarkdown } from '../../src/features/editor-md/serialize';
import { toggleSelectedCellMark } from '../../src/features/document-style/cellTextStyle';
import { MarkdownTable } from '../../src/features/editor-md/markdownTable';
import { EfficientTableView } from '../../src/features/editor-md/tableView';
import { TableViewport } from '../../src/features/editor-md/tableViewport';
import { transactionAddedCapability } from '../../src/features/document-format/capabilityGuard';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const content = '<p>before</p><table><tr><th>A</th><th>B</th><th>C</th></tr><tr><td>D</td><td>E</td><td>F</td></tr><tr><td>G</td><td>H</td><td>I</td></tr></table><p>after</p>';
function editorFor(source = content) { return nativeTestEditor(new Editor({ extensions: buildDocumentExtensions(), content: source })); }
function select(editor: Editor, axis: 'row' | 'column') {
  const tablePos = editor.state.doc.firstChild!.nodeSize, table = editor.state.doc.nodeAt(tablePos)!;
  const map = TableMap.get(table), start = tablePos + 1;
  const cell = editor.state.doc.resolve(start + map.map[4]);
  editor.view.dispatch(editor.state.tr.setSelection(axis === 'row' ? CellSelection.rowSelection(cell) : CellSelection.colSelection(cell)));
}

describe('selection presentation scope', () => {
  for (const axis of ['row', 'column'] as const) it(`top-style alignment menu applies to every selected ${axis} cell with one undo`, async () => {
    const editor = editorFor(), host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    try {
      select(editor, axis);
      const selection = editor.state.selection, before = editor.state.doc;
      const expected = axis === 'row' ? ['D', 'E', 'F'] : ['B', 'E', 'H'];
      expect(selectionPresentation(editor.state).cellBlocks.map(({ node }) => node.textContent).sort()).toEqual(expected);
      await act(async () => { root.render(<AlignmentMenu editor={editor}/>); });
      const trigger = host.querySelector<HTMLButtonElement>('button')!;
      expect(trigger.getAttribute('aria-label')).toBe('单元格对齐');
      await act(async () => { trigger.click(); });
      const action = [...document.querySelectorAll<HTMLButtonElement>('.nb-alignment-menu button')].find(button => button.textContent?.trim() === '居中')!;
      expect(action).toBeDefined();
      const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      await act(async () => { action.dispatchEvent(down); action.click(); });
      expect(down.defaultPrevented).toBe(true);
      expect(editor.state.selection.eq(selection)).toBe(true);
      editor.state.doc.descendants(node => {
        if (['tableCell', 'tableHeader'].includes(node.type.name)) expect(node.attrs.align).toBe(expected.includes(node.textContent) ? 'center' : null);
        if (node.type.name === 'paragraph') expect(node.attrs.textAlign).toBeNull();
      });
      expect(editor.state.doc.child(1).attrs.tableAlign).toBe(before.child(1).attrs.tableAlign);
      editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
      editor.commands.redo(); expect(selectionPresentation(editor.state).cellBlocks.every(({ node }) => node.attrs.align === 'center')).toBe(true);
    } finally { await act(async () => { root.unmount(); }); host.remove(); editor.destroy(); }
  });

  it('caches the current selection walk and never expands a column to intervening cells', () => {
    const editor = editorFor();
    try {
      select(editor, 'column');
      const walk = vi.spyOn(editor.state.doc, 'nodesBetween');
      const first = selectionPresentation(editor.state);
      expect(selectionPresentation(editor.state)).toBe(first);
      expect(walk).not.toHaveBeenCalled();
      expect(first.textBlocks.map(({ node }) => node.textContent).sort()).toEqual(['B', 'E', 'H']);
      walk.mockRestore();
      setTextColor(editor, '#2563eb');
      editor.state.doc.descendants(node => { if (node.isText) expect(node.marks.some(mark => mark.type.name === 'textColor')).toBe(['B', 'E', 'H'].includes(node.text!)); });
      const colored = editor.state.doc;
      toggleSelectedCellMark(editor, 'bold');
      editor.state.doc.descendants(node => { if (node.isText) expect(node.marks.some(mark => mark.type.name === 'bold')).toBe(['B', 'E', 'H'].includes(node.text!)); });
      editor.commands.undo(); expect(editor.state.doc.eq(colored)).toBe(true);
    } finally { editor.destroy(); }
  });

  it('formats a 2k-row selected column with bounded scope walks and one table copy', () => {
    const row = { type: 'tableRow', content: ['left', 'right'].map(text => ({ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })) };
    const editor = nativeTestEditor(new Editor({ extensions: [...buildDocumentExtensions({ table: MarkdownTable.configure({ resizable: false, View: EfficientTableView }) }), TableViewport],
      content: { type: 'doc', content: [{ type: 'table', content: Array.from({ length: 2_000 }, () => row) }, { type: 'paragraph' }] } }));
    try {
      const before = editor.state.doc, table = before.firstChild!, cell = before.resolve(2 + table.firstChild!.firstChild!.nodeSize);
      editor.view.dispatch(editor.state.tr.setSelection(CellSelection.colSelection(cell)));
      const rootWalk = vi.spyOn(editor.state.doc, 'nodesBetween'), start = performance.now();
      expect(selectionPresentation(editor.state).cellBlocks).toHaveLength(2_000);
      expect(rootWalk).not.toHaveBeenCalled(); rootWalk.mockRestore();
      expect(toggleSelectedCellMark(editor, 'bold')).toBe(true);
      let changed = 0;
      editor.state.doc.firstChild!.forEach(row => {
        expect(row.firstChild!.firstChild!.firstChild!.marks).toHaveLength(0);
        expect(row.lastChild!.firstChild!.firstChild!.marks[0].type.name).toBe('bold'); changed++;
      });
      expect(changed).toBe(2_000);
      console.info(`2k-row column scope and bold command: ${(performance.now() - start).toFixed(1)} ms`);
      editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
    } finally { editor.destroy(); }
  });

  it('keeps bulk cell marks under the document capability guard', () => {
    const editor = editorFor('<table>' + Array.from({ length: 6 }, () => '<tr><td>left</td><td>right</td></tr>').join('') + '</table>');
    try {
      const table = editor.state.doc.firstChild!, cell = editor.state.doc.resolve(2 + table.firstChild!.firstChild!.nodeSize);
      editor.view.dispatch(editor.state.tr.setSelection(CellSelection.colSelection(cell)));
      let changed: Transaction | undefined;
      editor.on('transaction', ({ transaction }) => { if (transaction.docChanged) changed = transaction; });
      toggleSelectedCellMark(editor, 'bold'); expect(transactionAddedCapability(changed!)).toBeNull();
      setTextColor(editor, '#2563eb'); expect(transactionAddedCapability(changed!)).toBe('textColor');
      setHighlightColor(editor, '#fef08a'); expect(transactionAddedCapability(changed!)).toBe('highlight');
      editor.state.doc.firstChild!.forEach(row => {
        expect(row.firstChild!.firstChild!.firstChild!.marks).toHaveLength(0);
        expect(row.lastChild!.firstChild!.firstChild!.marks.map(mark => mark.type.name)).toEqual(expect.arrayContaining(['bold', 'textColor', 'highlight']));
      });
      setTextColor(editor, null); expect(transactionAddedCapability(changed!)).toBeNull();
    } finally { editor.destroy(); }
  });

  it('indents a selected divider without inventing text alignment, and persists it', () => {
    const editor = editorFor('<p>before</p><hr><p>after</p>');
    try {
      const pos = editor.state.doc.firstChild!.nodeSize;
      editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
      const scope = selectionPresentation(editor.state);
      expect(scope.inline).toBe(false); expect(scope.textBlocks).toHaveLength(0); expect(scope.indentBlocks).toHaveLength(1);
      expect(setParagraphPresentation(editor, { textAlign: 'center' })).toBe(false);
      expect(setParagraphPresentation(editor, { indentBy: 1 })).toBe(true);
      expect(editor.state.doc.nodeAt(pos)!.attrs.indent).toBe(1);
      expect(editor.getHTML()).toContain('margin-inline-start: 2em');
      expect(parseNativeNode(serializeNativeNode(editor.state.doc), editor.schema).eq(editor.state.doc)).toBe(true);
      expect(parseMarkdownDocument(serializeMarkdown(editor)).toJSON()).toEqual(editor.state.doc.toJSON());
      editor.commands.undo(); expect(editor.state.doc.nodeAt(pos)!.attrs.indent).toBe(0);
    } finally { editor.destroy(); }
  });

  it('excludes code and atomic diagram blocks from text styling and alignment', () => {
    const editor = editorFor('<pre><code>code</code></pre><hr>');
    try {
      editor.commands.setTextSelection(2);
      expect(selectionPresentation(editor.state).inline).toBe(false);
      expect(setTextColor(editor, '#2563eb')).toBe(false);
      expect(setParagraphPresentation(editor, { textAlign: 'center' })).toBe(false);
    } finally { editor.destroy(); }
  });
});
