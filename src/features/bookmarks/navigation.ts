import type { Editor } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { findScrollContainer } from '../../core/dom/scrollContainer';
import type { DocumentBookmark } from './model';

/** Scroll the owning document, never nested formula/table scrollports. */
export function navigateBookmark(editor: Editor, record: DocumentBookmark): boolean {
  if (editor.isDestroyed || record.missing) return false;
  const node = editor.state.doc.nodeAt(record.pos);
  if (!node?.isBlock) return false;
  const selection = node.isAtom && NodeSelection.isSelectable(node) ? NodeSelection.create(editor.state.doc, record.pos) :
    TextSelection.near(editor.state.doc.resolve(Math.min(record.pos + 1, editor.state.doc.content.size)));
  editor.view.dispatch(editor.state.tr.setSelection(selection).setMeta('addToHistory', false));
  const element = editor.view.nodeDOM(record.pos);
  if (!(element instanceof HTMLElement)) return false;
  const scroller = findScrollContainer(editor.view.dom);
  const bounds = scroller.getBoundingClientRect(), target = element.getBoundingClientRect();
  // For a tall block center its leading reading line, not its distant midpoint.
  const anchor = target.top + Math.min(target.height / 2, 24);
  const top = scroller.scrollTop + anchor - (bounds.top + bounds.height / 2);
  scroller.scrollTo({ top: Math.max(0, Math.min(Math.max(0, scroller.scrollHeight - scroller.clientHeight), top)), behavior: 'instant' });
  if (!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches && typeof element.animate === 'function') {
    element.animate([{ outline: '2px solid var(--editor-accent)', outlineOffset: '3px' },
      { outline: '2px solid transparent', outlineOffset: '3px' }], { duration: 750, easing: 'ease-out' });
  }
  return true;
}
