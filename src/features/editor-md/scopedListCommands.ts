import { CommandManager, commands as coreCommands, Extension, getNodeType, type RawCommands } from '@tiptap/core';
import { Fragment, type Node } from '@tiptap/pm/model';
import { EditorState, NodeSelection, TextSelection, type Selection, type Transaction } from '@tiptap/pm/state';
import { canJoin } from '@tiptap/pm/transform';
import { discreteTransaction } from './discreteEdit';
import { isList, isListItem } from './listItemActions';
import { listTypeConversion } from './listTypeConversion';

function closestList(selection: Selection) {
  if (selection instanceof NodeSelection && isList(selection.node)) return { node: selection.node, depth: selection.$from.depth + 1 };
  for (let depth = selection.$from.depth; depth; depth--) if (isList(selection.$from.node(depth))) return { node: selection.$from.node(depth), depth };
  return null;
}

function compatible(left: Node | null, right: Node | null) {
  if (!left || !right || left.type !== right.type) return false;
  if (right.type.name === 'orderedList' && right.attrs.numbering === 'restart') return false;
  for (const name of Object.keys(left.attrs)) if (name !== 'start' && name !== 'numbering' && JSON.stringify(left.attrs[name]) !== JSON.stringify(right.attrs[name])) return false;
  return left.type.name !== 'orderedList' || right.attrs.numbering === 'continue' || right.attrs.start === 1 || right.attrs.start === left.attrs.start + left.childCount;
}
function joinTargets(tr: Transaction, positions: number[]) {
  const mappingStart = tr.mapping.maps.length;
  for (const original of positions.sort((a, b) => b - a)) {
    let pos = tr.mapping.slice(mappingStart).map(original, -1), node = tr.doc.nodeAt(pos);
    if (!node || !isList(node)) continue;
    const before = tr.doc.resolve(pos).nodeBefore;
    if (compatible(before, node) && canJoin(tr.doc, pos)) { tr.join(pos); pos -= before!.nodeSize; node = tr.doc.nodeAt(pos)!; }
    const end = pos + node.nodeSize, after = tr.doc.resolve(end).nodeAfter;
    if (compatible(node, after) && canJoin(tr.doc, end)) tr.join(end);
  }
}

const toggleScopedList: RawCommands['toggleList'] = (listName, itemName, keepMarks, attributes = {}) => props => {
  const { state, tr, dispatch, editor } = props, selection = state.selection;
  if (!dispatch) {
    const isolated = EditorState.create({ schema: state.schema, doc: state.doc, selection, storedMarks: state.storedMarks });
    return new CommandManager({ editor, state: isolated }).commands.toggleList(listName, itemName, keepMarks, attributes);
  }
  if (selection.toJSON().type === 'cell') return false;
  const target = getNodeType(listName, state.schema), itemType = getNodeType(itemName, state.schema), current = closestList(selection);
  if (current?.node.type === target) {
    // Use the same row-scoped restoration as Ctrl+0/Backspace. The upstream
    // lift copies the old start into the suffix and loses continuation intent.
    if (selection.$to.depth >= current.depth && selection.$to.node(current.depth) === current.node
      || selection instanceof NodeSelection && isList(selection.node)) return props.commands.restoreParagraph();
  }
  const planner = listTypeConversion(selection, target, itemType, attributes);
  const plans: { pos: number; node: Node; nodes: Node[] }[] = [], paragraphs: { pos: number; node: Node }[] = [];
  let hasList = false;
  state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
    if (isList(node)) { hasList = true; const result = planner.rewrite(node, pos); if (result.changed) plans.push({ pos, node, nodes: result.nodes }); return false; }
    if (node.isTextblock) {
      if (selection.empty || selection.from < pos + node.nodeSize - 1 && selection.to > pos + 1) paragraphs.push({ pos, node });
      return false;
    }
  });
  if (!hasList) return coreCommands.toggleList(listName, itemName, keepMarks, attributes)(props);
  for (const { pos, node } of paragraphs) plans.push({ pos, node, nodes: [planner.paragraph(node)] });
  if (!plans.length || !planner.isValid()) return false;
  for (const plan of plans) {
    const at = state.doc.resolve(plan.pos);
    if (!at.parent.canReplace(at.index(), at.index() + 1, Fragment.fromArray(plan.nodes))) return false;
  }
  const textSelection = selection instanceof NodeSelection
    ? TextSelection.between(state.doc.resolve(selection.from + 1), state.doc.resolve(selection.to - 1)) : TextSelection.between(selection.$anchor, selection.$head);
  const anchor = textSelection.$anchor, head = textSelection.$head;
  const mappingStart = tr.mapping.maps.length, marks = state.storedMarks ?? selection.$from.marks();
  for (const plan of plans.sort((a, b) => b.pos - a.pos)) tr.replaceWith(plan.pos, plan.pos + plan.node.nodeSize, Fragment.fromArray(plan.nodes));
  const first = plans.at(-1)!, last = plans[0];
  const localMapping = () => tr.mapping.slice(mappingStart);
  const scan = () => ({ start: localMapping().map(first.pos, -1), end: localMapping().map(last.pos + last.node.nodeSize, 1) });
  const targetPositions: number[] = [];
  tr.doc.nodesBetween(scan().start, scan().end, (node, pos) => { if (planner.targets.has(node)) targetPositions.push(pos); });
  joinTargets(tr, targetPositions);
  let anchorPos: number | undefined, headPos: number | undefined, selectedPos: number | undefined;
  tr.doc.nodesBetween(scan().start, scan().end, (node, pos) => {
    if (node === anchor.parent || node === planner.blocks.get(anchor.parent)) anchorPos = pos + 1 + anchor.parentOffset;
    if (node === head.parent || node === planner.blocks.get(head.parent)) headPos = pos + 1 + head.parentOffset;
    if (selection instanceof NodeSelection && isListItem(selection.node) && isListItem(node) && node.firstChild === selection.node.firstChild) selectedPos = pos;
    if (selection instanceof NodeSelection && isList(selection.node) && isList(node) && node.childCount === selection.node.childCount && node.firstChild?.firstChild === selection.node.firstChild?.firstChild) selectedPos = pos;
    if (node.isTextblock) return false;
  });
  tr.setSelection(selectedPos !== undefined ? NodeSelection.create(tr.doc, selectedPos) : TextSelection.between(
    tr.doc.resolve(anchorPos ?? localMapping().map(selection.anchor)), tr.doc.resolve(headPos ?? localMapping().map(selection.head))));
  if (selection.empty && keepMarks) tr.ensureMarks(marks);
  discreteTransaction(tr); return true;
};

export const ScopedListCommands = Extension.create({
  name: 'scopedListCommands',
  priority: 80, // Commands merge in priority order; override the core toggle once.
  addCommands() { return { toggleList: toggleScopedList }; },
});
