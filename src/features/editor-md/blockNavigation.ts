import { Fragment, type Node, type ResolvedPos } from '@tiptap/pm/model';
import { NodeSelection, TextSelection, type EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { dispatchDiscreteEdit } from './discreteEdit';

/** Visible, selectable block stops. A collection is a container in the schema,
 * but behaves as one block while navigating between paragraphs. Hidden metadata
 * declares selectable:false in its schema, keeping that policy in one place. */
export function isNavigableBlock(node: Node | null | undefined): node is Node {
  return !!node && node.isBlock && NodeSelection.isSelectable(node)
    && (node.isAtom || node.type.name === 'imageCollection');
}

export function selectedNavigableBlock(state: EditorState): { node: Node; pos: number } | null {
  const selection = state.selection;
  if (!(selection instanceof NodeSelection) || !isNavigableBlock(selection.node)) return null;
  const at = selection.$from;
  for (let depth = at.depth; depth > 0; depth--) {
    if (at.node(depth).type.name === 'imageCollection') return { node: at.node(depth), pos: at.before(depth) };
  }
  return { node: selection.node, pos: selection.from };
}

function adjoiningBlock(at: ResolvedPos, direction: -1 | 1): { node: Node; pos: number } | null {
  if (!at.parent.isTextblock || at.depth < 1) return null;
  // Captions inside a collection belong to that collection, not a neighboring stop.
  for (let depth = at.depth; depth > 0; depth--) if (at.node(depth).type.name === 'imageSlot') return null;
  const boundary = direction === 1 ? at.after() : at.before();
  const outside = at.doc.resolve(boundary), node = direction === 1 ? outside.nodeAfter : outside.nodeBefore;
  return isNavigableBlock(node) ? { node, pos: direction === 1 ? boundary : boundary - node.nodeSize } : null;
}

/** Shared vertical navigation for diagram, formula, media and other atomic blocks. */
export function handleBlockNavigationKey(view: EditorView, event: KeyboardEvent, onlyType?: string): boolean {
  if (!view.editable || view.composing || event.defaultPrevented || event.isComposing
    || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
  if (!['ArrowUp', 'ArrowDown', 'Enter'].includes(event.key)) return false;
  const direction: -1 | 1 = event.key === 'ArrowUp' ? -1 : 1;
  const { state } = view, { selection } = state;
  const selected = selectedNavigableBlock(state);
  if (!selected) {
    if (event.key === 'Enter' || !(selection instanceof TextSelection) || !selection.empty) return false;
    const at = selection.$head;
    const target = adjoiningBlock(at, direction);
    if (!target || onlyType && target.node.type.name !== onlyType) return false;
    // Wrapped paragraphs must reach their first/last visual line before leaving.
    if (at.parentOffset !== (direction === 1 ? at.parent.content.size : 0)
      && !view.endOfTextblock(direction === 1 ? 'down' : 'up')) return false;
    view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, target.pos)).scrollIntoView());
    return true;
  }
  if (onlyType && selected.node.type.name !== onlyType) return false;
  if (event.key === 'Enter' && !['image', 'imageCollection'].includes(selected.node.type.name)) return false;
  const boundary = direction === 1 ? selected.pos + selected.node.nodeSize : selected.pos;
  const at = state.doc.resolve(boundary), next = direction === 1 ? at.nodeAfter : at.nodeBefore;
  const tr = state.tr;
  if (next?.isTextblock) tr.setSelection(TextSelection.create(tr.doc, direction === 1 ? boundary + 1 : boundary - 1));
  else if (event.key !== 'Enter' && isNavigableBlock(next)) {
    tr.setSelection(NodeSelection.create(tr.doc, direction === 1 ? boundary : boundary - next.nodeSize));
  } else {
    // Tables and rich containers retain their own navigation. At the end of a
    // container, add a paragraph so an atom never traps the writing cursor.
    if (event.key !== 'Enter' && next && next.type.name !== 'annotationStore') return false;
    if (next && next.type.name !== 'annotationStore') return false;
    const paragraph = state.schema.nodes.paragraph.create();
    if (!at.parent.canReplace(at.index(), at.index(), Fragment.from(paragraph))) return false;
    tr.insert(boundary, paragraph).setSelection(TextSelection.create(tr.doc, boundary + 1));
  }
  if (tr.docChanged) dispatchDiscreteEdit(view, tr.scrollIntoView()); else view.dispatch(tr.scrollIntoView());
  return true;
}
