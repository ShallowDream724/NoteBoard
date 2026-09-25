import { useEffect, useState, type RefObject } from 'react';
import { Extension, type Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { observeNearby } from './nearViewport';
import { highlightCode, type CodeToken } from './codeHighlighting';

const key = new PluginKey<DecorationSet>('code-token-colors');
interface Update { position: number; node: Node; tokens: CodeToken[]; getPosition: () => number | undefined }
interface Batch { updates: Map<Update['getPosition'], Update>; frame: number }
const batches = new WeakMap<Editor, Batch>();
const pluginViews = new WeakMap<Editor, object>();

function flushHighlights(editor: Editor, batch: Batch) {
  if (editor.isDestroyed) { batches.delete(editor); return; }
  const updates: Update[] = [];
  let tokenCount = 0;
  for (const [identity, update] of batch.updates) {
    if (updates.length && tokenCount + update.tokens.length > 4096) break;
    batch.updates.delete(identity);
    const position = update.getPosition();
    if (position === undefined || editor.state.doc.nodeAt(position) !== update.node) continue;
    updates.push({ ...update, position }); tokenCount += update.tokens.length;
  }
  if (batch.updates.size) batch.frame = requestAnimationFrame(() => flushHighlights(editor, batch));
  else batches.delete(editor);
  if (updates.length) editor.view.dispatch(editor.state.tr.setMeta(key, updates).setMeta('addToHistory', false));
}

function publishHighlight(editor: Editor, update: Update) {
  if (!update.tokens.length && !key.getState(editor.state)?.find(update.position + 1, update.position + update.node.nodeSize - 1).length) return;
  let batch = batches.get(editor);
  if (!batch) {
    batch = { updates: new Map(), frame: 0 }; batches.set(editor, batch);
    const scheduled = batch;
    batch.frame = requestAnimationFrame(() => flushHighlights(editor, scheduled));
  }
  batch.updates.set(update.getPosition, update);
}

export const CodeHighlight = Extension.create({
  name: 'codeHighlight',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({
    key,
    view: () => {
      const owner = {}; pluginViews.set(editor, owner);
      return { destroy() {
        // registerPlugin/unregisterPlugin recreates all plugin views. Its state
        // and node views survive, so their already requested first tokens must
        // survive too. Only a genuinely removed view owns final cancellation.
        queueMicrotask(() => {
          if (pluginViews.get(editor) !== owner) return;
          pluginViews.delete(editor);
          const batch = batches.get(editor);
          if (batch) { cancelAnimationFrame(batch.frame); batches.delete(editor); }
        });
      } };
    },
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
    })];
  },
});

export function useCodeHighlight(editor: Editor, node: Node, getPos: () => number | undefined, element: RefObject<HTMLElement | null>) {
  const [near, setNear] = useState(false);
  useEffect(() => element.current ? observeNearby(element.current, setNear) : undefined, []);
  useEffect(() => {
    if (!key.getState(editor.state)) return;
    let cancelled = false;
    const controller = new AbortController();
    const publish = (tokens: CodeToken[]) => {
      const position = getPos();
      if (cancelled || editor.isDestroyed || position === undefined || editor.state.doc.nodeAt(position) !== node) return;
      publishHighlight(editor, { position, node, tokens, getPosition: getPos });
    };
    const timer = setTimeout(() => {
      if (near) void highlightCode(node.textContent, node.attrs.language ?? '', { signal: controller.signal }).then(publish);
      else publish([]);
    }, near ? 40 : 0);
    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, [editor, node, near]);
}
