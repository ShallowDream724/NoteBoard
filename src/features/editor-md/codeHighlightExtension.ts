import { useEffect, useState, type RefObject } from 'react';
import { Extension, type Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { observeNearby } from './nearViewport';
import { highlightCode, type CodeToken } from './codeHighlighting';

const key = new PluginKey<DecorationSet>('code-token-colors');
interface Update { position: number; node: Node; tokens: CodeToken[] }
const batches = new WeakMap<Editor, Map<number, Update>>();

function publishHighlight(editor: Editor, update: Update) {
  if (!update.tokens.length && !key.getState(editor.state)?.find(update.position + 1, update.position + update.node.nodeSize - 1).length) return;
  let batch = batches.get(editor);
  if (!batch) {
    batch = new Map(); batches.set(editor, batch);
    requestAnimationFrame(() => {
      const current = batches.get(editor); batches.delete(editor);
      if (!editor.isDestroyed && current?.size) editor.view.dispatch(editor.state.tr.setMeta(key, [...current.values()]).setMeta('addToHistory', false));
    });
  }
  batch.set(update.position, update);
}

export const CodeHighlight = Extension.create({
  name: 'codeHighlight',
  addProseMirrorPlugins: () => [new Plugin({
    key,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, previous) {
        let decorations = previous.map(tr.mapping, tr.doc);
        const updates = tr.getMeta(key) as Update[] | undefined;
        for (const update of updates ?? []) {
          if (tr.doc.nodeAt(update.position) !== update.node) continue;
          const start = update.position + 1, end = start + update.node.content.size;
          decorations = decorations.remove(decorations.find(start, end));
          decorations = decorations.add(tr.doc, update.tokens.map(token => Decoration.inline(start + token.from, start + token.to, { class: token.className })));
        }
        return decorations;
      },
    },
    props: { decorations: state => key.getState(state) },
  })],
});

export function useCodeHighlight(editor: Editor, node: Node, getPos: () => number | undefined, element: RefObject<HTMLElement | null>) {
  const [near, setNear] = useState(false);
  useEffect(() => element.current ? observeNearby(element.current, setNear) : undefined, []);
  useEffect(() => {
    if (!key.getState(editor.state)) return;
    let cancelled = false;
    const publish = (tokens: CodeToken[]) => {
      const position = getPos();
      if (cancelled || editor.isDestroyed || position === undefined || editor.state.doc.nodeAt(position) !== node) return;
      publishHighlight(editor, { position, node, tokens });
    };
    const timer = setTimeout(() => {
      if (near) void highlightCode(node.textContent, node.attrs.language ?? '').then(publish);
      else publish([]);
    }, near ? 40 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [editor, node, near]);
}
