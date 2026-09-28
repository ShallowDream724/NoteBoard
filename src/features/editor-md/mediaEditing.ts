import { Extension } from '@tiptap/core';
import { type Node } from '@tiptap/pm/model';
import { NodeSelection, Plugin, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { normalizeImageSlot } from './imageCaptions';
import { requestImageRemoval } from './imageRemoval';
import { stepImageCollection } from './rich-content/collectionNavigation';
import { handleBlockNavigationKey, selectedNavigableBlock } from './blockNavigation';
import './mediaEditing.css';

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

export function handleMediaKey(view: EditorView, event: KeyboardEvent): boolean {
  if (!view.editable || view.composing || event.defaultPrevented || event.isComposing || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
  const { state } = view, { selection } = state;
  if (['Backspace', 'Delete'].includes(event.key) && selection instanceof NodeSelection && selection.node.type.name === 'image') {
    void requestImageRemoval(view, selection.from); return true;
  }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    const selected = selectedNavigableBlock(state);
    if (selected?.node.type.name !== 'imageCollection' || !stepImageCollection(view, selected.pos, event.key === 'ArrowLeft' ? -1 : 1)) return false;
    if (selection.from !== selected.pos) view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, selected.pos)));
    return true;
  }
  return handleBlockNavigationKey(view, event);
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
