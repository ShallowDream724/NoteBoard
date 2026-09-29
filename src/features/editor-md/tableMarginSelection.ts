import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { findScrollContainer } from '../../core/dom/scrollContainer';
import { tableAxisRange, tableGrid } from './tableStructure';
import { createDragEdgeScroller, type DragEdgeScroller } from './dragEdgeScroll';
import { tableReadingBounds, tableReadingScroll } from './tableReadingViewport';

interface TableTarget { table: HTMLTableElement; pos: number; node: PMNode }
interface Gesture extends TableTarget {
  pointer: number; axis: 'row' | 'column'; anchor: number; x: number; y: number; from: number; to: number;
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

function columnAtX(table: HTMLTableElement, x: number, width: number): number {
  const cols = table.querySelectorAll<HTMLTableColElement>(':scope > colgroup > col');
  if (cols.length === width && cols[0].getBoundingClientRect().width > 0) {
    let low = 0, high = cols.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (cols[middle].getBoundingClientRect().right <= x) low = middle + 1;
      else high = middle;
    }
    return Math.min(low, width - 1);
  }
  // Browser layouts without measurable col elements still expose the first row.
  let column = 0;
  for (const cell of table.rows[0].cells) {
    const box = cell.getBoundingClientRect(), span = Math.max(1, cell.colSpan);
    if (x < box.right) return Math.min(width - 1, column + Math.max(0, Math.min(span - 1, Math.floor((x - box.left) / Math.max(1, box.width / span)))));
    column += span;
  }
  return width - 1;
}

function visibleSibling(block: Element | null, direction: 'previousElementSibling' | 'nextElementSibling'): Element | null {
  let sibling = block?.[direction] ?? null;
  while (sibling?.classList.contains('nb-heading-fold-hidden')) sibling = sibling[direction];
  return sibling;
}

function nearbyTables(view: EditorView, x: number, y: number): HTMLElement[] {
  const hit = view.posAtCoords({ left: x, top: y });
  if (!hit) return [];
  const at = view.domAtPos(hit.pos);
  let block: Element | null = at.node instanceof Element ? at.node : at.node.parentElement;
  while (block && block !== view.dom && block.parentElement !== view.dom) block = block.parentElement;
  if (!block) return [];
  let neighbors: Array<Element | null>;
  if (block === view.dom) {
    const after = view.dom.children[at.offset] ?? null;
    const tail = view.dom.lastElementChild;
    const before = after ? visibleSibling(after, 'previousElementSibling')
      : tail?.classList.contains('nb-heading-fold-hidden') ? visibleSibling(tail, 'previousElementSibling') : tail;
    neighbors = [before, after?.classList.contains('nb-heading-fold-hidden') ? visibleSibling(after, 'nextElementSibling') : after];
  } else neighbors = [visibleSibling(block, 'previousElementSibling'), block, visibleSibling(block, 'nextElementSibling')];
  return neighbors.filter((item): item is HTMLElement => item instanceof HTMLElement
    && !item.classList.contains('nb-heading-fold-hidden') && item.matches('.tableWrapper'));
}

function marginTarget(view: EditorView, event: PointerEvent, scroll: HTMLElement): (TableTarget & { axis: 'row' | 'column' }) | null {
  if (!(event.target instanceof HTMLElement)) return null;
  const wrapper = event.target.matches('.tableWrapper') ? event.target : null;
  // Outside a wrapper only the editor's own empty space is eligible. Paragraphs,
  // captions, nested editors and controls keep their native pointer handling.
  if (event.target !== view.dom && !wrapper) return null;
  if (wrapper && (!view.dom.contains(wrapper) || wrapper.closest('[contenteditable]') !== view.dom)) return null;
  const editor = view.dom.getBoundingClientRect(), viewport = scroll.getBoundingClientRect();
  const y = event.clientY, x = event.clientX;
  if (y < Math.max(0, viewport.top) || y >= Math.min(innerHeight, viewport.bottom)) return null;
  const style = getComputedStyle(view.dom), scale = view.dom.offsetWidth ? editor.width / view.dom.offsetWidth : 1;
  const inset = (name: 'paddingLeft' | 'paddingRight' | 'borderLeftWidth' | 'borderRightWidth') => (parseFloat(style[name]) || 0) * scale;
  const editorLeft = Math.max(editor.left + inset('paddingLeft') + inset('borderLeftWidth'), viewport.left, 0);
  const editorRight = Math.min(editor.right - inset('paddingRight') - inset('borderRightWidth'), viewport.right, innerWidth);
  if (x < editorLeft || x >= editorRight) return null;
  // The editor resolves the nearby document position. This remains correct when
  // folded headings hide intervening siblings and visual tops are not ordered.
  const candidates = wrapper ? [wrapper] : nearbyTables(view, x, y);
  for (const candidate of candidates) {
    if (candidate.parentElement !== view.dom && event.target !== candidate) continue;
    const table = candidate.querySelector<HTMLTableElement>(':scope > table');
    if (!table?.rows.length) continue;
    const gridTop = table.rows[0].getBoundingClientRect().top;
    const gridBottom = table.rows[table.rows.length - 1].getBoundingClientRect().bottom;
    const grid = table.getBoundingClientRect(), container = candidate.getBoundingClientRect();
    const left = Math.max(editorLeft, container.left);
    const right = Math.min(editorRight, container.right);
    if (x < left || x >= right) continue;
    if (y >= gridTop && y < gridBottom) {
      if (x >= grid.left && x <= grid.right) continue;
      const target = tablePosition(view, table);
      if (target) return { ...target, axis: 'row' };
      continue;
    }
    if (x < grid.left || x >= grid.right) continue;
    const margin = getComputedStyle(candidate);
    const previousBox = visibleSibling(candidate, 'previousElementSibling')?.getBoundingClientRect();
    const nextBox = visibleSibling(candidate, 'nextElementSibling')?.getBoundingClientRect();
    const previous = previousBox?.height ? previousBox : null;
    const next = nextBox?.height ? nextBox : null;
    const topStart = Math.max(previous?.bottom ?? -Infinity, container.top - (parseFloat(margin.marginTop) || 0) * scale);
    const bottomEnd = Math.min(next?.top ?? Infinity, container.bottom + (parseFloat(margin.marginBottom) || 0) * scale);
    // The table bounds include the caption. Its own hit target is already excluded;
    // only the space below its box belongs to the bottom column margin.
    if ((y >= topStart && y < gridTop) || (y >= Math.max(grid.bottom, gridBottom) && y < bottomEnd)) {
      const target = tablePosition(view, table);
      if (target) return { ...target, axis: 'column' };
    }
  }
  return null;
}

/** Table margins select rows without starting a text caret or the handle's
 * reorder gesture. The editor owns one listener, not one listener per row. */
export const TableMarginSelection = Extension.create({
  name: 'tableMarginSelection',
  addProseMirrorPlugins() {
    return [new Plugin({ view(view) {
      const host = view.dom.ownerDocument, scroll = findScrollContainer(view.dom);
      let gesture: Gesture | null = null, dragScroller: DragEdgeScroller | null = null;
      const selectAxis = () => {
        const active = gesture; if (!active) return;
        if (!view.editable || view.state.doc.nodeAt(active.pos) !== active.node || !view.dom.contains(active.table)) { finish(); return; }
        const map = tableGrid(active.node).map;
        const current = active.axis === 'row' ? rowAtY(active.table, active.y) : columnAtX(active.table, active.x, map.width);
        if (current < 0) { finish(); return; }
        // Safe boundaries close the entire range over merged cells.
        const from = tableAxisRange(active.node, active.axis, Math.min(active.anchor, current)).from;
        const to = tableAxisRange(active.node, active.axis, Math.max(active.anchor, current)).to;
        if (from === active.from && to === active.to) return;
        active.from = from; active.to = to;
        const start = active.pos + 1;
        const at = (r: number, c: number) => view.state.doc.resolve(start + map.map[r * map.width + c]);
        const selection = active.axis === 'row'
          ? current < active.anchor ? CellSelection.rowSelection(at(to - 1, map.width - 1), at(from, 0))
            : CellSelection.rowSelection(at(from, 0), at(to - 1, map.width - 1))
          : current < active.anchor ? CellSelection.colSelection(at(map.height - 1, to - 1), at(0, from))
            : CellSelection.colSelection(at(0, from), at(map.height - 1, to - 1));
        if (!selection.eq(view.state.selection)) view.dispatch(view.state.tr.setSelection(selection));
      };
      const startDragScroll = (active: Gesture) => {
        const axes: Parameters<typeof createDragEdgeScroller>[0] = [];
        const owner = tableReadingScroll(active.table, scroll, active.axis === 'row' ? 'y' : 'x');
        if (active.axis === 'row') axes.push({
          element: owner, direction: 'y', edge: 40, maxSpeed: 880,
          bounds: () => { const rect = tableReadingBounds(active.table, scroll);
            return { start: Math.max(0, rect.top), end: Math.min(innerHeight, rect.bottom) }; },
          // Stop when the table's first or last row reaches the visible edge.
          limitDelta: delta => { const rect = tableReadingBounds(active.table, scroll);
            const top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom);
            return delta < 0
              ? Math.max(delta, Math.min(0, active.table.rows[0].getBoundingClientRect().top - top))
              : Math.min(delta, Math.max(0, active.table.rows[active.table.rows.length - 1].getBoundingClientRect().bottom - bottom)); },
        });
        else {
          const horizontal = owner;
          axes.push({ element: horizontal, direction: 'x', edge: 40, maxSpeed: 880,
            bounds: () => { const rect = tableReadingBounds(active.table, scroll);
              return { start: rect.left, end: rect.right }; },
          });
        }
        dragScroller = createDragEdgeScroller(axes, selectAxis);
      };
      const move = (event: PointerEvent) => {
        if (!gesture || event.pointerId !== gesture.pointer) return;
        if (!(event.buttons & 1)) { finish(); return; }
        event.preventDefault(); event.stopPropagation(); gesture.x = event.clientX; gesture.y = event.clientY;
        if (!dragScroller) startDragScroll(gesture);
        dragScroller?.update(gesture.x, gesture.y);
      };
      const up = (event: PointerEvent) => {
        if (!gesture || event.pointerId !== gesture.pointer) return;
        event.preventDefault(); event.stopPropagation(); gesture.x = event.clientX; gesture.y = event.clientY;
        selectAxis(); finish();
      };
      const cancel = (event: PointerEvent) => { if (gesture?.pointer === event.pointerId) finish(); };
      const escape = (event: KeyboardEvent) => { if (gesture && event.key === 'Escape') { event.preventDefault(); finish(); } };
      function finish() {
        const active = gesture; gesture = null;
        dragScroller?.stop(); dragScroller = null;
        if (active && view.dom.hasPointerCapture?.(active.pointer)) view.dom.releasePointerCapture(active.pointer);
        host.removeEventListener('pointermove', move, true); host.removeEventListener('pointerup', up, true);
        host.removeEventListener('pointercancel', cancel, true); host.removeEventListener('keydown', escape);
        window.removeEventListener('blur', finish);
      }
      const down = (event: PointerEvent) => {
        if (gesture || !view.editable || event.defaultPrevented || event.button !== 0 || event.pointerType === 'touch' || event.isPrimary === false) return;
        const target = marginTarget(view, event, scroll); if (!target) return;
        const anchor = target.axis === 'row' ? rowAtY(target.table, event.clientY)
          : columnAtX(target.table, event.clientX, tableGrid(target.node).map.width);
        if (anchor < 0) return;
        event.preventDefault(); event.stopPropagation();
        gesture = { ...target, pointer: event.pointerId, anchor, x: event.clientX, y: event.clientY, from: -1, to: -1 };
        host.addEventListener('pointermove', move, { capture: true, passive: false });
        host.addEventListener('pointerup', up, true); host.addEventListener('pointercancel', cancel, true);
        host.addEventListener('keydown', escape); window.addEventListener('blur', finish);
        view.dom.setPointerCapture?.(event.pointerId);
        selectAxis(); view.focus();
      };
      view.dom.addEventListener('pointerdown', down, true);
      view.dom.addEventListener('lostpointercapture', cancel);
      return {
        update(next) { if (gesture && (next.state.doc.nodeAt(gesture.pos) !== gesture.node || !next.editable || !next.dom.contains(gesture.table))) finish(); },
        destroy() { finish(); view.dom.removeEventListener('pointerdown', down, true); view.dom.removeEventListener('lostpointercapture', cancel); },
      };
    } })];
  },
});
