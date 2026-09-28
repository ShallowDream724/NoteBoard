import type { EditorView } from '@tiptap/pm/view';

export const COLLECTION_STEP_EVENT = 'nb-image-collection-step';

/** Paging belongs to the mounted view, never to document attributes/history. */
export function stepImageCollection(view: EditorView, pos: number, direction: 1 | -1): boolean {
  const dom = view.nodeDOM(pos);
  return dom instanceof HTMLElement && !dom.dispatchEvent(new CustomEvent(COLLECTION_STEP_EVENT, { detail: direction, cancelable: true }));
}
