import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { findScrollContainer } from '../../core/dom/scrollContainer';
import './tableSelectionHandles.css';
import { moveTableAxis, safeTableBoundary, tableAxisRange } from './tableStructure';
import type { Node as PMNode } from '@tiptap/pm/model';
import { createDragEdgeScroller, type DragEdgeScroller } from './dragEdgeScroll';
import { tableReadingBounds, tableReadingScroll } from './tableReadingViewport';
import { clientBounds, CONTENT_VIEW_CHANGED } from '../../core/dom/contentViewport';
import { beginEditorDrag, isEditorDragging } from './editorDragActivity';

type Axis = 'row' | 'column';
interface Handle { button: HTMLButtonElement; axis: Axis; index: number }
// Keep the 5px cell-resize band free. The bottom gutter matches tableView.css;
// its slim visible rail has an independent, larger pointer target.
const RAIL_OUTSET = 22, BORDER_GAP = 6, BOTTOM_HIT = 8;
const BOTTOM_GUTTER = BORDER_GAP + BOTTOM_HIT;
/** Two stable, generous hit areas follow the current row/column. Leaving the
 * table allows time to cross into its rails; no corner control is rendered. */
export const TableSelectionHandles = Extension.create({
  name: 'tableSelectionHandles',
  addProseMirrorPlugins() { return [new Plugin({ view(view) {
    const host = view.dom.ownerDocument, scroll = findScrollContainer(view.dom);
    const overlay = host.createElement('div'); overlay.className = 'nb-table-select-overlay';
    overlay.dataset.nbEditorMenu = 'true';
    host.body.append(overlay);
    let table: HTMLTableElement | null = null, frame = 0, hideTimer: ReturnType<typeof setTimeout> | undefined;
    let cell: HTMLTableCellElement | null = null, pointerX = 0, pointerY = 0;
    let paintedBounds: { left: number; right: number; top: number; bottom: number } | null = null;
    let paintedRowSide: 'left' | 'right' = 'left', paintedColumnSide: 'top' | 'bottom' = 'top';
    let visible = false;
    let gesture: { axis: Axis; index: number; pos: number; node: PMNode; table: HTMLTableElement; pointer: number; button: HTMLButtonElement;
      x: number; y: number; startX: number; startY: number; started: boolean; boundary: number; endActivity?: () => void } | null = null;
    let dragScroller: DragEdgeScroller | null = null, suppressClick = false;
    const guide = host.createElement('div'); guide.className = 'nb-table-move-guide'; guide.hidden = true; overlay.append(guide);
    const handles: Handle[] = [];
    const cancelHide = () => { clearTimeout(hideTimer); hideTimer = undefined; };
    const hide = () => { cancelHide(); visible = false; overlay.hidden = true; };
    const deferHide = () => { if (!gesture && !hideTimer) hideTimer = setTimeout(hide, 450); };
    function tablePosition(target: HTMLTableElement) {
      try {
        const resolved = view.state.doc.resolve(view.posAtDOM(target, 0));
        let depth = resolved.depth;
        while (depth && resolved.node(depth).type.spec.tableRole !== 'table') depth--;
        if (depth) return { pos: resolved.before(depth), node: resolved.node(depth) };
        return resolved.nodeAfter?.type.spec.tableRole === 'table' ? { pos: resolved.pos, node: resolved.nodeAfter } : null;
      } catch { return null; }
    }
    function finishGesture(commit: boolean) {
      const active = gesture; gesture = null;
      dragScroller?.stop(); dragScroller = null; guide.hidden = true;
      if (!active) return;
      active.endActivity?.();
      suppressClick = active.started;
      if (active.button.hasPointerCapture(active.pointer)) active.button.releasePointerCapture(active.pointer);
      view.dom.classList.remove('nb-table-reordering');
      if (active.started && commit) moveTableAxis(view, active.pos, active.node, active.axis, active.index, active.boundary);
      if (active.started) hide();
    }
    function paintGesture() {
      const active = gesture; if (!active?.started) return;
      if (view.state.doc.nodeAt(active.pos) !== active.node) { finishGesture(false); return; }
      const viewport = tableReadingBounds(active.table, scroll);
      const items = active.axis === 'row' ? active.table.rows : active.table.querySelector(':scope > colgroup')?.children;
      if (!items?.length) return;
      const point = active.axis === 'row' ? active.y : active.x;
      let low = 0, high = items.length;
      while (low < high) {
        const middle = (low + high) >>> 1, rect = items[middle].getBoundingClientRect();
        const center = active.axis === 'row' ? (rect.top + rect.bottom) / 2 : (rect.left + rect.right) / 2;
        if (point > center) low = middle + 1; else high = middle;
      }
      active.boundary = safeTableBoundary(active.node, active.axis, low, low > active.index);
      const range = tableAxisRange(active.node, active.axis, active.index);
      const valid = active.boundary < range.from || active.boundary > range.to;
      guide.hidden = !valid;
      if (valid) {
        const tableRect = active.table.getBoundingClientRect(), at = Math.min(active.boundary, items.length - 1);
        const rect = items[at].getBoundingClientRect(), last = active.boundary === items.length;
        guide.style.cssText = active.axis === 'row'
          ? 'left:' + Math.max(viewport.left, tableRect.left) + 'px;top:' + (last ? rect.bottom : rect.top) + 'px;width:' + Math.min(tableRect.width, viewport.width) + 'px;height:3px'
          : 'top:' + Math.max(viewport.top, tableRect.top) + 'px;left:' + (last ? rect.right : rect.left) + 'px;height:' + Math.min(tableRect.bottom - Math.max(viewport.top, tableRect.top), viewport.height) + 'px;width:3px';
      }
    }
    function startDragScroll(active: NonNullable<typeof gesture>) {
      const owner = tableReadingScroll(active.table, scroll);
      const axes: Parameters<typeof createDragEdgeScroller>[0] = [{
        element: owner, direction: 'y', edge: 40, maxSpeed: 880,
        bounds: () => { const rect = tableReadingBounds(active.table, scroll);
          return { start: Math.max(0, rect.top), end: Math.min(window.innerHeight, rect.bottom) }; },
      }];
      if (active.axis === 'column') {
        const horizontal = tableReadingScroll(active.table, scroll, 'x');
        axes.push({ element: horizontal, direction: 'x', edge: 40, maxSpeed: 880,
          bounds: () => { const rect = tableReadingBounds(active.table, scroll);
            return { start: rect.left, end: rect.right }; },
        });
      }
      dragScroller = createDragEdgeScroller(axes, paintGesture);
    }
    const select = (axis: Axis, index: number) => {
      if (!table || !view.dom.contains(table)) return;
      const target = tablePosition(table); if (!target) return;
      const node = target.node, map = TableMap.get(node), start = target.pos + 1;
      const at = (row: number, column: number) => view.state.doc.resolve(start + map.map[row * map.width + column]);
      if (axis === 'row' && index >= map.height || axis === 'column' && index >= map.width) return;
      const selection = axis === 'row' ? CellSelection.rowSelection(at(index, 0), at(index, map.width - 1))
        : CellSelection.colSelection(at(0, index), at(map.height - 1, index));
      view.dispatch(view.state.tr.setSelection(selection)); view.focus();
    };
    function handle(slot: number, axis: Axis, index: number, rect: { left: number; top: number; width: number; height: number }) {
      let item = handles[slot];
      if (!item) {
        const button = host.createElement('button'); button.type = 'button';
        item = { button, axis, index }; handles.push(item); overlay.append(button);
        button.addEventListener('pointerenter', cancelHide);
        button.addEventListener('pointerdown', event => {
          if (event.button !== 0 || !table) return;
          event.preventDefault(); event.stopPropagation(); cancelHide();
          const source = tablePosition(table); if (!source) return;
          suppressClick = false;
          gesture = { ...source, table, axis: item.axis, index: item.index, pointer: event.pointerId, button,
            x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, started: false, boundary: item.index };
          button.setPointerCapture(event.pointerId);
        });
        button.addEventListener('pointermove', event => {
          if (!gesture || event.pointerId !== gesture.pointer) return;
          gesture.x = event.clientX; gesture.y = event.clientY;
          if (!gesture.started && Math.hypot(gesture.x - gesture.startX, gesture.y - gesture.startY) < 4) return;
          if (!gesture.started) {
            gesture.started = true; view.dom.classList.add('nb-table-reordering');
            gesture.endActivity = beginEditorDrag(view);
            startDragScroll(gesture);
          }
          dragScroller?.update(gesture.x, gesture.y);
        });
        button.addEventListener('pointerup', event => { if (gesture?.pointer === event.pointerId) {
          gesture.x = event.clientX; gesture.y = event.clientY;
          if (gesture.started) paintGesture(); finishGesture(true);
        } });
        button.addEventListener('pointercancel', () => finishGesture(false));
        button.addEventListener('lostpointercapture', () => { if (gesture) finishGesture(false); });
        button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); if (!suppressClick) select(item.axis, item.index); suppressClick = false; });
      }
      item.axis = axis; item.index = index;
      const { button } = item;
      button.hidden = false; button.className = 'nb-table-select-handle nb-table-select-' + axis;
      button.dataset.index = String(index);
      const label = axis === 'row' ? '选择整行' : '选择整列';
      button.setAttribute('aria-label', label); button.title = label;
      button.style.cssText = 'left:' + rect.left + 'px;top:' + rect.top + 'px;width:' + rect.width + 'px;height:' + rect.height + 'px';
    }
    // Colgroup geometry is ordered; find the logical column under merged cells.
    function firstVisible(items: HTMLCollection, edge: 'bottom' | 'right', minimum: number) {
      let low = 0, high = items.length;
      while (low < high) { const middle = (low + high) >>> 1;
        if (items[middle].getBoundingClientRect()[edge] <= minimum) low = middle + 1; else high = middle;
      }
      return low;
    }
    function paint() {
      frame = 0;
      if (!visible || !table || !cell || !view.editable || !view.dom.contains(cell) || isEditorDragging(view) && !gesture?.started) { hide(); return; }
      const t = table.getBoundingClientRect(), viewport = tableReadingBounds(table, scroll);
      const rows = table.rows;
      if (!rows.length) { hide(); return; }
      // A table's border box includes its caption. Selection belongs to the
      // cell grid, including the reserved heights of virtualized rows.
      const gridTop = rows[0].getBoundingClientRect().top;
      const gridBottom = rows[rows.length - 1].getBoundingClientRect().bottom;
      const left = Math.max(t.left, viewport.left), right = Math.min(t.right, viewport.right);
      const top = Math.max(gridTop, viewport.top), bottom = Math.min(gridBottom, viewport.bottom);
      if (right <= left || bottom <= top) { hide(); return; }
      paintedBounds = { left, right, top, bottom };
      paintedRowSide = pointerX <= (left + right) / 2 ? 'left' : 'right';
      paintedColumnSide = pointerY <= (top + bottom) / 2 ? 'top' : 'bottom';
      const outer = clientBounds(scroll);
      const rowOutside = paintedRowSide === 'left' ? left - RAIL_OUTSET >= outer.left : right + RAIL_OUTSET <= outer.right;
      const rowWidth = rowOutside ? RAIL_OUTSET - BORDER_GAP : 6;
      // A clipped viewport edge is not a cell edge. If the actual last edge is
      // still visible, keep its resize band free even in the compact fallback.
      const rightInset = !rowOutside && right >= t.right - .5 ? BORDER_GAP : 0;
      const railLeft = paintedRowSide === 'left' ? (rowOutside ? left - RAIL_OUTSET : left)
        : (rowOutside ? right + BORDER_GAP : Math.max(left, right - rowWidth - rightInset));
      const topOutside = top - RAIL_OUTSET >= outer.top;
      const bottomOutside = bottom + BOTTOM_GUTTER <= Math.min(outer.bottom, window.innerHeight - 2);
      const columnHeight = paintedColumnSide === 'top' ? (topOutside ? RAIL_OUTSET - BORDER_GAP : 6)
        : Math.min(bottomOutside ? BOTTOM_HIT : 6, bottom - top);
      const bottomInset = !bottomOutside && bottom >= gridBottom - .5 ? BORDER_GAP : 0;
      const railTop = paintedColumnSide === 'top' ? (topOutside ? top - RAIL_OUTSET : top)
        : bottomOutside ? bottom + BORDER_GAP : Math.max(top, bottom - columnHeight - bottomInset);
      let count = 0;
      const rowIndex = Math.min(rows.length - 1, firstVisible(rows, 'bottom', pointerY));
      const row = rows[rowIndex], r = row.getBoundingClientRect();
      const y = Math.max(r.top, top), end = Math.min(r.bottom, bottom);
      if (end > y) handle(count++, 'row', rowIndex, { left: railLeft, top: y, width: rowWidth, height: end - y });
      const columns = table.querySelector(':scope > colgroup')?.children;
      if (columns?.length) {
        const index = Math.min(columns.length - 1, firstVisible(columns, 'right', pointerX));
        const c = columns[index].getBoundingClientRect();
        const x = Math.max(c.left, left), end = Math.min(c.right, right);
        if (end > x) handle(count++, 'column', index, { left: x, top: railTop, width: end - x, height: columnHeight });
      }
      if (handles[0] && count) handles[0].button.classList.toggle('nb-table-select-row-right', paintedRowSide === 'right');
      if (handles[0] && count) handles[0].button.classList.toggle('nb-table-select-row-compact', !rowOutside);
      if (handles[1] && count > 1) handles[1].button.classList.toggle('nb-table-select-column-bottom', paintedColumnSide === 'bottom');
      if (handles[1] && count > 1) handles[1].button.classList.toggle('nb-table-select-column-compact', paintedColumnSide === 'top' && !topOutside);
      for (let i = count; i < handles.length; i++) handles[i].button.hidden = true;
      overlay.hidden = false;
    }
    const schedule = () => { if (!frame && visible) frame = requestAnimationFrame(paint); };
    function nearbyCell(event: PointerEvent): HTMLTableCellElement | null {
      const target = event.target as Element;
      const direct = target.closest<HTMLTableCellElement>('td,th');
      if (direct && view.dom.contains(direct)) return direct;
      // A rail must be discoverable from outside the table, without first
      // visiting a cell. Probe only the neighboring 22px band, never all tables
      // or rows; ordinary content and other controls keep their own pointer area.
      const editorHost = target.contains(view.dom) && scroll.contains(target);
      if (target !== view.dom && !editorHost && !(target.matches('.tableWrapper, .nb-table-accessories') && view.dom.contains(target))) return null;
      for (const [dx, dy] of [[RAIL_OUTSET, 0], [-RAIL_OUTSET, 0], [0, RAIL_OUTSET], [0, -RAIL_OUTSET]]) {
        const cell = host.elementFromPoint?.(event.clientX + dx, event.clientY + dy)?.closest<HTMLTableCellElement>('td,th');
        if (cell && view.dom.contains(cell)) return cell;
      }
      return null;
    }
    const move = (event: PointerEvent) => {
      if (gesture || event.buttons || isEditorDragging(view) || !(event.target instanceof Element)) return;
      const accessories = event.target.closest('.nb-table-accessories');
      if (accessories) {
        const owner = accessories.closest('table'), rows = owner?.rows;
        const bottom = rows?.length ? rows[rows.length - 1].getBoundingClientRect().bottom : -Infinity;
        if (event.clientY >= bottom + BOTTOM_GUTTER || event.target.closest('.nb-table-caption')) { hide(); return; }
      }
      if (overlay.contains(event.target)) { cancelHide(); pointerX = event.clientX; pointerY = event.clientY; schedule(); return; }
      const nextCell = nearbyCell(event), next = nextCell?.closest('table');
      if (nextCell && next && view.dom.contains(next)) {
        cancelHide();
        const bounds = paintedBounds;
        const changed = cell !== nextCell || table !== next || !visible || nextCell.colSpan > 1 || nextCell.rowSpan > 1
          || !!bounds && (paintedRowSide !== (event.clientX <= (bounds.left + bounds.right) / 2 ? 'left' : 'right')
            || paintedColumnSide !== (event.clientY <= (bounds.top + bounds.bottom) / 2 ? 'top' : 'bottom'));
        cell = nextCell; table = next; pointerX = event.clientX; pointerY = event.clientY; visible = true;
        if (changed) schedule();
      } else {
        // Crossing from a cell into its adjacent rail must keep tracking the
        // pointer. The old cell remains the geometry anchor until another cell
        // is entered; a distant pointer still starts the ordinary hide delay.
        const bounds = paintedBounds;
        if (visible && bounds && event.clientX >= bounds.left - 24 && event.clientX <= bounds.right + 24
          && event.clientY >= bounds.top - 24 && event.clientY <= bounds.bottom + BOTTOM_GUTTER) {
          cancelHide();
          pointerX = event.clientX; pointerY = event.clientY;
          schedule();
        } else deferHide();
      }
    };
    const leaveWindow = (event: PointerEvent) => { if (!event.relatedTarget) deferHide(); };
    const focusIn = () => { cancelHide(); };
    const focusOut = (event: FocusEvent) => { if (!overlay.contains(event.relatedTarget as Node | null)) deferHide(); };
    const captionFocus = (event: FocusEvent) => { if (event.target instanceof Element && event.target.closest('.nb-table-accessories')) hide(); };
    overlay.hidden = true;
    host.addEventListener('pointermove', move, { passive: true });
    host.addEventListener('pointerout', leaveWindow, { passive: true });
    host.addEventListener('focusin', captionFocus);
    overlay.addEventListener('focusin', focusIn); overlay.addEventListener('focusout', focusOut);
    host.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule);
    view.dom.addEventListener(CONTENT_VIEW_CHANGED, schedule);
    const cancelGesture = () => finishGesture(false);
    const escape = (event: KeyboardEvent) => { if (gesture && event.key === 'Escape') { event.preventDefault(); finishGesture(false); } };
    window.addEventListener('blur', cancelGesture); host.addEventListener('keydown', escape);
    return { update() { if (gesture && view.state.doc.nodeAt(gesture.pos) !== gesture.node) finishGesture(false); schedule(); }, destroy() {
      finishGesture(false); window.removeEventListener('blur', cancelGesture); host.removeEventListener('keydown', escape);
      cancelHide(); cancelAnimationFrame(frame); overlay.remove();
      host.removeEventListener('pointermove', move); host.removeEventListener('pointerout', leaveWindow);
      host.removeEventListener('focusin', captionFocus);
      host.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule);
      view.dom.removeEventListener(CONTENT_VIEW_CHANGED, schedule);
    } };
  } })]; },
});
