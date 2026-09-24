import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { findScrollContainer } from '../../core/dom/scrollContainer';
import './tableSelectionHandles.css';

/** One three-button overlay per editor, independent of table size. DOM rows are
 * only anchors: the logical TableMap owns row/column identity and merged cells. */
export const TableSelectionHandles = Extension.create({
  name: 'tableSelectionHandles',
  addProseMirrorPlugins() { return [new Plugin({ view(view) {
    const host = view.dom.ownerDocument, scroll = findScrollContainer(view.dom);
    let cell: HTMLTableCellElement | null = null, frame = 0, hideTimer: ReturnType<typeof setTimeout> | undefined;
    const buttons = (['row','column','table'] as const).map(axis => {
      const button = host.createElement('button'); button.type = 'button'; button.className = `nb-table-select-handle nb-table-select-${axis}`;
      const label = axis === 'row' ? '选择整行' : axis === 'column' ? '选择整列' : '选择整个表格';
      button.setAttribute('aria-label', label); button.title = label; button.hidden = true;
      button.addEventListener('pointerenter', () => clearTimeout(hideTimer));
      button.addEventListener('pointerleave', () => { hideTimer = setTimeout(hide, 200); });
      button.addEventListener('pointerdown', event => { event.preventDefault(); event.stopPropagation(); });
      button.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation();
        if (!cell || !view.dom.contains(cell)) return;
        const resolved = view.state.doc.resolve(view.posAtDOM(cell, 0));
        let depth = resolved.depth;
        while (depth && resolved.node(depth).type.spec.tableRole !== 'table') depth--;
        if (!depth) return;
        const table = resolved.node(depth), map = TableMap.get(table), start = resolved.start(depth);
        const pos = resolved.before(depth + 2), initial = CellSelection.create(view.state.doc, pos);
        const selection = axis === 'row' ? CellSelection.rowSelection(initial.$anchorCell)
          : axis === 'column' ? CellSelection.colSelection(initial.$anchorCell)
            : CellSelection.create(view.state.doc, start + map.map[0], start + map.map[map.map.length - 1]);
        view.dispatch(view.state.tr.setSelection(selection)); view.focus();
      });
      host.body.append(button); return button;
    });
    function hide() { buttons.forEach(button => { button.hidden = true; }); }
    function paint() {
      frame = 0;
      if (!cell || !view.editable || !view.dom.contains(cell)) { hide(); return; }
      const row = cell.parentElement!, table = cell.closest('table')!;
      const c = cell.getBoundingClientRect(), r = row.getBoundingClientRect(), t = table.getBoundingClientRect(), viewport = scroll.getBoundingClientRect();
      const top = Math.max(r.top + 2, viewport.top + 2), bottom = Math.min(r.bottom - 2, viewport.bottom - 2);
      if (bottom <= top || c.right < viewport.left || c.left > viewport.right) { hide(); return; }
      const [rowButton, colButton, tableButton] = buttons;
      rowButton.style.cssText = `left:${Math.max(viewport.left + 1, t.left - 11)}px;top:${top}px;width:8px;height:${bottom - top}px`;
      const colTop = Math.max(viewport.top + 2, t.top - 11), left = Math.max(c.left + 2, viewport.left + 2), right = Math.min(c.right - 2, viewport.right - 2);
      colButton.style.cssText = `left:${left}px;top:${colTop}px;width:${Math.max(8, right - left)}px;height:8px`;
      tableButton.style.cssText = `left:${Math.max(viewport.left + 1, t.left - 11)}px;top:${colTop}px;width:8px;height:8px`;
      buttons.forEach(button => { button.hidden = false; });
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(paint); };
    const move = (event: PointerEvent) => {
      if (event.buttons || !(event.target instanceof Element)) return;
      const next = event.target.closest<HTMLTableCellElement>('td,th');
      if (!next || !view.dom.contains(next)) return;
      clearTimeout(hideTimer); if (next !== cell) { cell = next; schedule(); }
      else if (buttons[0].hidden) schedule();
    };
    const leave = () => { hideTimer = setTimeout(hide, 200); };
    view.dom.addEventListener('pointermove', move); view.dom.addEventListener('pointerleave', leave);
    scroll.addEventListener('scroll', schedule, { passive: true }); window.addEventListener('resize', schedule);
    return { update: schedule, destroy() { clearTimeout(hideTimer); cancelAnimationFrame(frame); buttons.forEach(button => button.remove());
      view.dom.removeEventListener('pointermove', move); view.dom.removeEventListener('pointerleave', leave);
      scroll.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); } };
  } })]; },
});
