import type { EditorView } from '@tiptap/pm/view';
import type { EditorState } from '@tiptap/pm/state';
import type { DocumentBookmark } from './types';

/** Zero-height widgets stay outside node views. One observer aligns their buttons
 * with the actual block bounds, including centered/narrow media and tables. */
export function bindBlockBookmarkLayout(view: EditorView, recordsFor: (state: EditorState) => readonly DocumentBookmark[], widgets: ReadonlyMap<string, HTMLElement>) {
  const win = view.dom.ownerDocument.defaultView!;
  let frame = 0, disposed = false;
  let observed = new Set<HTMLElement>();
  const measure = () => {
    frame = 0;
    const next = new Set<HTMLElement>(), placements = [];
    for (const record of recordsFor(view.state)) {
      const marker = widgets.get(record.id); if (!marker) continue;
      const block = view.nodeDOM(record.pos); if (!(block instanceof HTMLElement)) continue;
      next.add(block);
      const anchor = marker.getBoundingClientRect(), bounds = block.getBoundingClientRect();
      placements.push({ marker, hidden: !block.getClientRects().length || !bounds.width || !bounds.height,
        x: bounds.right - anchor.left - 24, y: bounds.top - anchor.top + 4 });
    }
    for (const block of observed) if (!next.has(block)) observer?.unobserve(block);
    for (const block of next) if (!observed.has(block)) observer?.observe(block);
    observed = next;
    for (const { marker, hidden, x, y } of placements) {
      marker.style.visibility = hidden ? 'hidden' : '';
      marker.style.setProperty('--bookmark-x', `${x}px`);
      marker.style.setProperty('--bookmark-y', `${y}px`);
    }
  };
  const schedule = () => { if (!disposed && !frame) frame = win.requestAnimationFrame(measure); };
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
  const refresh = () => {
    if (widgets.size) { observer?.observe(view.dom); schedule(); }
    else { observer?.disconnect(); observed.clear(); }
  };
  refresh();
  return { refresh, destroy() { disposed = true; win.cancelAnimationFrame(frame); observer?.disconnect(); observed.clear(); } };
}
