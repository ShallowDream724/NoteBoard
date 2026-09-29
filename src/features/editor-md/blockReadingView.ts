import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import './blockReadingView.css';

export type BlockReadingMode = 'expand' | 'scroll' | 'wrap';
type ReadingChange = { pos: number; mode: BlockReadingMode };
export const blockReadingViewKey = new PluginKey<DecorationSet>('blockReadingView');

export function blockReadingMode(state: EditorState, pos: number): BlockReadingMode {
  return blockReadingViewKey.getState(state)?.find(pos, pos + 1).find(item => item.from === pos)?.spec.mode ?? 'expand';
}

export function setBlockReadingMode(editor: Editor, pos: number, mode: BlockReadingMode): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || !['table', 'mathBlock'].includes(node.type.name) || (mode === 'wrap' && node.type.name !== 'mathBlock')) return false;
  editor.view.dispatch(editor.state.tr.setMeta(blockReadingViewKey, { pos, mode } satisfies ReadingChange).setMeta('addToHistory', false));
  return true;
}

/** Reading choices belong to the live view, not document data or undo history.
 * Sparse decorations map with edits; only explicitly changed blocks cost state. */
export const BlockReadingView = Extension.create({
  name: 'blockReadingView',
  addProseMirrorPlugins: () => [new Plugin<DecorationSet>({
    key: blockReadingViewKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, value) {
        let next = tr.docChanged ? value.map(tr.mapping, tr.doc) : value;
        const change = tr.getMeta(blockReadingViewKey) as ReadingChange | undefined;
        if (!change) return next;
        next = next.remove(next.find(change.pos, change.pos + 1).filter(item => item.from === change.pos));
        const node = tr.doc.nodeAt(change.pos);
        return change.mode === 'expand' || !node ? next : next.add(tr.doc, [Decoration.node(change.pos, change.pos + node.nodeSize,
          { 'data-block-reading': change.mode }, { mode: change.mode })]);
      },
    },
    props: { decorations: state => blockReadingViewKey.getState(state) },
  })],
});
