import { NodeSelection, Selection, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

/** Atom navigation follows document positions, independent of preview DOM or
 * whether the formula was loaded, inserted by an input rule, or just edited. */
export function handleMathKey(view: EditorView, event: KeyboardEvent, type: 'mathInline' | 'mathBlock'): boolean {
  if (!view.editable || view.composing || event.defaultPrevented || event.isComposing || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
  const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
  const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown';
  if (!horizontal && !vertical || type === 'mathInline' && !horizontal) return false;
  const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
  const { state } = view, { selection } = state;
  if (selection instanceof NodeSelection && selection.node.type.name === type) {
    const boundary = direction === 1 ? selection.to : selection.from;
    const next = type === 'mathInline'
      ? TextSelection.create(state.doc, boundary)
      : Selection.near(state.doc.resolve(boundary), direction);
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
  if (!vertical || !at.parent.isTextblock || !at.depth) return false;
  const boundary = direction === 1 ? at.after() : at.before();
  const outside = state.doc.resolve(boundary), node = direction === 1 ? outside.nodeAfter : outside.nodeBefore;
  if (node?.type.name !== type) return false;
  // A wrapped textblock must reach its last/first visual line before leaving.
  if (at.parentOffset !== (direction === 1 ? at.parent.content.size : 0) && !view.endOfTextblock(direction === 1 ? 'down' : 'up')) return false;
  const pos = direction === 1 ? boundary : boundary - node.nodeSize;
  view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)).scrollIntoView());
  return true;
}
