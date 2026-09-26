import type { EditorView } from '@tiptap/pm/view';
import { findScrollContainer } from '../../core/dom/scrollContainer';

/** Explicit editor actions scroll only their owner, once, after the transaction.
 * Leading-edge reveal also handles blocks taller than the viewport without
 * pulling the user to the bottom of a newly inserted table or image. */
export function revealEditorBlock(view: EditorView, position: number, align: 'nearest' | 'start' = 'nearest'): HTMLElement | null {
  const block = view.nodeDOM(position);
  if (!(block instanceof HTMLElement)) return null;
  const scroller = findScrollContainer(view.dom);
  const bounds = scroller.getBoundingClientRect(), target = block.getBoundingClientRect();
  const inset = Math.min(40, bounds.height / 6);
  const isTable = view.state.doc.nodeAt(position)?.type.name === 'table';
  const lineHeight = isTable ? parseFloat(getComputedStyle(view.dom).lineHeight) : 0;
  const bottomInset = isTable && Number.isFinite(lineHeight) ? Math.min(lineHeight * 4, bounds.height / 3) : inset;
  let delta = 0;
  const tallTable = isTable && target.height > bounds.height - inset - bottomInset;
  if (align === 'start' || tallTable || target.top < bounds.top + inset) delta = target.top - bounds.top - inset;
  else if (target.height <= bounds.height - inset - bottomInset && target.bottom > bounds.bottom - bottomInset) {
    delta = target.bottom - bounds.bottom + bottomInset;
  } else if (target.top > bounds.bottom - inset) delta = target.top - bounds.top - inset;
  if (delta) scroller.scrollTo({ top: Math.max(0, scroller.scrollTop + delta), behavior: 'instant' });
  return scroller;
}
