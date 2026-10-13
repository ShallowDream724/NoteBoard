import type { EditorView } from '@tiptap/pm/view';
import type { EditorState } from '@tiptap/pm/state';
import type { DocumentBookmark } from './types';

/** Zero-height widgets stay outside node views. One observer aligns their buttons
 * with the actual block bounds, including centered/narrow media and tables. */
export function bindBlockBookmarkLayout(view: EditorView, recordsFor: (state: EditorState) => readonly DocumentBookmark[]) {
  const win = view.dom.ownerDocument.defaultView!;
  let frame = 0, disposed = false;
  let pairs: { marker: HTMLElement; block: HTMLElement }[] = [];
  const measure = () => {
    frame = 0;
    const placements = pairs.map(({ marker, block }) => {
      const anchor = marker.getBoundingClientRect(), bounds = block.getBoundingClientRect();
      return { marker, x: bounds.right - anchor.left - 24, y: bounds.top - anchor.top + 4 };
    });
    for (const { marker, x, y } of placements) {
      marker.style.setProperty('--bookmark-x', `${x}px`);
      marker.style.setProperty('--bookmark-y', `${y}px`);
    }
  };
  const schedule = () => { if (!disposed && !frame) frame = win.requestAnimationFrame(measure); };
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
  const refresh = () => {
    observer?.disconnect(); pairs = [];
    const widgets = new Map([...view.dom.querySelectorAll<HTMLElement>('.nb-bookmark-block-marker')].map(marker => [marker.dataset.bookmarkId, marker]));
    for (const record of recordsFor(view.state)) {
      const marker = widgets.get(record.id); if (!marker) continue;
      const block = view.nodeDOM(record.pos);
      if (block instanceof HTMLElement) { pairs.push({ marker, block }); observer?.observe(block); }
    }
    if (pairs.length) { observer?.observe(view.dom); schedule(); }
  };
  refresh();
  return { refresh, destroy() { disposed = true; win.cancelAnimationFrame(frame); observer?.disconnect(); pairs = []; } };
}
