import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { findScrollContainer } from '../../core/dom/scrollContainer';
import type { DocumentBookmark } from './model';
import { validRange } from './rangeAnchors';
import { BOOKMARK_FLASH_META } from './presentation';

/** Scroll the owning document, never nested formula/table scrollports. */
export function navigateBookmark(editor: Editor, record: DocumentBookmark): boolean {
  if (editor.isDestroyed || record.missing || !validRange(editor.state.doc, record)) return false;
  const range = record.kind === 'range', node = range ? null : editor.state.doc.nodeAt(record.pos);
  if (!range && !node?.isBlock) return false;
  const selection = TextSelection.near(editor.state.doc.resolve(Math.min(record.pos + (range ? 0 : 1), editor.state.doc.content.size)));
  const tr = editor.state.tr.setMeta(BOOKMARK_FLASH_META, record.id).setMeta('addToHistory', false);
  // Navigation never turns a media block into a persistent blue node selection.
  if (selection instanceof TextSelection) tr.setSelection(selection);
  editor.view.dispatch(tr);
  const dom = range ? editor.view.domAtPos(record.pos).node : editor.view.nodeDOM(record.pos);
  const element = dom instanceof HTMLElement ? dom : dom?.parentElement;
  if (!element) return false;
  // Disclosure openness is reading state; reuse its control without changing the document.
  for (let parent: HTMLElement | null = element; parent && parent !== editor.view.dom; parent = parent.parentElement) {
    if (parent.classList.contains('nb-disclosure')) parent.querySelector<HTMLButtonElement>(':scope > .nb-disclosure-header .nb-disclosure-toggle[aria-expanded="false"]')?.click();
  }
  const scroller = findScrollContainer(editor.view.dom);
  const bounds = scroller.getBoundingClientRect(), target = range ? editor.view.coordsAtPos(record.pos) : element.getBoundingClientRect();
  // For a tall block center its leading reading line, not its distant midpoint.
  const anchor = target.top + Math.min((target.bottom - target.top || (target as DOMRect).height) / 2, 24);
  const top = scroller.scrollTop + anchor - (bounds.top + bounds.height / 2);
  scroller.scrollTo({ top: Math.max(0, Math.min(Math.max(0, scroller.scrollHeight - scroller.clientHeight), top)), behavior: 'instant' });
  return true;
}
