import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { findScrollContainer } from '../../core/dom/scrollContainer';
import { tableAxisRange, tableGrid } from './tableStructure';

interface TableTarget { table: HTMLTableElement; pos: number; node: PMNode }
interface Gesture extends TableTarget {
  pointer: number; anchor: number; y: number; from: number; to: number;
}

function tablePosition(view: EditorView, table: HTMLTableElement): TableTarget | null {
  try {
    const resolved = view.state.doc.resolve(view.posAtDOM(table, 0));
    let depth = resolved.depth;
    while (depth && resolved.node(depth).type.spec.tableRole !== 'table') depth--;
    if (depth) return { table, pos: resolved.before(depth), node: resolved.node(depth) };
    return resolved.nodeAfter?.type.spec.tableRole === 'table'
      ? { table, pos: resolved.pos, node: resolved.nodeAfter } : null;
  } catch { return null; }
}

/** Placeholder rows retain their bounds, so geometry remains ordered even when
 * most cells are unmounted. Read only the rows visited by this binary search. */
function rowAtY(table: HTMLTableElement, y: number): number {
  const rows = table.rows;
  let low = 0, high = rows.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (rows[middle].getBoundingClientRect().bottom <= y) low = middle + 1;
    else high = middle;
  }
  return Math.min(low, rows.length - 1);
}

function marginTarget(view: EditorView, event: PointerEvent, scroll: HTMLElement): TableTarget | null {
  if (!(event.target instanceof HTMLElement) || !event.target.matches('.tableWrapper')) return null;
  const wrapper = event.target;
  // A nested caption editor owns its own input, even inside another table.
  if (!view.dom.contains(wrapper) || wrapper.closest('[contenteditable]') !== view.dom) return null;
  const table = wrapper.querySelector<HTMLTableElement>(':scope > table');
  if (!table?.rows.length) return null;
  const gridTop = table.rows[0].getBoundingClientRect().top;
  const gridBottom = table.rows[table.rows.length - 1].getBoundingClientRect().bottom;
  if (event.clientY < gridTop || event.clientY >= gridBottom) return null;
  const grid = table.getBoundingClientRect(), container = wrapper.getBoundingClientRect();
  if (event.clientX >= grid.left && event.clientX <= grid.right) return null;
  const editor = view.dom.getBoundingClientRect(), viewport = scroll.getBoundingClientRect();
  const style = getComputedStyle(view.dom), scale = view.dom.offsetWidth ? editor.width / view.dom.offsetWidth : 1;
  const inset = (name: 'paddingLeft' | 'paddingRight' | 'borderLeftWidth' | 'borderRightWidth') => (parseFloat(style[name]) || 0) * scale;
  const left = Math.max(editor.left + inset('paddingLeft') + inset('borderLeftWidth'), container.left, viewport.left, 0);
  const right = Math.min(editor.right - inset('paddingRight') - inset('borderRightWidth'), container.right, viewport.right, innerWidth);
  if (event.clientX < left || event.clientX >= right || event.clientY < Math.max(0, viewport.top)
    || event.clientY >= Math.min(innerHeight, viewport.bottom)) return null;
  return tablePosition(view, table);
}

/** Table margins select rows without starting a text caret or the handle's
 * reorder gesture. The editor owns one listener, not one listener per row. */
export const TableMarginSelection = Extension.create({
  name: 'tableMarginSelection',
  addProseMirrorPlugins() {
    return [new Plugin({ view(view) {
      const host = view.dom.ownerDocument, scroll = findScrollContainer(view.dom);
      let gesture: Gesture | null = null, frame = 0;
      const selectRows = () => {
        const active = gesture; if (!active) return;
        if (!view.editable || view.state.doc.nodeAt(active.pos) !== active.node || !view.dom.contains(active.table)) { finish(); return; }
        const row = rowAtY(active.table, active.y);
        if (row < 0) { finish(); return; }
        // Safe boundaries close the entire row range over every rowspan,
        // including overlapping spans in different columns.
        const from = tableAxisRange(active.node, 'row', Math.min(active.anchor, row)).from;
        const to = tableAxisRange(active.node, 'row', Math.max(active.anchor, row)).to;
        if (from === active.from && to === active.to) return;
        active.from = from; active.to = to;
        const map = tableGrid(active.node).map, start = active.pos + 1;
        const at = (r: number, c: number) => view.state.doc.resolve(start + map.map[r * map.width + c]);
        const selection = row < active.anchor
          ? CellSelection.rowSelection(at(to - 1, map.width - 1), at(from, 0))
          : CellSelection.rowSelection(at(from, 0), at(to - 1, map.width - 1));
        if (!selection.eq(view.state.selection)) view.dispatch(view.state.tr.setSelection(selection));
      };
      const paint = () => {
        frame = 0;
        const active = gesture; if (!active) return;
        const viewport = scroll.getBoundingClientRect(), before = scroll.scrollTop;
        const top = Math.max(0, viewport.top), bottom = Math.min(innerHeight, viewport.bottom);
        if (bottom > top) {
          const edge = Math.min(32, (bottom - top) / 2);
          let delta = active.y < top + edge ? -Math.min(18, Math.ceil((top + edge - active.y) / 2))
            : active.y > bottom - edge ? Math.min(18, Math.ceil((active.y - bottom + edge) / 2)) : 0;
          // Reveal this table only; holding beyond the last selected row must
          // not keep scrolling through unrelated paragraphs below it.
          if (delta < 0) delta = Math.max(delta, Math.min(0, active.table.rows[0].getBoundingClientRect().top - top));
          if (delta > 0) delta = Math.min(delta, Math.max(0, active.table.rows[active.table.rows.length - 1].getBoundingClientRect().bottom - bottom));
          if (delta) scroll.scrollTop += delta;
        }
        selectRows();
        if (gesture && scroll.scrollTop !== before) frame = requestAnimationFrame(paint);
      };
      const move = (event: PointerEvent) => {
        if (!gesture || event.pointerId !== gesture.pointer) return;
        if (!(event.buttons & 1)) { finish(); return; }
        event.preventDefault(); event.stopPropagation(); gesture.y = event.clientY;
        if (!frame) frame = requestAnimationFrame(paint);
      };
      const up = (event: PointerEvent) => {
        if (!gesture || event.pointerId !== gesture.pointer) return;
        event.preventDefault(); event.stopPropagation(); gesture.y = event.clientY;
        selectRows(); finish();
      };
      const cancel = (event: PointerEvent) => { if (gesture?.pointer === event.pointerId) finish(); };
      const escape = (event: KeyboardEvent) => { if (gesture && event.key === 'Escape') { event.preventDefault(); finish(); } };
      function finish() {
        const active = gesture; gesture = null;
        cancelAnimationFrame(frame); frame = 0;
        if (active && view.dom.hasPointerCapture?.(active.pointer)) view.dom.releasePointerCapture(active.pointer);
        host.removeEventListener('pointermove', move, true); host.removeEventListener('pointerup', up, true);
        host.removeEventListener('pointercancel', cancel, true); host.removeEventListener('keydown', escape);
        window.removeEventListener('blur', finish);
      }
      const down = (event: PointerEvent) => {
        if (gesture || !view.editable || event.defaultPrevented || event.button !== 0 || event.pointerType === 'touch' || event.isPrimary === false) return;
        const target = marginTarget(view, event, scroll); if (!target) return;
        const anchor = rowAtY(target.table, event.clientY); if (anchor < 0) return;
        event.preventDefault(); event.stopPropagation();
        gesture = { ...target, pointer: event.pointerId, anchor, y: event.clientY, from: -1, to: -1 };
        host.addEventListener('pointermove', move, { capture: true, passive: false });
        host.addEventListener('pointerup', up, true); host.addEventListener('pointercancel', cancel, true);
        host.addEventListener('keydown', escape); window.addEventListener('blur', finish);
        view.dom.setPointerCapture?.(event.pointerId);
        selectRows(); view.focus();
      };
      view.dom.addEventListener('pointerdown', down, true);
      view.dom.addEventListener('lostpointercapture', cancel);
      return {
        update(next, previous) { if (gesture && (next.state.doc !== previous.doc || !next.editable)) finish(); },
        destroy() { finish(); view.dom.removeEventListener('pointerdown', down, true); view.dom.removeEventListener('lostpointercapture', cancel); },
      };
    } })];
  },
});
