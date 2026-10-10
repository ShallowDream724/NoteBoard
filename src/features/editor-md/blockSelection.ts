import type { Node, ResolvedPos } from '@tiptap/pm/model';
import { TextSelection, type EditorState } from '@tiptap/pm/state';
import { blockInteractionScope, isBlockInteractionTarget } from './blockInteractionScope';

export interface BlockSelectionItem {
  node: Node;
  pos: number;
  to: number;
  /** -1 denotes the document; otherwise the parent node's position. */
  parentPos: number;
}
export interface BlockSelection {
  /** Keep the exact user range and direction for text-formatting actions. */
  selection: TextSelection;
  /** Complete logical units, used only for block movement. */
  from: number;
  to: number;
  items: readonly BlockSelectionItem[];
  firstPos: number;
  count: number;
  /** -1 denotes the document; otherwise the first-level disclosure position. */
  scope: number;
}

function disclosureScope(at: ResolvedPos): number | null {
  let scope = -1;
  for (let depth = 1; depth <= at.depth; depth++) {
    if (at.node(depth).type.name !== 'disclosure') continue;
    if (scope !== -1) return null;
    scope = at.before(depth);
  }
  return scope;
}

/** Only inspect the selected interval. A list item's own body must overlap:
 * selecting nested siblings must not also select their unselected ancestor. */
export function resolveBlockSelection(state: EditorState): BlockSelection | null {
  const { doc, selection } = state;
  if (!(selection instanceof TextSelection) || selection.empty) return null;
  const startScope = disclosureScope(selection.$from), endScope = disclosureScope(selection.$to);
  if (startScope === null || endScope === null) return null;
  const scope = startScope === endScope ? startScope : -1;
  const items: BlockSelectionItem[] = [];
  const overlaps = (node: Node, pos: number): boolean => {
    if (selection.from >= pos + node.nodeSize || selection.to <= pos) return false;
    if (node.isTextblock) return node.content.size === 0 ? selection.from <= pos + 1 && selection.to > pos + 1
      : selection.from < pos + node.nodeSize - 1 && selection.to > pos + 1;
    if (!node.childCount) return selection.from < pos + node.nodeSize && selection.to > pos;
    let found = false;
    node.nodesBetween(Math.max(0, selection.from - pos - 1), Math.min(node.content.size, selection.to - pos - 1), (child, offset) => {
      if (child.isTextblock) {
        const start = pos + offset + 2;
        found ||= child.content.size === 0 ? selection.from <= start && selection.to > start
          : selection.from < pos + offset + child.nodeSize && selection.to > start;
        return false;
      }
      if (!child.childCount) found = true;
      return !found;
    });
    return found;
  };
  doc.nodesBetween(selection.from, selection.to, (node, pos) => {
    const at = doc.resolve(pos);
    if (!isBlockInteractionTarget(doc, pos) || blockInteractionScope(at) !== scope) return true;
    if (node.type.name === 'disclosure' && scope === pos) return true;
    if (['bulletList', 'orderedList', 'taskList'].includes(node.type.name)) return true;
    if (['listItem', 'taskItem'].includes(node.type.name)) {
      let ownBody = false;
      node.forEach((child, offset) => {
        if (!['bulletList', 'orderedList', 'taskList'].includes(child.type.name)) ownBody ||= overlaps(child, pos + offset + 1);
      });
      if (!ownBody) return true;
    } else if (!overlaps(node, pos)) return false;
    items.push({ node, pos, to: pos + node.nodeSize, parentPos: at.depth ? at.before(at.depth) : -1 });
    return false;
  });
  if (items.length < 2) return null;
  return { selection, from: items[0].pos, to: items[items.length - 1].to, items, firstPos: items[0].pos, count: items.length, scope };
}
