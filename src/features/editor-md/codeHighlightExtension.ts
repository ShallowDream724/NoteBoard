import { useEffect, type RefObject } from 'react';
import { Extension, type Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { observeCodeVisibility } from './codeVisibility';
import { requestCodeHighlight, type CodeToken } from './codeHighlighting';
import { getCodeStructure, type CodeStructure } from './codeBlockStructure';
import { visibleCodeLines, WINDOWED_CODE_LINES } from './codeBlockViewport';
import { BLOCK_MOVE_META, type BlockMove } from './headingFolding';
import { Mapping, StepMap } from '@tiptap/pm/transform';

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
        const move = tr.getMeta(BLOCK_MOVE_META) as BlockMove | undefined;
        if (move) {
          const moved = previous.find(move.from, move.to);
          if (moved.length) {
            const shift = new Mapping([StepMap.offset(move.inserted - move.from)]);
            const transported = DecorationSet.create(tr.before, moved).map(shift, tr.doc);
            decorations = decorations.add(tr.doc, transported.find());
          }
        }
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
  useEffect(() => {
    if (!element.current || !key.getState(editor.state)) return;
    let cancelled = false, active = false, retries = 0;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    let tokens: CodeToken[] | undefined, structure: CodeStructure | null | undefined;
    let range: [number, number] = [0, node.content.size], published = '';
    const publish = (tokens: CodeToken[]) => {
      const position = getPos();
      if (cancelled || editor.isDestroyed || position === undefined || editor.state.doc.nodeAt(position) !== node) return;
      publishHighlight(editor, { position, node, tokens, getPosition: getPos });
    };
    const publishVisible = () => {
      if (!tokens || !active) return;
      const identity = `${range[0]}:${range[1]}`;
      if (published === identity) return;
      published = identity;
      // Tokenization remains in the worker; the main thread installs only a
      // bounded line window, including when a block contains 10,000 lines.
      let low = 0, high = tokens.length;
      while (low < high) { const mid = (low + high) >>> 1; if (tokens[mid].to <= range[0]) low = mid + 1; else high = mid; }
      const visible: CodeToken[] = [];
      for (let i = low; i < tokens.length && tokens[i].from < range[1]; i++) {
        const token = tokens[i]; visible.push({ ...token, from: Math.max(range[0], token.from), to: Math.min(range[1], token.to) });
      }
      publish(visible);
    };
    const request = async (current: AbortController) => {
      const result = await requestCodeHighlight(node.textContent, node.attrs.language ?? '', { signal: current.signal });
      if (cancelled || editor.isDestroyed || current.signal.aborted || !active) return;
      if (result.status === 'ready') { tokens = result.tokens; publishVisible(); }
      else if (result.status === 'unavailable') {
        // Transient worker/queue failures are not valid empty highlighting. Keep
        // current mapped colors and retry while this same visible node survives.
        // A temporary queue/worker failure must not strand a visible block in
        // plain text until the user edits it. Retry with a capped backoff; the
        // effect cancels both work and timer when this node leaves nearby.
        const delays = [250, 1000, 4000, 15000, 30000];
        timer = setTimeout(() => { void request(current); }, delays[Math.min(retries++, delays.length - 1)]);
      }
    };
    const stop = observeCodeVisibility(editor.view.dom, element.current, sample => {
      if (!sample.visible) {
        active = false; clearTimeout(timer); controller?.abort(); tokens = undefined; published = ''; publish([]); return;
      }
      if (structure === undefined) {
        structure = getCodeStructure(node.textContent, node.attrs.language ?? '');
        if (structure && structure.lines.length > WINDOWED_CODE_LINES) range = [0, structure.lines[WINDOWED_CODE_LINES - 1].to];
      }
      const position = getPos();
      const lines = structure && structure.lines.length > WINDOWED_CODE_LINES && position !== undefined
        ? visibleCodeLines(editor.view, position, structure.lines, sample.viewport) : undefined;
      if (lines && structure) range = [structure.lines[lines[0]].from, structure.lines[lines[1] - 1].to];
      if (!active) { active = true; retries = 0; controller = new AbortController(); void request(controller); }
      else publishVisible();
    });
    return () => { cancelled = true; clearTimeout(timer); controller?.abort(); stop(); };
  }, [editor, node, getPos, element]);
}
