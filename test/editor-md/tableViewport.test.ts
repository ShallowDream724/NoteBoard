// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';
import { TextSelection } from '@tiptap/pm/state';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { MarkdownTable } from '../../src/features/editor-md/markdownTable';
import { ResizableTableRow } from '../../src/features/editor-md/tableSizing';
import { EfficientTableView } from '../../src/features/editor-md/tableView';
import { TableViewport, tableViewportKey } from '../../src/features/editor-md/tableViewport';

function create(rows: number, merged = false) {
  return new Editor({ extensions: [
    ...buildDocumentExtensions({ tableRow: ResizableTableRow,
      table: MarkdownTable.configure({ resizable: false, View: EfficientTableView }) }), TableViewport,
  ], content: { type: 'doc', content: [{ type: 'table', content: Array.from({ length: rows }, (_, index) => ({
    type: 'tableRow', content: Array.from({ length: merged && index === 0 ? 1 : 2 }, (_, column) => ({
      type: 'tableCell', attrs: { colspan: merged && index === 0 ? 2 : 1 },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: `${index}:${column}` }] }],
    })),
  })) }, { type: 'paragraph' }] } });
}
function positions(editor: Editor) {
  const rows: number[] = []; editor.state.doc.firstChild!.forEach((_node, offset) => rows.push(1 + offset)); return rows;
}

describe('large table viewport', () => {
  it('keeps small and merged tables fully editable', () => {
    for (const [count, merged] of [[10, false], [120, true]] as const) {
      const editor = create(count, merged);
      try { expect(editor.view.dom.querySelectorAll('tr')).toHaveLength(count);
        expect(editor.view.dom.querySelectorAll('.nb-row-placeholder')).toHaveLength(0);
        expect(tableViewportKey.getState(editor.state)?.rows.size).toBe(0);
      } finally { editor.destroy(); }
    }
  });
  it('bounds initial cell DOM and switches only visible rows without changing document or history', () => {
    const editor = create(1000);
    try {
      const before = editor.state.doc, rows = positions(editor);
      expect(editor.view.dom.querySelectorAll('tr')).toHaveLength(1000);
      expect(editor.view.dom.querySelectorAll('td')).toHaveLength(72);
      editor.view.dispatch(editor.state.tr.setMeta(tableViewportKey, [
        { pos: rows[500], visible: true }, { pos: rows[0], visible: false },
      ]).setMeta('addToHistory', false));
      expect(editor.view.nodeDOM(rows[500])?.textContent).toBe('500:0500:1');
      // The selection in the first cell keeps its row mounted.
      expect(editor.view.nodeDOM(rows[0])?.textContent).toBe('0:00:1');
      expect(editor.state.doc).toBe(before);
      expect(editor.getJSON().content?.[0].content).toHaveLength(1000);
      expect(editor.getHTML()).toContain('999:1');
      expect(editor.commands.undo()).toBe(false);
    } finally { editor.destroy(); }
  });
  it('mounts a distant editing target synchronously and preserves edits through remount and undo', () => {
    const editor = create(1000);
    try {
      const rows = positions(editor), target = rows[700];
      editor.commands.setTextSelection(target + 4);
      expect(editor.view.nodeDOM(target)?.textContent).toBe('700:0700:1');
      editor.commands.insertContent('edited ');
      expect(editor.view.nodeDOM(target)?.textContent).toContain('edited');
      editor.commands.setTextSelection(5);
      expect(editor.view.nodeDOM(target)?.textContent).toBe('');
      editor.commands.undo();
      expect(editor.state.doc.firstChild?.child(700).textContent).toBe('700:0700:1');
      editor.commands.redo();
      expect(editor.state.doc.firstChild?.child(700).textContent).toContain('edited');
    } finally { editor.destroy(); }
  });
  it('whole-table selection mounts endpoints without expanding its interior', () => {
    const editor = create(1000);
    try {
      const rows = positions(editor), last = editor.state.doc.nodeAt(rows[999])!;
      const endCell = rows[999] + 1 + last.firstChild!.nodeSize;
      editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, rows[0] + 1, endCell)));
      expect(editor.view.dom.querySelectorAll('td')).toHaveLength(74);
      expect(editor.state.selection.content().content.firstChild?.childCount).toBe(1000);
      editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, rows[450] + 1, rows[700] + 1)));
      expect(editor.view.nodeDOM(rows[450])?.textContent).toBe('450:0450:1');
      expect(editor.view.nodeDOM(rows[700])?.textContent).toBe('700:0700:1');
      expect(editor.view.nodeDOM(rows[500])?.textContent).toBe('');
    } finally { editor.destroy(); }
  });
  it('maps viewport rows through edits and rebuilds native rows when a table becomes small', () => {
    const editor = create(1000);
    try {
      const rows = positions(editor);
      editor.view.dispatch(editor.state.tr.setMeta(tableViewportKey, [{ pos: rows[500], visible: true }]));
      editor.commands.setTextSelection(5); editor.commands.insertContent('++');
      expect(editor.view.nodeDOM(rows[500] + 2)?.textContent).toBe('500:0500:1');
      const large = editor.getJSON(), table = large.content![0];
      editor.commands.setContent({ type: 'doc', content: [{ ...table, content: table.content!.slice(0, 5) }, { type: 'paragraph' }] });
      expect(editor.view.dom.querySelectorAll('td')).toHaveLength(10);
      expect(editor.view.dom.querySelectorAll('.nb-row-placeholder')).toHaveLength(0);
      editor.commands.setContent(large);
      expect(editor.view.dom.querySelectorAll('td')).toHaveLength(72);
      expect(editor.view.dom.querySelectorAll('tr')).toHaveLength(1000);
    } finally { editor.destroy(); }
  });
  it('reuses the last intersection when replacement retains an offscreen selection endpoint', async () => {
    let observer: IntersectionObserverCallback | undefined;
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { observer = callback; }
      observe() {} unobserve() {} disconnect() {}
    });
    const editor = create(1000), frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    try {
      const first = editor.view.dom.querySelector('tr')!;
      const bounds = first.getBoundingClientRect();
      observer!([{ target: first, isIntersecting: false, boundingClientRect: bounds, intersectionRect: bounds,
        intersectionRatio: 0, rootBounds: bounds, time: 0 }], {} as IntersectionObserver);
      await frame();
      expect(tableViewportKey.getState(editor.state)?.rows.get(1)?.visible).toBe(false);
      expect(first.cells.length).toBe(2); // Selected endpoint remains mounted.
      const table = editor.state.doc.firstChild!, target = positions(editor)[500] + 4;
      const transaction = editor.state.tr.replaceWith(0, table.nodeSize, table);
      transaction.setSelection(TextSelection.create(transaction.doc, target)); editor.view.dispatch(transaction);
      await frame(); await frame();
      expect(editor.view.dom.querySelector('tr')!.cells.length).toBe(0);
      expect(tableViewportKey.getState(editor.state)?.rows.get(1)?.visible).toBe(false);
    } finally { editor.destroy(); vi.unstubAllGlobals(); }
  });
});
