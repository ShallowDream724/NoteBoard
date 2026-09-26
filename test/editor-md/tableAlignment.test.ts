// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { MarkdownTable } from '../../src/features/editor-md/markdownTable';
import { EfficientTableView } from '../../src/features/editor-md/tableView';
import { setTableAlignment } from '../../src/features/editor-md/tableAlignmentCommands';
import { parseNativeNode, serializeNativeNode } from '../../src/features/editor-md/editorDocumentCodec';
import { DocumentCapabilityGuard, transactionAddedCapability } from '../../src/features/document-format/capabilityGuard';
import { portableMarkdown, withoutPresentation } from '../../src/features/export/portableMarkdown';
import { renderDocument } from '../../src/features/export/renderDocument';
import { serializeMarkdown } from '../../src/features/editor-md/serialize';
import { nativeTestEditor } from './nativeTestEditor';
import { TableRowLayout } from '../../src/features/editor-md/tableRowLayout';
import { ResizableTableRow } from '../../src/features/editor-md/tableSizing';
import { TableViewport } from '../../src/features/editor-md/tableViewport';
import { CellSelection } from '@tiptap/pm/tables';

const content = '<table><tr><th colwidth="80">A</th><th colwidth="120">B</th></tr><tr><td colwidth="80" style="text-align:right">C</td><td colwidth="120">D</td></tr></table><p>tail</p>';
function create(native = true, source = content) {
  const editor = new Editor({ extensions: [...buildDocumentExtensions({ table: MarkdownTable.configure({ resizable: false, View: EfficientTableView }) }), DocumentCapabilityGuard], content: source });
  return native ? nativeTestEditor(editor) : editor;
}

describe('whole-table alignment', () => {
  it('centers ordinary inserted MD tables without introducing a native-only attribute', () => {
    const editor = create(false, '<p></p>');
    try {
      expect(editor.commands.insertTable({ rows: 2, cols: 2 })).toBe(true);
      expect(editor.state.doc.firstChild!.type.name).toBe('table');
      expect(editor.state.doc.firstChild!.attrs.tableAlign).toBeNull();
      const table = editor.view.dom.querySelector('table')!;
      expect(table.style.marginLeft).toBe('auto'); expect(table.style.marginRight).toBe('auto');
    } finally { editor.destroy(); }
  });
  it('updates one table attribute, preserves cells and selection, and has independent undo', () => {
    const editor = create();
    try {
      editor.commands.setTextSelection(editor.state.doc.content.size - 2);
      const before = editor.state.doc.firstChild!, selection = editor.state.selection;
      expect(setTableAlignment(editor, 0, 'center')).toBe(true);
      expect(editor.state.doc.firstChild!.attrs.tableAlign).toBe('center');
      expect(editor.state.doc.firstChild!.content).toBe(before.content);
      expect(editor.state.selection.eq(selection)).toBe(true);
      expect(setTableAlignment(editor, 0, 'right')).toBe(true);
      editor.commands.undo(); expect(editor.state.doc.firstChild!.attrs.tableAlign).toBe('center');
      editor.commands.undo(); expect(editor.state.doc.firstChild!.eq(before)).toBe(true);
      editor.commands.redo(); expect(editor.state.doc.firstChild!.attrs.tableAlign).toBe('center');
    } finally { editor.destroy(); }
  });
  it('preserves native position and column widths in HTML, while clean Markdown omits position', () => {
    const editor = create();
    try {
      const plain = portableMarkdown(editor.getJSON()), originalMarkdown = serializeMarkdown(editor);
      setTableAlignment(editor, 0, 'right');
      const source = serializeNativeNode(editor.state.doc), parsed = parseNativeNode(source, editor.schema);
      expect(parsed.firstChild!.attrs.tableAlign).toBe('right');
      expect(parsed.eq(editor.state.doc)).toBe(true);
      expect(portableMarkdown(editor.getJSON())).toBe(plain);
      expect(serializeMarkdown(editor)).toBe(originalMarkdown);
      expect(withoutPresentation(editor.getJSON()).content?.[0].attrs).not.toHaveProperty('tableAlign');
      const html = document.createElement('div'); html.innerHTML = editor.getHTML();
      const table = html.querySelector('table')!;
      expect(table.dataset.tableAlign).toBe('right');
      expect(table.style.marginLeft).toBe('auto'); expect(table.style.marginRight).toBe('0px');
      expect(table.style.width).toBe('200px');
      expect([...table.querySelectorAll('col')].map(col => col.style.width)).toEqual(['80px', '120px']);
      const restored = create(true, html.innerHTML);
      try { expect(restored.state.doc.firstChild!.attrs.tableAlign).toBe('right'); }
      finally { restored.destroy(); }
    } finally { editor.destroy(); }
  });
  it('preserves position in HTML and print export', async () => {
    const editor = create();
    try {
      setTableAlignment(editor, 0, 'center');
      for (const mode of ['print', 'html'] as const) {
        const result = await renderDocument('', 'table', '', undefined, editor.state.doc, undefined, undefined, mode);
        const host = document.createElement('div'); host.innerHTML = result.html;
        const table = host.querySelector('table')!;
        expect(table.dataset.tableAlign).toBe('center');
        expect(table.style.marginLeft).toBe('auto'); expect(table.style.marginRight).toBe('auto');
        expect(table.style.width).toBe('200px');
      }
    } finally { editor.destroy(); }
  });
  it('gates commands, direct attribute changes and aligned HTML insertion in Markdown', async () => {
    const editor = create(false);
    try {
      const before = editor.state.doc;
      expect(setTableAlignment(editor, 0, 'center')).toBe(false);
      const tr = editor.state.tr.setNodeAttribute(0, 'tableAlign', 'right');
      expect(transactionAddedCapability(tr)).toBe('tableAlignment');
      editor.view.dispatch(tr); expect(editor.state.doc).toBe(before);
      editor.commands.insertContentAt(0, '<table data-table-align="center"><tr><td>pasted</td></tr></table>');
      expect(editor.state.doc).toBe(before);
      await Promise.resolve(); expect(editor.state.doc).toBe(before);
    } finally { editor.destroy(); }
  });
  it('updates a large table position without traversing rows or replacing column DOM', () => {
    const editor = create();
    try {
      const row = editor.state.doc.firstChild!.firstChild!;
      const table = editor.schema.nodes.table.create(null, Array.from({ length: 10_000 }, () => row));
      const view = new EfficientTableView(table, 40), columns = view.colgroup.innerHTML;
      const aligned = table.type.create({ ...table.attrs, tableAlign: 'center' }, table.content);
      const traversal = vi.spyOn(aligned, 'forEach');
      try {
        expect(view.update(aligned)).toBe(true); expect(traversal).not.toHaveBeenCalled();
        expect(view.table.style.marginLeft).toBe('auto'); expect(view.table.style.marginRight).toBe('auto');
        expect(view.table.style.width).toBe('200px'); expect(view.colgroup.innerHTML).toBe(columns);
        expect(view.update(table)).toBe(true); expect(view.table.dataset.tableAlign).toBeUndefined();
        expect(view.table.style.marginLeft).toBe('auto');
      } finally { traversal.mockRestore(); view.destroy(); }
    } finally { editor.destroy(); }
  });
  it('reuses row layout during a real 10k-row editor transaction and preserves cell selection', () => {
    const row = { type: 'tableRow', content: ['A', 'B'].map(text => ({ type: 'tableCell', attrs: { colwidth: [80] },
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })) };
    const editor = nativeTestEditor(new Editor({ extensions: [...buildDocumentExtensions({ tableRow: ResizableTableRow,
      table: MarkdownTable.configure({ resizable: false, View: EfficientTableView }) }), TableViewport, DocumentCapabilityGuard],
    content: { type: 'doc', content: [{ type: 'table', content: Array.from({ length: 10_000 }, () => row) }, { type: 'paragraph' }] } }));
    const layout = vi.spyOn(TableRowLayout.prototype, 'update');
    try {
      const table = editor.state.doc.firstChild!, firstCell = 2, secondCell = firstCell + table.firstChild!.firstChild!.nodeSize;
      editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, firstCell, secondCell)));
      const selection = editor.state.selection, dom = editor.view.dom.querySelector('table');
      const start = performance.now();
      expect(setTableAlignment(editor, 0, 'center')).toBe(true);
      const elapsed = performance.now() - start;
      expect(editor.state.doc.firstChild!.content).toBe(table.content);
      expect(editor.state.selection.eq(selection)).toBe(true);
      expect(editor.view.dom.querySelector('table')).toBe(dom);
      expect(layout).not.toHaveBeenCalled();
      expect(editor.view.dom.querySelectorAll('td').length).toBeLessThan(100);
      console.info(`10k-row table alignment transaction: ${elapsed.toFixed(1)} ms`);
    } finally { layout.mockRestore(); editor.destroy(); }
  });
});
