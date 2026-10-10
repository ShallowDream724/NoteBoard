import { Fragment, type Node } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { isList } from './listItemActions';

/** Only item boundaries qualify. Text/cell/code positions remain invalid. */
function boundary(doc: Node, pos: number) {
  const at = doc.resolve(pos);
  if (!at.depth || !isList(at.parent)) return null;
  const list = at.parent, index = at.index(), parent = at.node(-1), slot = at.index(-1);
  if (!['doc', 'disclosure', 'listItem', 'taskItem'].includes(parent.type.name)) return null;
  return { at, list, index, parent, slot, from: at.before(), to: at.after() };
}

/** Validation reuses the existing wrapper as a type placeholder: pointer
 * movement does not copy/partition a thousand-item list on every frame. */
export function canInsertAtListBoundary(doc: Node, pos: number, content: Fragment): boolean {
  const target = boundary(doc, pos);
  if (!target) return false;
  const nodes: Node[] = [];
  if (target.index) nodes.push(target.list);
  content.forEach(node => nodes.push(node));
  if (target.index < target.list.childCount) nodes.push(target.list);
  return target.parent.canReplace(target.slot, target.slot + 1, Fragment.fromArray(nodes));
}

/** Partition once on drop, outside the list shell. A new ordered section starts
 * at 1; a wrapper explanation belongs to the first retained section only. */
export function insertAtListBoundary(tr: Transaction, pos: number, content: Fragment): number | null {
  const target = boundary(tr.doc, pos);
  if (!target || !canInsertAtListBoundary(tr.doc, pos, content)) return null;
  const offset = target.at.parentOffset, nodes: Node[] = [];
  let inserted = target.from;
  if (target.index) {
    const prefix = target.list.copy(target.list.content.cut(0, offset));
    nodes.push(prefix); inserted += prefix.nodeSize;
  }
  content.forEach(node => nodes.push(node));
  if (target.index < target.list.childCount) {
    const attrs = { ...target.list.attrs };
    if (target.index) {
      if (target.list.type.name === 'orderedList') attrs.start = 1;
      if (Object.hasOwn(attrs, 'annotationId')) attrs.annotationId = null;
    }
    nodes.push(target.list.type.create(attrs, target.list.content.cut(offset), target.list.marks));
  }
  tr.replaceWith(target.from, target.to, Fragment.fromArray(nodes));
  return inserted;
}
