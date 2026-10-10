import { Fragment, type Node } from '@tiptap/pm/model';
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { BlockSelection, BlockSelectionItem } from './blockSelection';
import { blockInteractionScope, isBlockInteractionTarget } from './blockInteractionScope';
import { isList, isListItem } from './listItemActions';
import { canInsertAtListBoundary, insertAtListBoundary } from './listBoundaryInsertion';
import { dispatchDiscreteEdit } from './discreteEdit';
import { BLOCK_MOVE_META, foldedSectionEnd } from './headingFolding';

interface SourceRange { from: number; to: number }
/** Immutable document references and fragments are prepared once per gesture. */
export interface BlockSelectionMovePlan {
  readonly doc: Node;
  readonly snapshot: BlockSelection;
  readonly effectiveFrom: number;
  readonly effectiveTo: number;
  readonly content: Fragment;
  readonly removals: readonly SourceRange[];
  readonly listItems: Fragment | null;
  readonly sourceList: Node | null;
  readonly headingOffsets: readonly { from: number; to: number; offset: number }[];
}

/** Normalize complete sibling runs. A selected descendant never takes its
 * unselected ancestor along; a fully emptied list loses its wrapper too. */
export function prepareBlockSelectionMove(state: EditorState, snapshot: BlockSelection): BlockSelectionMovePlan | null {
  const doc = state.doc, original = snapshot.items;
  if (original.length < 2 || snapshot.from !== original[0].pos || snapshot.to !== original[original.length - 1].to
    || snapshot.selection.$from.doc !== doc) return null;
  const items: BlockSelectionItem[] = [];
  // A folded heading is a logical section. Add only its direct blocks, keeping
  // hidden descendants intact and avoiding duplicates from the explicit range.
  for (const item of original) {
    if (items.length && item.pos < items[items.length - 1].to) continue;
    items.push(item);
    const end = foldedSectionEnd(state, item.pos);
    if (end && end > item.to) doc.nodesBetween(item.to, end, (node, pos) => {
      if (isBlockInteractionTarget(doc, pos)) items.push({ node, pos, to: pos + node.nodeSize, parentPos: -1 });
      return false;
    });
  }
  const content: Node[] = [], removals: SourceRange[] = [];
  const headingOffsets: Array<{ from: number; to: number; offset: number }> = [];
  let contentSize = 0;
  let onlyList: Node | null = null, singleList = true;
  try {
    for (let index = 0; index < items.length;) {
      const item = items[index], at = doc.resolve(item.pos);
      if (doc.nodeAt(item.pos) !== item.node || item.to !== item.pos + item.node.nodeSize
        || !isBlockInteractionTarget(doc, item.pos) || blockInteractionScope(at) !== snapshot.scope
        || item.parentPos !== (at.depth ? at.before(at.depth) : -1)
        || index && item.pos < items[index - 1].to) return null;
      if (!isListItem(item.node)) {
        singleList = false;
        if (item.node.type.name === 'heading' && !at.depth) headingOffsets.push({ from: item.pos, to: item.to, offset: contentSize });
        content.push(item.node); contentSize += item.node.nodeSize;
        removals.push({ from: item.pos, to: item.to }); index++; continue;
      }
      if (!isList(at.parent)) return null;
      const list = at.parent, run: BlockSelectionItem[] = [item];
      let next = index + 1;
      while (next < items.length && items[next].parentPos === item.parentPos && items[next].pos === run[run.length - 1].to) {
        const sibling = items[next];
        if (doc.nodeAt(sibling.pos) !== sibling.node || !isListItem(sibling.node)
          || sibling.to !== sibling.pos + sibling.node.nodeSize) return null;
        run.push(sibling); next++;
      }
      const whole = at.index() === 0 && run.length === list.childCount;
      const attrs = { ...list.attrs };
      if (list.type.name === 'orderedList') attrs.start = (attrs.start || 1) + at.index();
      // A retained wrapper owns its explanation. Copying that id would make two
      // independently editable sections refer to the same explanation.
      if (!whole && Object.hasOwn(attrs, 'annotationId')) attrs.annotationId = null;
      const wrapper = whole ? list : list.type.create(attrs, Fragment.fromArray(run.map(entry => entry.node)), list.marks);
      content.push(wrapper); contentSize += wrapper.nodeSize;
      removals.push(whole ? { from: at.before(), to: at.after() } : { from: item.pos, to: run[run.length - 1].to });
      if (onlyList && onlyList !== list) singleList = false;
      onlyList ??= list;
      index = next;
    }
    const merged: SourceRange[] = [];
    for (const range of removals) {
      const previous = merged[merged.length - 1];
      if (previous && range.from < previous.to) return null;
      if (previous && range.from === previous.to) previous.to = range.to;
      else merged.push({ ...range });
    }
    return { doc, snapshot, effectiveFrom: items[0].pos, effectiveTo: items[items.length - 1].to,
      content: Fragment.fromArray(content), removals: merged, headingOffsets,
      listItems: singleList && onlyList ? Fragment.fromArray(items.map(item => item.node)) : null,
      sourceList: singleList ? onlyList : null };
  } catch { return null; }
}

/** No slicing or whole-document walk on pointer movement. */
export function isBlockSelectionMoveAllowed(plan: BlockSelectionMovePlan, insertPos: number): boolean {
  const { doc, snapshot, content } = plan;
  if (!Number.isInteger(insertPos) || insertPos < 0 || insertPos > doc.content.size
    || insertPos >= plan.effectiveFrom && insertPos <= plan.effectiveTo
    || plan.removals.some(range => insertPos >= range.from && insertPos <= range.to)) return false;
  try {
    const at = doc.resolve(insertPos);
    if (blockInteractionScope(at) !== snapshot.scope) return false;
    if (insertPos === 0 && doc.firstChild?.type.name === 'documentPresentation') return false;
    if (isList(at.parent)) {
      if (plan.listItems && at.parent === plan.sourceList && at.parent.canReplace(at.index(), at.index(), plan.listItems)) return true;
      return canInsertAtListBoundary(doc, insertPos, content);
    }
    if (at.depth !== 0 && at.parent.type.name !== 'disclosure') return false;
    // Positions next to hidden bookkeeping nodes are valid only on their public
    // side; an annotation store is always the final, non-editable document tail.
    if (at.nodeBefore?.type.name === 'annotationStore' || at.nodeAfter?.type.name === 'documentPresentation') return false;
    return at.parent.canReplace(at.index(), at.index(), content);
  } catch { return false; }
}

function selectMovedContent(tr: Transaction, from: number, to: number, backwards: boolean): void {
  // Text endpoints cover whole logical units, including partial original rows.
  // For leading/trailing atoms retain the structural boundary so the selection
  // resolver continues to include those blocks on the next gesture.
  const first = TextSelection.findFrom(tr.doc.resolve(from), 1, true);
  const last = TextSelection.findFrom(tr.doc.resolve(to), -1, true);
  const start = first && first.from < to ? first.from : from;
  const end = last && last.to >= from ? last.to : to;
  const leading = tr.doc.nodeAt(from), trailing = tr.doc.resolve(to).nodeBefore;
  const anchor = leading?.isAtom ? from : start;
  const head = trailing?.isAtom || trailing?.isTextblock && !trailing.content.size ? to : end;
  tr.setSelection(TextSelection.create(tr.doc, backwards ? head : anchor, backwards ? anchor : head));
}

/** All removals and insertion share one undoable transaction. A stale gesture
 * cannot apply its positional plan to a newly edited document. */
export function moveBlockSelection(view: EditorView, plan: BlockSelectionMovePlan, insertPos: number): { insertedPos: number } | null {
  if (view.state.doc !== plan.doc || !isBlockSelectionMoveAllowed(plan, insertPos)) return null;
  try {
    const originalTarget = plan.doc.resolve(insertPos);
    const rawItems = originalTarget.parent === plan.sourceList ? plan.listItems : null;
    const tr = view.state.tr;
    for (let index = plan.removals.length - 1; index >= 0; index--) {
      const range = plan.removals[index]; tr.delete(range.from, range.to);
    }
    let insertedPos = tr.mapping.map(insertPos, -1);
    const fragment = rawItems ?? plan.content;
    if (rawItems) {
      const at = tr.doc.resolve(insertedPos);
      if (!isList(at.parent) || !at.parent.canReplace(at.index(), at.index(), rawItems)) return null;
      tr.insert(insertedPos, rawItems);
    } else {
      const split = insertAtListBoundary(tr, insertedPos, fragment);
      if (split === null) {
        const at = tr.doc.resolve(insertedPos);
        if (!at.parent.canReplace(at.index(), at.index(), fragment)) return null;
        tr.insert(insertedPos, fragment);
      } else insertedPos = split;
    }
    tr.doc.check();
    const range = plan.removals.length === 1 ? plan.removals[0] : null;
    if (plan.headingOffsets.length) tr.setMeta(BLOCK_MOVE_META, {
      from: range && range.to - range.from === fragment.size ? range.from : 0,
      to: range && range.to - range.from === fragment.size ? range.to : 0,
      inserted: insertedPos,
      ranges: plan.headingOffsets.map(heading => ({ from: heading.from, to: heading.to, inserted: insertedPos + heading.offset })),
    });
    selectMovedContent(tr, insertedPos, insertedPos + fragment.size, plan.snapshot.selection.anchor > plan.snapshot.selection.head);
    dispatchDiscreteEdit(view, tr.scrollIntoView()); view.focus();
    return { insertedPos };
  } catch { return null; }
}
