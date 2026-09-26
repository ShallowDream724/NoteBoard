import { useEffect, useState, type RefObject } from 'react';
import { Extension, type Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { observeNearby } from './nearViewport';
import { requestCodeHighlight, type CodeToken } from './codeHighlighting';

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
  let batch = batches.get(editor);
  if (!update.tokens.length && !batch?.updates.has(update.getPosition)
    && !key.getState(editor.state)?.find(update.position + 1, update.position + update.node.nodeSize - 1).length) return;
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
  // Unknown is different from offscreen. A surviving decoration set must not be
  // erased when a NodeView remounts before its first observer notification.
  const [near, setNear] = useState<boolean | null>(null);
  useEffect(() => element.current ? observeNearby(element.current, setNear) : undefined, []);
  useEffect(() => {
    if (near === null || !key.getState(editor.state)) return;
    let cancelled = false;
    let retries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const publish = (tokens: CodeToken[]) => {
      const position = getPos();
      if (cancelled || editor.isDestroyed || position === undefined || editor.state.doc.nodeAt(position) !== node) return;
      publishHighlight(editor, { position, node, tokens, getPosition: getPos });
    };
    const request = async () => {
      const result = await requestCodeHighlight(node.textContent, node.attrs.language ?? '', { signal: controller.signal });
      if (cancelled || editor.isDestroyed) return;
      if (result.status === 'ready') publish(result.tokens);
      else if (result.status === 'unavailable') {
        // Transient worker/queue failures are not valid empty highlighting. Keep
        // current mapped colors and retry while this same visible node survives.
        // A temporary queue/worker failure must not strand a visible block in
        // plain text until the user edits it. Retry with a capped backoff; the
        // effect cancels both work and timer when this node leaves nearby.
        const delays = [250, 1000, 4000, 15000, 30000];
        timer = setTimeout(() => { void request(); }, delays[Math.min(retries++, delays.length - 1)]);
      }
    };
    timer = setTimeout(() => { if (near) void request(); else publish([]); }, near ? 40 : 0);
    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, [editor, node, near]);
}
