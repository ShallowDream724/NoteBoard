import { Plugin, type EditorState } from '@tiptap/pm/state';
import type { Node } from '@tiptap/pm/model';
import { CellSelection } from '@tiptap/pm/tables';
import { findScrollContainer } from '../../core/dom/scrollContainer';
import type { EditorView } from '@tiptap/pm/view';
import { tableReadingBounds } from './tableReadingViewport';

function cellBounds(view: EditorView, position: number) {
  const cell = view.nodeDOM(position);
  if (cell instanceof Element && cell.matches('td,th')) return cell.getBoundingClientRect();
  const resolved = view.state.doc.resolve(position);
  if (resolved.parent.type.spec.tableRole !== 'row') return null;
  const row = view.nodeDOM(resolved.before());
  if (!(row instanceof HTMLTableRowElement)) return null;
  const column = row.closest('table')?.querySelector('colgroup')?.children[resolved.index()];
  if (!(column instanceof Element)) return null;
  const vertical = row.getBoundingClientRect(), horizontal = column.getBoundingClientRect();
  return { left: horizontal.left, right: horizontal.right, top: vertical.top, bottom: vertical.bottom };
}

const rectangular = new WeakMap<Node, boolean>();
function overlaySelection(state: EditorState): CellSelection | null {
  const selection = state.selection;
  if (!(selection instanceof CellSelection) || selection.ranges.length < 128) return null;
  if (selection.isRowSelection() && selection.isColSelection()) return selection;
  const table = selection.$anchorCell.node(-1);
  let simple = rectangular.get(table);
  if (simple === undefined) {
    simple = true;
    table.forEach(row => row.forEach(cell => { if (cell.attrs.rowspan !== 1 || cell.attrs.colspan !== 1) simple = false; }));
    rectangular.set(table, simple);
  }
  return simple ? selection : null;
}

/** Large rectangular selections use one clipped visual overlay. Selection,
 * clipboard and history remain ProseMirror's native CellSelection. Small or
 * irregular merged selections retain the upstream per-cell decorations. */
export function withTableSelectionView(plugin: Plugin): Plugin {
  return new Plugin({ ...plugin.spec, props: { ...plugin.props,
    decorations(state) { return overlaySelection(state) ? null : plugin.props.decorations?.call(plugin, state) ?? null; },
  }, view(view) {
    const original = plugin.spec.view?.(view);
    let host: HTMLElement | null = null;
    const overlay = document.createElement('div');
    overlay.className = 'nb-table-selection-overlay'; overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true'); document.body.append(overlay);
    let frame = 0;
    const paint = () => {
      frame = 0;
      const selection = overlaySelection(view.state);
      if (!selection || !view.dom.isConnected) { overlay.hidden = true; return; }
      const owner = findScrollContainer(view.dom);
      if (owner !== host) { if (host) observer?.unobserve(host); host = owner; observer?.observe(host); }
      if (!host.clientHeight) { overlay.hidden = true; return; }
      const a = cellBounds(view, selection.$anchorCell.pos), b = cellBounds(view, selection.$headCell.pos);
      if (!a || !b) { overlay.hidden = true; return; }
      const row = view.nodeDOM(selection.$anchorCell.before());
      const table = row instanceof Element ? row.closest('table') : null;
      const clip = table ? tableReadingBounds(table, host) : host.getBoundingClientRect();
      const left = Math.max(0, clip.left, Math.min(a.left, b.left)), right = Math.min(innerWidth, clip.right, Math.max(a.right, b.right));
      const top = Math.max(0, clip.top, Math.min(a.top, b.top)), bottom = Math.min(innerHeight, clip.bottom, Math.max(a.bottom, b.bottom));
      overlay.hidden = right <= left || bottom <= top;
      if (!overlay.hidden) Object.assign(overlay.style, { left: left + 'px', top: top + 'px', width: right - left + 'px', height: bottom - top + 'px' });
    };
    const schedule = () => { if (!frame && (overlaySelection(view.state) || !overlay.hidden)) frame = requestAnimationFrame(paint); };
    document.addEventListener('scroll', schedule, { passive: true, capture: true }); window.addEventListener('resize', schedule);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    schedule();
    return { update(next, previous) { original?.update?.(next, previous); if (next.state.doc !== previous.doc || !next.state.selection.eq(previous.selection)) schedule(); },
      destroy() { original?.destroy?.(); cancelAnimationFrame(frame); observer?.disconnect(); document.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); overlay.remove(); } };
  } });
}
