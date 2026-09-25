import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { findScrollContainer } from '../../core/dom/scrollContainer';
import './tableSelectionHandles.css';
import { moveTableAxis, safeTableBoundary, tableAxisRange } from './tableStructure';
import type { Node as PMNode } from '@tiptap/pm/model';

type Axis = 'row' | 'column';
interface Handle { button: HTMLButtonElement; axis: Axis; index: number }
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
    let cell: HTMLTableCellElement | null = null, pointerX = 0;
    let visible = false;
    let gesture: { axis: Axis; index: number; pos: number; node: PMNode; table: HTMLTableElement; pointer: number; button: HTMLButtonElement;
      x: number; y: number; startX: number; startY: number; started: boolean; boundary: number } | null = null;
    let dragFrame = 0, suppressClick = false;
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
      cancelAnimationFrame(dragFrame); dragFrame = 0; guide.hidden = true;
      if (!active) return;
      suppressClick = active.started;
      if (active.button.hasPointerCapture(active.pointer)) active.button.releasePointerCapture(active.pointer);
      view.dom.classList.remove('nb-table-reordering');
      if (active.started && commit) moveTableAxis(view, active.pos, active.node, active.axis, active.index, active.boundary);
      if (active.started) hide();
    }
    function paintGesture() {
      dragFrame = 0;
      const active = gesture; if (!active?.started) return;
      if (view.state.doc.nodeAt(active.pos) !== active.node) { finishGesture(false); return; }
      const viewport = scroll.getBoundingClientRect(), before = scroll.scrollTop;
      const horizontal = active.table.parentElement!, beforeX = horizontal.scrollLeft;
      const horizontalRect = horizontal.getBoundingClientRect();
      if (active.axis === 'column') {
        if (active.x < Math.max(viewport.left, horizontalRect.left) + 32) horizontal.scrollLeft -= 16;
        if (active.x > Math.min(viewport.right, horizontalRect.right) - 32) horizontal.scrollLeft += 16;
      }
      if (active.y < viewport.top + 32) scroll.scrollTop -= 16;
      if (active.y > viewport.bottom - 32) scroll.scrollTop += 16;
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
      if (before !== scroll.scrollTop || beforeX !== horizontal.scrollLeft) dragFrame = requestAnimationFrame(paintGesture);
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
          gesture.started = true; view.dom.classList.add('nb-table-reordering');
          if (!dragFrame) dragFrame = requestAnimationFrame(paintGesture);
        });
        button.addEventListener('pointerup', event => { if (gesture?.pointer === event.pointerId) { if (gesture.started) paintGesture(); finishGesture(true); } });
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
      if (!visible || !table || !cell || !view.editable || !view.dom.contains(cell)) { hide(); return; }
      const t = table.getBoundingClientRect(), viewport = scroll.getBoundingClientRect();
      const wrapper = table.parentElement!.getBoundingClientRect();
      const left = Math.max(t.left, wrapper.left, viewport.left), right = Math.min(t.right, wrapper.right, viewport.right);
      const top = Math.max(t.top, viewport.top), bottom = Math.min(t.bottom, viewport.bottom);
      if (right <= left || bottom <= top) { hide(); return; }
      const railLeft = Math.max(2, left - 22), railTop = Math.max(viewport.top + 1, t.top - 22);
      let count = 0;
      const row = cell.parentElement as HTMLTableRowElement, r = row.getBoundingClientRect();
      const y = Math.max(r.top, top), end = Math.min(r.bottom, bottom);
      if (end > y) handle(count++, 'row', row.rowIndex, { left: railLeft, top: y, width: 22, height: end - y });
      const columns = table.querySelector(':scope > colgroup')?.children;
      if (columns?.length) {
        const index = Math.min(columns.length - 1, firstVisible(columns, 'right', pointerX));
        const c = columns[index].getBoundingClientRect();
        const x = Math.max(c.left, left), end = Math.min(c.right, right);
        if (end > x) handle(count++, 'column', index, { left: x, top: railTop, width: end - x, height: 22 });
      }
      for (let i = count; i < handles.length; i++) handles[i].button.hidden = true;
      overlay.hidden = false;
    }
    const schedule = () => { if (!frame && visible) frame = requestAnimationFrame(paint); };
    const move = (event: PointerEvent) => {
      if (gesture || event.buttons || !(event.target instanceof Element)) return;
      if (overlay.contains(event.target)) { cancelHide(); return; }
      const nextCell = event.target.closest<HTMLTableCellElement>('td,th'), next = nextCell?.closest('table');
      if (nextCell && next && view.dom.contains(next)) {
        cancelHide();
        const changed = cell !== nextCell || !visible || nextCell.colSpan > 1;
        cell = nextCell; table = next; pointerX = event.clientX; visible = true;
        if (changed) schedule();
      } else deferHide();
    };
    const leaveWindow = (event: PointerEvent) => { if (!event.relatedTarget) deferHide(); };
    const focusIn = () => { cancelHide(); };
    const focusOut = (event: FocusEvent) => { if (!overlay.contains(event.relatedTarget as Node | null)) deferHide(); };
    overlay.hidden = true;
    host.addEventListener('pointermove', move, { passive: true });
    host.addEventListener('pointerout', leaveWindow, { passive: true });
    overlay.addEventListener('focusin', focusIn); overlay.addEventListener('focusout', focusOut);
    host.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule);
    const cancelGesture = () => finishGesture(false);
    const escape = (event: KeyboardEvent) => { if (gesture && event.key === 'Escape') { event.preventDefault(); finishGesture(false); } };
    window.addEventListener('blur', cancelGesture); host.addEventListener('keydown', escape);
    return { update() { if (gesture && view.state.doc.nodeAt(gesture.pos) !== gesture.node) finishGesture(false); schedule(); }, destroy() {
      finishGesture(false); window.removeEventListener('blur', cancelGesture); host.removeEventListener('keydown', escape);
      cancelHide(); cancelAnimationFrame(frame); overlay.remove();
      host.removeEventListener('pointermove', move); host.removeEventListener('pointerout', leaveWindow);
      host.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule);
    } };
  } })]; },
});
