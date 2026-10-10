import { Fragment, type Node } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { dispatchDiscreteEdit } from './discreteEdit';
import { blockInteractionScope } from './blockInteractionScope';
import { canInsertAtListBoundary, insertAtListBoundary } from './listBoundaryInsertion';
import { isList, isListItem } from './listKinds';

export { isList, isListItem } from './listKinds';

/** Removing the sole item removes its wrapper as well, never an empty filler. */
export function listItemRemovalRange(doc: Node, pos: number) {
  const at = doc.resolve(pos), node = doc.nodeAt(pos)!;
  return at.depth && isList(at.parent) && at.parent.childCount === 1
    ? { from: at.before(), to: at.after() } : { from: pos, to: pos + node.nodeSize };
}
function insertionNode(doc: Node, sourcePos: number, insertPos: number) {
  const source = doc.nodeAt(sourcePos), from = doc.resolve(sourcePos), to = doc.resolve(insertPos);
  const scope = blockInteractionScope(from);
  if (scope === null || scope !== blockInteractionScope(to)) return null;
  if (!isListItem(source) || !isList(from.parent)) return null;
  const whole = from.parent.childCount === 1;
  // Compatible rows merge, except when doing so would discard the sole source
  // wrapper's explanation. Incompatible rows keep their own list semantics.
  if (isList(to.parent) && to.parent.canReplaceWith(to.index(), to.index(), source!.type)
    && !(whole && from.parent.attrs.annotationId && to.parent !== from.parent)) return source!;
  const attrs = { ...from.parent.attrs };
  if (from.parent.type.name === 'orderedList') attrs.start = (attrs.start || 1) + from.index();
  if (!whole && Object.hasOwn(attrs, 'annotationId')) attrs.annotationId = null;
  const wrapper = from.parent.type.create(attrs, Fragment.from(source!), from.parent.marks);
  if (isList(to.parent)) return canInsertAtListBoundary(doc, insertPos, Fragment.from(wrapper)) ? wrapper : null;
  if (to.depth !== 0 && to.parent.type.name !== 'disclosure') return null;
  return to.parent.canReplaceWith(to.index(), to.index(), wrapper.type) ? wrapper : null;
}
export function canMoveListItem(doc: Node, sourcePos: number, insertPos: number) {
  if (!Number.isInteger(sourcePos) || !Number.isInteger(insertPos) || sourcePos < 0 || insertPos < 0
    || sourcePos > doc.content.size || insertPos > doc.content.size) return false;
  if (!isListItem(doc.nodeAt(sourcePos))) return false;
  const removed = listItemRemovalRange(doc, sourcePos);
  if (insertPos >= removed.from && insertPos <= removed.to) return false;
  try { return insertionNode(doc, sourcePos, insertPos) !== null; } catch { return false; }
}
export function moveListItem(view: EditorView, sourcePos: number, insertPos: number) {
  const { doc } = view.state;
  if (!canMoveListItem(doc, sourcePos, insertPos)) return null;
  try {
    const node = insertionNode(doc, sourcePos, insertPos)!;
    const removed = listItemRemovalRange(doc, sourcePos);
    const tr = view.state.tr.delete(removed.from, removed.to);
    let target = tr.mapping.map(insertPos, -1);
    const content = Fragment.from(node);
    const split = isList(node) ? insertAtListBoundary(tr, target, content) : null;
    if (split === null) {
      const at = tr.doc.resolve(target);
      if (!at.parent.canReplace(at.index(), at.index(), content)) return null;
      tr.insert(target, node);
    } else target = split;
    const insertedPos = target + (isList(node) ? 1 : 0);
    tr.doc.check();
    tr.setSelection(NodeSelection.create(tr.doc, insertedPos)).scrollIntoView();
    dispatchDiscreteEdit(view, tr); view.focus();
    return { insertedPos };
  } catch { return null; }
}
