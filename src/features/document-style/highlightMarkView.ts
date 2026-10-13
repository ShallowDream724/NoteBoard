import type { Mark } from '@tiptap/pm/model';
import { darkBackground } from './readableInk';

/** Mark views affect live DOM only; the schema serializer retains authored ink. */
export function createHighlightMarkView(mark: Mark, ownerDocument: Document = document) {
  const dom = ownerDocument.createElement('mark'), authored = typeof mark.attrs.color === 'string' && mark.attrs.color ? mark.attrs.color : null;
  const color = authored ?? '#fef08a';
  dom.className = 'nb-screen-fill';
  // A default/null highlight must stay null when ProseMirror reparses typed DOM.
  if (authored) { dom.dataset.color = authored; dom.style.backgroundColor = authored; }
  dom.style.color = 'inherit';
  dom.style.setProperty('--nb-fill-dark', darkBackground(color));
  return { dom, contentDOM: dom };
}
