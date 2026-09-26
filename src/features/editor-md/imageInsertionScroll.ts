import type { EditorView } from '@tiptap/pm/view';

/** Reveal the image's leading edge once, without following its asynchronous
 * decoded height or dragging the old text caret to the bottom of a large image. */
export function revealInsertedImage(view: EditorView, position: number): void {
  const scroller = view.dom.closest<HTMLElement>('[data-editor-scroll="markdown"]');
  const image = view.nodeDOM(position);
  if (!scroller || !(image instanceof HTMLElement)) return;
  const bounds = scroller.getBoundingClientRect(), top = image.getBoundingClientRect().top;
  const inset = Math.min(48, bounds.height / 6);
  if (top < bounds.top + inset || top > bounds.bottom - Math.min(112, bounds.height / 3)) {
    scroller.scrollTop += top - bounds.top - inset;
  }
}
