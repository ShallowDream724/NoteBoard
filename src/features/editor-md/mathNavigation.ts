import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { handleBlockNavigationKey } from './blockNavigation';

/** Atom navigation follows document positions, independent of preview DOM or
 * whether the formula was loaded, inserted by an input rule, or just edited. */
export function handleMathKey(view: EditorView, event: KeyboardEvent, type: 'mathInline' | 'mathBlock'): boolean {
  if (type === 'mathBlock') return handleBlockNavigationKey(view, event, type);
  if (!view.editable || view.composing || event.defaultPrevented || event.isComposing || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
  const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
  if (!horizontal) return false;
  const direction = event.key === 'ArrowLeft' ? -1 : 1;
  const { state } = view, { selection } = state;
  if (selection instanceof NodeSelection && selection.node.type.name === type) {
    const boundary = direction === 1 ? selection.to : selection.from;
    const next = TextSelection.create(state.doc, boundary);
    view.dispatch(state.tr.setSelection(next).scrollIntoView());
    return true;
  }
  if (!(selection instanceof TextSelection) || !selection.empty) return false;
  const at = selection.$head;
  if (type === 'mathInline') {
    const node = direction === 1 ? at.nodeAfter : at.nodeBefore;
    if (node?.type.name !== type) return false;
    const pos = direction === 1 ? at.pos : at.pos - node.nodeSize;
    view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)).scrollIntoView());
    return true;
  }
  return false;
}
