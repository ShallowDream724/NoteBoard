import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { TableMap } from '@tiptap/pm/tables';
import { closeHistory } from '@tiptap/pm/history';
import type { EditorView } from '@tiptap/pm/view';
import { SizedTableRow } from './markdownTable';
import { findScrollContainer } from '../../core/dom/scrollContainer';
import { columnWidthsStep, resizedColumnPair } from './tableColumnWidths';
import { tableGesturePreview } from './tableGesturePreview';

export const ResizableTableRow = SizedTableRow.extend({
  addNodeView() {
    return ({ node }) => {
      const row = document.createElement('tr');
      const showHeight = (height: unknown) => { row.style.height = typeof height === 'number' ? `${height}px` : ''; };
      showHeight(node.attrs.height);
      return {
        dom: row, contentDOM: row,
        update(next) { if (next.type !== node.type) return false; node = next; showHeight(node.attrs.height); return true; },
        ignoreMutation: mutation => mutation.type === 'attributes' && mutation.target === row,
      };
    };
  },
});

interface Edge { axis: 'row' | 'column'; side?: 'left' | 'right'; row: HTMLTableRowElement; cell: HTMLTableCellElement; table: HTMLTableElement }
interface Pending extends Edge { pos: number; column: number; pointer: number; origin: number }
interface Drag extends Edge {
  pos: number; pointer: number; origin: number; start: number; next: number; adjacent?: number;
  column: number; scale: number; guideOrigin: number;
  preview: NonNullable<ReturnType<typeof tableGesturePreview>>;
}

function edgeAt(view: EditorView, event: PointerEvent): Edge | null {
  if (!view.editable || !(event.target instanceof Element)) return null;
  const cell = event.target.closest<HTMLTableCellElement>('td,th');
  const row = cell?.parentElement as HTMLTableRowElement | undefined;
  const table = cell?.closest('table');
  if (!cell || !row || !table || !view.dom.contains(table)) return null;
  const bounds = cell.getBoundingClientRect();
  if (Math.abs(event.clientX - bounds.right) < 5) return { axis: 'column', side: 'right', cell, row, table };
  if (Math.abs(event.clientX - bounds.left) < 5 && cell.previousElementSibling) return { axis: 'column', side: 'left', cell, row, table };
  const rowBounds = row.getBoundingClientRect();
  if (Math.abs(event.clientY - rowBounds.bottom) < 5) return { axis: 'row', cell, row, table };
  // Collapsed borders may hit the following row. Both sides own the same
  // boundary, so a one-pixel difference must not turn resizing into selection.
  const previous = row.previousElementSibling;
  if (Math.abs(event.clientY - rowBounds.top) < 5 && previous instanceof HTMLTableRowElement && previous.cells[0]) {
    return { axis: 'row', cell: previous.cells[0], row: previous, table };
  }
  return null;
}

function modelPosition(view: EditorView, edge: Edge) {
  const resolved = view.state.doc.resolve(view.posAtDOM(edge.cell, 0));
  let tableDepth = resolved.depth;
  while (tableDepth && resolved.node(tableDepth).type.spec.tableRole !== 'table') tableDepth--;
  if (!tableDepth) return null;
  if (edge.axis === 'row') return { pos: resolved.before(tableDepth + 1), column: -1 };
  const table = resolved.node(tableDepth), start = resolved.start(tableDepth);
  const cellPos = resolved.before(tableDepth + 2) - start;
  const range = TableMap.get(table).findCell(cellPos);
  return { pos: resolved.before(tableDepth), column: (edge.side === 'left' ? range.left : range.right) - 1 };
}

/** Rows and columns share one gesture owner. No document changes during a
 * pointer frame; final attributes are committed once with stable positions. */
export const TableSizing = Extension.create({
  name: 'tableSizing',
  addProseMirrorPlugins() {
    let pending: Pending | null = null, drag: Drag | null = null, frame = 0, hoverFrame = 0, view: EditorView | undefined;
    let guide: HTMLElement | undefined, latestPointer: PointerEvent | undefined, shown: Edge | null = null;
    const hideGuide = () => {
      shown = null;
      if (guide) guide.hidden = true;
      if (view?.dom.classList.contains('nb-row-resize-ready')) view.dom.classList.remove('nb-row-resize-ready');
      if (view?.dom.classList.contains('resize-cursor')) view.dom.classList.remove('resize-cursor');
    };
    const showGuide = (edge: Edge) => {
      if (!guide || !view) return;
      const bounds = edge.axis === 'row' ? edge.row.getBoundingClientRect() : edge.cell.getBoundingClientRect();
      const viewport = findScrollContainer(view.dom).getBoundingClientRect();
      const wrapper = edge.table.parentElement!.getBoundingClientRect();
      const table = edge.table.getBoundingClientRect();
      const horizontal = edge.axis === 'row';
      const boundary = horizontal ? bounds.bottom : edge.side === 'left' ? bounds.left : bounds.right;
      const from = horizontal ? Math.max(bounds.left, viewport.left, wrapper.left) : Math.max(table.top, viewport.top, wrapper.top);
      const to = horizontal ? Math.min(bounds.right, viewport.right, wrapper.right) : Math.min(table.bottom, viewport.bottom, wrapper.bottom);
      if (to <= from) { hideGuide(); return; }
      shown = edge; guide.hidden = false;
      guide.style.cssText = horizontal
        ? `left:${from}px;top:${bounds.bottom - 2}px;width:${to - from}px;height:4px;background:var(--success-500,#22a06b)`
        : `left:${boundary - 2}px;top:${from}px;width:4px;height:${to - from}px;background:var(--accent-500,#3b82f6)`;
      view.dom.classList.toggle('nb-row-resize-ready', horizontal);
      view.dom.classList.toggle('resize-cursor', !horizontal);
      if (drag) drag.guideOrigin = boundary - (drag.next - drag.start) * drag.scale;
    };
    const paint = () => {
      frame = 0; if (!drag) return;
      if (drag.axis === 'row') drag.preview.rowHeight(drag.next);
      else drag.preview.columns(drag.column, drag.next, drag.adjacent);
      if (guide) guide.style.setProperty(drag.axis === 'row' ? 'top' : 'left', `${drag.guideOrigin + (drag.next - drag.start) * drag.scale - 2}px`);
    };
    const finish = (editor: EditorView, commit: boolean) => {
      const pointer = pending?.pointer ?? drag?.pointer;
      const current = drag; drag = null; pending = null; latestPointer = undefined;
      if (pointer !== undefined && editor.dom.hasPointerCapture(pointer)) editor.dom.releasePointerCapture(pointer);
      if (!current) { hideGuide(); return; }
      cancelAnimationFrame(frame); frame = 0;
      current.preview.dispose(); hideGuide();
      editor.dom.classList.remove('nb-row-resizing', 'nb-table-resizing');
      if (editor.dom.hasPointerCapture(current.pointer)) editor.dom.releasePointerCapture(current.pointer);
      const node = editor.state.doc.nodeAt(current.pos);
      if (!commit || !node || Math.abs(current.next - current.start) < 1) return;
      if (current.axis === 'row' && node.type.spec.tableRole === 'row') {
        editor.dispatch(closeHistory(editor.state.tr).setNodeMarkup(current.pos, undefined, { ...node.attrs, height: current.next }));
      } else if (current.axis === 'column' && node.type.spec.tableRole === 'table') {
        const widths = current.preview.widths.map(Math.round);
        widths[current.column] = current.next;
        if (current.adjacent !== undefined) widths[current.column + 1] = Math.round(current.adjacent);
        editor.dispatch(closeHistory(editor.state.tr).step(columnWidthsStep(current.pos, node, widths)));
      }
    };
    return [new Plugin({
      filterTransaction(transaction) { if (transaction.docChanged && (drag || pending) && view) finish(view, false); return true; },
      props: { handleDOMEvents: {
        pointermove(_editor, event) {
          if (pending && !drag) {
            if (event.pointerId !== pending.pointer) return false;
            const coordinate = pending.axis === 'row' ? event.clientY : event.clientX;
            if (Math.abs(coordinate - pending.origin) < 3) { event.preventDefault(); return true; }
            const bounds = pending.row.getBoundingClientRect(), height = pending.row.offsetHeight;
            const preview = tableGesturePreview(pending.table, pending.axis === 'row' ? pending.row : undefined);
            if (!preview) { finish(_editor, false); return false; }
            const start = pending.axis === 'row' ? height : preview.widths[pending.column];
            drag = { ...pending, preview, start, next: start,
              scale: pending.axis === 'row' ? bounds.height / height || 1 : preview.scale, guideOrigin: 0 };
            pending = null;
            _editor.dom.classList.add('nb-table-resizing');
            if (drag.axis === 'row') _editor.dom.classList.add('nb-row-resizing');
            showGuide(drag);
          }
          if (drag) {
            if (event.pointerId !== drag.pointer) return false;
            const delta = ((drag.axis === 'row' ? event.clientY : event.clientX) - drag.origin) / drag.scale;
            if (drag.axis === 'row') drag.next = Math.max(24, Math.min(10000, Math.round(drag.start + delta)));
            else [drag.next, drag.adjacent] = resizedColumnPair(drag.preview.widths, drag.column, delta);
            if (!frame) frame = requestAnimationFrame(paint);
            event.preventDefault(); return true;
          }
          latestPointer = event;
          if (!hoverFrame) hoverFrame = requestAnimationFrame(() => {
            hoverFrame = 0; if (!latestPointer || drag || !view) return;
            const edge = edgeAt(view, latestPointer); if (edge) showGuide(edge); else hideGuide();
          });
          return false;
        },
        pointerdown(editor, event) {
          if (drag || pending) return true;
          if (event.button !== 0) return false;
          const edge = edgeAt(editor, event); if (!edge) return false;
          const position = modelPosition(editor, edge); if (!position) return false;
          // A press is not a resize. Preserve automatic layout until actual movement.
          pending = { ...edge, ...position, pointer: event.pointerId, origin: edge.axis === 'row' ? event.clientY : event.clientX };
          editor.dom.setPointerCapture(event.pointerId);
          showGuide(edge); event.preventDefault(); return true;
        },
        pointerup(editor, event) { if (event.pointerId !== (drag?.pointer ?? pending?.pointer)) return false; finish(editor, true); return true; },
        pointercancel(editor, event) { if (event.pointerId === (drag?.pointer ?? pending?.pointer)) finish(editor, false); return false; },
        lostpointercapture(editor, event) { if (event.pointerId === (drag?.pointer ?? pending?.pointer)) finish(editor, false); return false; },
        pointerleave() { latestPointer = undefined; if (!drag && !pending) hideGuide(); return false; },
        keydown(editor, event) { if (!drag && !pending) return false; finish(editor, false); return event.key === 'Escape'; },
      } },
      view(editor) {
        view = editor;
        guide = editor.dom.ownerDocument.createElement('div'); guide.className = 'nb-row-resize-guide'; guide.hidden = true;
        guide.setAttribute('aria-hidden', 'true'); editor.dom.ownerDocument.body.append(guide);
        const scroll = () => { if (drag) showGuide(drag); else hideGuide(); };
        editor.dom.ownerDocument.addEventListener('scroll', scroll, true);
        return {
          update() { if (shown && !editor.dom.contains(shown.table)) hideGuide(); },
          destroy() { finish(editor, false); cancelAnimationFrame(hoverFrame); cancelAnimationFrame(frame);
            editor.dom.ownerDocument.removeEventListener('scroll', scroll, true); guide?.remove(); guide = undefined; view = undefined; },
        };
      },
    })];
  },
});
