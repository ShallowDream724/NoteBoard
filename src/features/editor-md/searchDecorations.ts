import type { Range } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { searchAndReplacePluginKey, type SearchAndReplaceOptions, type SearchAndReplaceStorage } from '@sereneinserenade/tiptap-search-and-replace';
import { findScrollContainer } from '../../core/dom/scrollContainer';

export const currentSearchResultKey = new PluginKey<DecorationSet>('currentSearchResult');
const VIEWPORT = 'searchViewport';
const MAX_HIGHLIGHTS = 2000;
const OVERSCAN = 2000;

function visibleMatches(results: Range[], indexed: Uint32Array | undefined, from: number, to: number): Range[] {
  const count = indexed ? indexed.length / 2 : results.length;
  const at = (index: number): Range => indexed ? { from: indexed[index * 2], to: indexed[index * 2 + 1] } : results[index];
  let low = 0, high = count;
  while (low < high) { const mid = (low + high) >>> 1; if (at(mid).to < from) low = mid + 1; else high = mid; }
  const visible: Range[] = [];
  for (let index = low; index < count && at(index).from <= to && visible.length < MAX_HIGHLIGHTS; index++) visible.push(at(index));
  return visible;
}

function viewportSearch(view: EditorView, hasMatches: () => boolean) {
  let frame = 0, enabled = false;
  let observer: ResizeObserver | undefined;
  let scroller: HTMLElement | undefined;
  const update = () => {
    frame = 0;
    if (!enabled || view.isDestroyed || !view.dom.isConnected || view.dom.ownerDocument.visibilityState === 'hidden' || getComputedStyle(view.dom).visibility === 'hidden') return;
    const box = view.dom.getBoundingClientRect(), clip = scroller!.getBoundingClientRect();
    const left = Math.max(0, clip.left + 1, box.left + Math.min(20, box.width / 2));
    if (!box.width || !box.height) return;
    const top = Math.max(0, clip.top, box.top), bottom = Math.min(window.innerHeight, clip.bottom, box.bottom);
    if (bottom <= top) return;
    const from = view.posAtCoords({ left, top: top + 1 })?.pos ?? view.state.selection.from;
    const to = view.posAtCoords({ left, top: bottom - 1 })?.pos ?? view.state.selection.to;
    view.dispatch(view.state.tr.setMeta(VIEWPORT, { from: Math.max(0, from - OVERSCAN), to: Math.min(view.state.doc.content.size, to + OVERSCAN) }));
  };
  const schedule = () => { if (enabled && !frame) frame = requestAnimationFrame(update); };
  const stop = () => { enabled = false; cancelAnimationFrame(frame); frame = 0; observer?.disconnect(); observer = undefined; view.dom.ownerDocument.removeEventListener('scroll', schedule, true); };
  const sync = () => {
    if (!hasMatches() || !view.dom.isConnected) { if (enabled) stop(); return; }
    if (enabled) return;
    enabled = true; scroller = findScrollContainer(view.dom); view.dom.ownerDocument.addEventListener('scroll', schedule, true);
    observer = new ResizeObserver(schedule); observer.observe(view.dom); if (scroller !== view.dom) observer.observe(scroller); schedule();
  };
  sync();
  return { update(next: EditorView, previous: EditorState) { sync(); if (enabled && (next.state.doc !== previous.doc || !next.state.selection.eq(previous.selection))) schedule(); }, destroy: stop };
}

/** Text split by marks remains one searchable run. Inline atoms and block
 * boundaries terminate it, preserving the existing visual search semantics. */
export function searchTextRuns(doc: Node): Array<{ text: string; from: number }> {
  const runs: Array<{ text: string; from: number }> = [];
  let parts: string[] = [], from = 0;
  const flush = () => { if (parts.length) runs.push({ text: parts.join(''), from }); parts = []; };
  doc.descendants((node, pos) => {
    if (!node.isText) { flush(); return; }
    if (!parts.length) from = pos;
    parts.push(node.text!);
  });
  flush();
  return runs;
}

function findMatches(doc: Node, storage: SearchAndReplaceStorage, disableRegex: boolean): Range[] {
  const pattern = disableRegex ? storage.searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : storage.searchTerm;
  const regex = new RegExp(pattern, storage.caseSensitive ? 'gu' : 'gui');
  const results: Range[] = [];
  for (const { text, from } of searchTextRuns(doc)) {
    for (const match of text.matchAll(regex)) if (match[0].trim()) results.push({ from: from + match.index, to: from + match.index + match[0].length });
  }
  return results;
}

/** The broad match set is stable during navigation. A separate one-match layer
 * moves the current class without recreating every ordinary highlight. */
export function searchDecorationPlugins(storage: SearchAndReplaceStorage, options: SearchAndReplaceOptions): Plugin[] {
  let windowFrom = 0, windowTo = OVERSCAN * 2;
  let indexed: Uint32Array | undefined;
  const base = new Plugin<DecorationSet>({
    key: searchAndReplacePluginKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, previous) {
        const external = tr.getMeta(searchAndReplacePluginKey) as { ranges: Uint32Array } | undefined;
        const viewport = tr.getMeta(VIEWPORT) as { from: number; to: number } | undefined;
        const changed = external || tr.docChanged || storage.lastSearchTerm !== storage.searchTerm || storage.lastCaseSensitive !== storage.caseSensitive;
        const viewportChanged = viewport && (windowFrom !== viewport.from || windowTo !== viewport.to);
        if (!changed && !viewportChanged) return previous;
        if (viewport) { windowFrom = viewport.from; windowTo = viewport.to; }
        else if (tr.docChanged) { windowFrom = tr.mapping.map(windowFrom); windowTo = tr.mapping.map(windowTo); }
        if (changed) {
          storage.lastSearchTerm = storage.searchTerm; storage.lastCaseSensitive = storage.caseSensitive;
          indexed = external?.ranges;
          storage.results = !external && storage.searchTerm ? findMatches(tr.doc, storage, options.disableRegex) : [];
        }
        return DecorationSet.create(tr.doc, visibleMatches(storage.results, indexed, windowFrom, windowTo).map(result => Decoration.inline(result.from, result.to, { class: options.searchResultClass })));
      },
    },
    props: { decorations(state) { return this.getState(state); } },
    view: view => viewportSearch(view, () => !!(indexed?.length || storage.results.length)),
  });
  let current: Range | undefined;
  const active = new Plugin<DecorationSet>({
    key: currentSearchResultKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, previous) {
        const index = storage.resultIndex;
        const next = indexed && index >= 0 && index * 2 < indexed.length ? { from: indexed[index * 2], to: indexed[index * 2 + 1] } : storage.results[index];
        storage.lastResultIndex = storage.resultIndex;
        if (!tr.docChanged && next?.from === current?.from && next?.to === current?.to) return previous;
        current = next;
        return next ? DecorationSet.create(tr.doc, [Decoration.inline(next.from, next.to, { class: `${options.searchResultClass}-current` })]) : DecorationSet.empty;
      },
    },
    props: { decorations(state) { return this.getState(state); } },
  });
  return [base, active];
}
