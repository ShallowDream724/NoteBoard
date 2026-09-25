import { Fragment, type Node } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { dispatchDiscreteEdit } from './discreteEdit';

export const isListItem = (node: Node | null | undefined) => node?.type.name === 'listItem' || node?.type.name === 'taskItem';
export const isList = (node: Node) => ['bulletList', 'orderedList', 'taskList'].includes(node.type.name);

/** Removing the sole item removes its wrapper as well, never an empty filler. */
export function listItemRemovalRange(doc: Node, pos: number) {
  const at = doc.resolve(pos), node = doc.nodeAt(pos)!;
  return at.depth && isList(at.parent) && at.parent.childCount === 1
    ? { from: at.before(), to: at.after() } : { from: pos, to: pos + node.nodeSize };
}
function insertionNode(doc: Node, sourcePos: number, insertPos: number) {
  const source = doc.nodeAt(sourcePos), from = doc.resolve(sourcePos), to = doc.resolve(insertPos);
  if (!isListItem(source) || !isList(from.parent)) return null;
  if (isList(to.parent)) return to.parent.canReplaceWith(to.index(), to.index(), source!.type) ? source! : null;
  if (to.depth !== 0) return null;
  const attrs = { ...from.parent.attrs };
  if (from.parent.type.name === 'orderedList') attrs.start = (attrs.start || 1) + from.index();
  const wrapper = from.parent.type.create(attrs, Fragment.from(source!));
  return to.parent.canReplaceWith(to.index(), to.index(), wrapper.type) ? wrapper : null;
}
export function canMoveListItem(doc: Node, sourcePos: number, insertPos: number) {
  if (!isListItem(doc.nodeAt(sourcePos))) return false;
  const removed = listItemRemovalRange(doc, sourcePos);
  if (insertPos >= removed.from && insertPos <= removed.to) return false;
  return insertionNode(doc, sourcePos, insertPos) !== null;
}
export function moveListItem(view: EditorView, sourcePos: number, insertPos: number) {
  const { doc } = view.state;
  if (!canMoveListItem(doc, sourcePos, insertPos)) return null;
  const node = insertionNode(doc, sourcePos, insertPos)!;
  const removed = listItemRemovalRange(doc, sourcePos);
  const tr = view.state.tr.delete(removed.from, removed.to);
  const target = tr.mapping.map(insertPos);
  tr.insert(target, node);
  const insertedPos = target + (isList(node) ? 1 : 0);
  tr.setSelection(NodeSelection.create(tr.doc, insertedPos)).scrollIntoView();
  dispatchDiscreteEdit(view, tr); view.focus();
  return { insertedPos };
}
