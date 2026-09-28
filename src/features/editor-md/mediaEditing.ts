import { Extension } from '@tiptap/core';
import { Fragment, type Node, type ResolvedPos } from '@tiptap/pm/model';
import { NodeSelection, Plugin, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { normalizeImageSlot } from './imageCaptions';
import { requestImageRemoval } from './imageRemoval';
import { dispatchDiscreteEdit } from './discreteEdit';
import { stepImageCollection } from './rich-content/collectionNavigation';
import './mediaEditing.css';

const media = (node: Node | null | undefined) => !!node && ['image', 'imageCollection'].includes(node.type.name);

function normalizeSlots(state: EditorState, transactions?: readonly Transaction[]): Transaction | null {
  const tr = state.tr, slots = new Map<number, Node>();
  const collect = (node: Node, pos: number) => {
    if (node.type.name !== 'imageSlot') return true;
    slots.set(pos, node);
    return false;
  };
  if (!transactions) state.doc.descendants(collect);
  else transactions.forEach((transaction, index) => {
    const subsequent = transactions.slice(index + 1).flatMap(next => next.mapping.maps);
    transaction.steps.forEach((step, stepIndex) => {
      const after = transaction.mapping.slice(stepIndex + 1);
      const map = (pos: number, bias: number) => subsequent.reduce((at, next) => next.map(at, bias), after.map(pos, bias));
      const scan = (from: number, to: number) => {
        const start = Math.max(0, Math.min(map(from, -1), state.doc.content.size));
        const end = Math.max(start, Math.min(map(to, 1), state.doc.content.size));
        state.doc.nodesBetween(start, Math.min(state.doc.content.size, Math.max(end, start + 1)), collect);
      };
      let touched = false;
      step.getMap().forEach((_oldStart, _oldEnd, from, to) => { touched = true; scan(from, to); });
      const attributes = step as unknown as { pos?: number; from?: number; to?: number };
      if (!touched && (attributes.pos !== undefined || attributes.from !== undefined)) scan(attributes.pos ?? attributes.from!, attributes.to ?? (attributes.pos ?? attributes.from!) + 1);
    });
  });
  for (const [pos, node] of [...slots].sort(([a], [b]) => a - b)) {
    const normalized = normalizeImageSlot(node);
    if (normalized !== node) tr.replaceWith(tr.mapping.map(pos), tr.mapping.map(pos + node.nodeSize), normalized);
  }
  return tr.docChanged ? tr : null;
}

/** Treat the collection as one vertical stop, never an invisible caret in a slot. */
function outerMedia(state: EditorState): { node: Node; pos: number } | null {
  const selection = state.selection;
  if (!(selection instanceof NodeSelection) || !media(selection.node)) return null;
  const at = selection.$from;
  for (let depth = at.depth; depth > 0; depth--) if (at.node(depth).type.name === 'imageCollection') return { node: at.node(depth), pos: at.before(depth) };
  return { node: selection.node, pos: selection.from };
}

function sibling(at: ResolvedPos, direction: 1 | -1) {
  if (!at.parent.isTextblock || at.depth < 1) return null;
  for (let depth = at.depth; depth > 0; depth--) if (at.node(depth).type.name === 'imageSlot') return null;
  const parent = at.node(-1), index = at.index(-1) + (direction === 1 ? 1 : -1);
  if (index < 0 || index >= parent.childCount) return null;
  const node = parent.child(index);
  return media(node) ? { node, pos: direction === 1 ? at.after() : at.before() - node.nodeSize } : null;
}

export function handleMediaKey(view: EditorView, event: KeyboardEvent): boolean {
  if (!view.editable || view.composing || event.defaultPrevented || event.isComposing || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
  const { state } = view, { selection } = state;
  if (['Backspace', 'Delete'].includes(event.key) && selection instanceof NodeSelection && selection.node.type.name === 'image') {
    void requestImageRemoval(view, selection.from); return true;
  }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    const selected = outerMedia(state);
    if (selected?.node.type.name !== 'imageCollection' || !stepImageCollection(view, selected.pos, event.key === 'ArrowLeft' ? -1 : 1)) return false;
    if (selection.from !== selected.pos) view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, selected.pos)));
    return true;
  }
  if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return false;
  const direction = event.key === 'ArrowUp' ? -1 : 1, selected = outerMedia(state);
  if (!selected) {
    if (event.key === 'Enter' || !selection.empty || !(selection instanceof TextSelection)) return false;
    const at = selection.$head;
    if (at.parentOffset !== (direction === 1 ? at.parent.content.size : 0)) return false;
    const target = sibling(at, direction); if (!target) return false;
    view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, target.pos)).scrollIntoView()); return true;
  }
  const boundary = direction === 1 ? selected.pos + selected.node.nodeSize : selected.pos;
  const at = state.doc.resolve(boundary), next = direction === 1 ? at.nodeAfter : at.nodeBefore;
  const tr = state.tr;
  if (next?.isTextblock) tr.setSelection(TextSelection.create(tr.doc, direction === 1 ? boundary + 1 : boundary - 1));
  else if (event.key !== 'Enter' && media(next)) tr.setSelection(NodeSelection.create(tr.doc, direction === 1 ? boundary : boundary - next!.nodeSize));
  else {
    // Existing tables, code, formulas and callouts keep their own arrow behavior.
    if (event.key !== 'Enter' && next && next.type.name !== 'annotationStore') return false;
    const paragraph = state.schema.nodes.paragraph.create();
    if (!at.parent.canReplace(at.index(), at.index(), Fragment.from(paragraph))) return true;
    tr.insert(boundary, paragraph).setSelection(TextSelection.create(tr.doc, boundary + 1));
  }
  if (tr.docChanged) dispatchDiscreteEdit(view, tr.scrollIntoView()); else view.dispatch(tr.scrollIntoView());
  return true;
}

/** Main editor and annotation drafts share media behavior, independent of React views. */
export function createMediaEditingPlugin(): Plugin {
  return new Plugin({
    props: { handleKeyDown: handleMediaKey },
    appendTransaction: (transactions, _old, state) => transactions.some(tr => tr.docChanged) ? normalizeSlots(state, transactions) : null,
    view(view) {
      // Normalize legacy documents on mount without adding an undo event.
      queueMicrotask(() => { if (!view.isDestroyed) { const tr = normalizeSlots(view.state); if (tr) view.dispatch(tr.setMeta('addToHistory', false)); } });
      return {};
    },
  });
}
export const MediaEditing = Extension.create({ name: 'mediaEditing', priority: 1200, addProseMirrorPlugins: () => [createMediaEditingPlugin()] });
