import { Plugin, type EditorState } from '@tiptap/pm/state';
import type { Node } from '@tiptap/pm/model';
import { CellSelection } from '@tiptap/pm/tables';
import { findScrollContainer } from '../../core/dom/scrollContainer';

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
      const first = view.nodeDOM(selection.$anchorCell.pos), last = view.nodeDOM(selection.$headCell.pos);
      if (!(first instanceof Element) || !(last instanceof Element)) { overlay.hidden = true; return; }
      const a = first.getBoundingClientRect(), b = last.getBoundingClientRect(), clip = host.getBoundingClientRect();
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
