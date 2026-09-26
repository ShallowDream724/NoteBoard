import { useEffect, type RefObject } from 'react';
import type { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, NodeSelection, type Selection } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { observeNearby } from './nearViewport';
import { getCodeStructure, type CodeStructure, type CodeFold } from './codeBlockStructure';
import { createDisclosureTriangle } from '../../components/DisclosureTriangle';
import { INITIAL_CODE_GUTTERS, WINDOWED_CODE_LINES, visibleCodeLines } from './codeBlockViewport';
import { BLOCK_MOVE_META, type BlockMove } from './headingFolding';

type Owner = () => number | undefined;
interface Block { owner: Owner; position: number; node: Node; structure: CodeStructure; folded: Set<number>; active: boolean; visibleFrom: number; visibleTo: number }
interface State { blocks: Map<Owner, Block>; decorations: DecorationSet }
type Update = { owner: Owner; node?: Node; language?: string; active?: boolean; remove?: boolean } | { toggle: Owner; from: number }
  | { viewport: Array<{ owner: Owner; from: number; to: number }> };
const key = new PluginKey<State>('code-block-controls');

function selectionTouches(selection: Selection, position: number, fold: CodeFold): boolean {
  if (selection instanceof NodeSelection) return false;
  const from = position + 1 + fold.from, to = position + 1 + fold.to;
  return selection.empty ? selection.from > from && selection.from < to : selection.from < to && selection.to > from;
}

function toggleFold(view: EditorView, owner: Owner, from: number) {
  const block = key.getState(view.state)?.blocks.get(owner);
  const fold = block?.structure.folds.find(candidate => candidate.from === from);
  if (!block || !fold) return;
  const tr = view.state.tr;
  // A gutter click may collapse the range holding the caret. Park it at the
  // visible header first; arrow keys and search subsequently reveal hidden text.
  if (!block.folded.has(from) && selectionTouches(tr.selection, block.position, fold)) {
    tr.setSelection(TextSelection.create(tr.doc, block.position + 1 + from));
  }
  view.dispatch(tr.setMeta(key, { toggle: owner, from } satisfies Update).setMeta('addToHistory', false));
}

function button(view: EditorView, block: Block, fold: CodeFold, summary: boolean): HTMLElement {
  const element = document.createElement('button');
  const collapsed = block.folded.has(fold.from);
  element.type = 'button';
  element.className = summary ? 'nb-code-fold-summary' : 'nb-code-fold-toggle';
  if (summary) element.textContent = '···';
  else element.appendChild(createDisclosureTriangle(document));
  element.setAttribute('aria-label', `${collapsed ? '展开' : '折叠'}第 ${fold.line} 行代码`);
  element.setAttribute('aria-expanded', String(!collapsed));
  element.title = summary ? `展开 ${fold.endLine - fold.line} 行代码` : `${collapsed ? '展开' : '折叠'}代码段`;
  element.contentEditable = 'false';
  element.addEventListener('mousedown', event => event.preventDefault());
  element.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); toggleFold(view, block.owner, fold.from); });
  return element;
}

function blockDecorations(block: Block): Decoration[] {
  const result: Decoration[] = [], start = block.position + 1;
  // Nested folds retain their state, but only their outermost visible range
  // contributes DOM. This keeps hidden controls out of the keyboard sequence.
  const folds = block.structure.folds.filter(fold => block.folded.has(fold.from));
  const visibleFolds = folds.filter(fold => !folds.some(parent => parent.from < fold.from && parent.to >= fold.to));
  const foldByLine = new Map(block.structure.folds.map(fold => [fold.line, fold]));
  for (const line of block.active ? block.structure.lines.slice(block.visibleFrom, block.visibleTo) : []) {
    if (visibleFolds.some(fold => line.from > fold.from && line.from <= fold.to)) continue;
    const fold = foldByLine.get(line.number);
    result.push(Decoration.widget(start + line.from, view => {
      const gutter = document.createElement('span');
      gutter.className = 'nb-code-line-gutter'; gutter.contentEditable = 'false';
      const number = document.createElement('span'); number.className = 'nb-code-line-number';
      number.textContent = String(line.number); number.setAttribute('aria-hidden', 'true'); gutter.appendChild(number);
      if (fold) gutter.appendChild(button(view, block, fold, false));
      return gutter;
    }, { side: -1, key: `code-line:${block.position}:${line.number}:${fold ? `${fold.to}:${block.folded.has(fold.from)}` : ''}`, ignoreSelection: true, stopEvent: () => true }));
  }
  for (const fold of visibleFolds) {
    result.push(Decoration.inline(start + fold.from, start + fold.to, { class: 'nb-code-fold-hidden' }));
    result.push(Decoration.widget(start + fold.from, view => button(view, block, fold, true), {
      side: -1, key: `code-fold:${block.position}:${fold.from}:${fold.to}`, ignoreSelection: true, stopEvent: () => true,
    }));
  }
  return result;
}

export function createCodeBlockControlsPlugin(): Plugin<State> {
  const rememberedFolds = new WeakMap<Node, Set<number>>();
  return new Plugin<State>({
    key,
    state: {
      init: () => ({ blocks: new Map(), decorations: DecorationSet.empty }),
      apply(tr, previous) {
        const update = tr.getMeta(key) as Update | undefined;
        if (!tr.docChanged && !tr.selectionSet && !update) return previous;
        const blocks = new Map<Owner, Block>();
        let changed = false;
        const move = tr.getMeta(BLOCK_MOVE_META) as BlockMove | undefined;
        for (const [owner, old] of previous.blocks) {
          const position = move && old.position >= move.from && old.position < move.to
            ? move.inserted + old.position - move.from : tr.mapping.map(old.position, 1);
          // Edits in this block invalidate offsets immediately. Its NodeView
          // publishes fresh metadata, never hiding a newly edited source range.
          if (tr.doc.nodeAt(position) !== old.node) { changed = true; continue; }
          const folded = new Set([...old.folded].filter(from => {
            const fold = old.structure.folds.find(candidate => candidate.from === from)!;
            return !selectionTouches(tr.selection, position, fold);
          }));
          const altered = position !== old.position || folded.size !== old.folded.size;
          blocks.set(owner, altered ? { ...old, position, folded } : old); changed ||= altered;
        }
        if (update && 'viewport' in update) {
          for (const { owner, from, to } of update.viewport) {
            const block = blocks.get(owner);
            if (block && (block.visibleFrom !== from || block.visibleTo !== to)) {
              blocks.set(owner, { ...block, visibleFrom: from, visibleTo: to }); changed = true;
            }
          }
        } else if (update && 'toggle' in update) {
          const block = blocks.get(update.toggle);
          if (block) {
            const folded = new Set(block.folded);
            if (folded.has(update.from)) folded.delete(update.from); else folded.add(update.from);
            blocks.set(update.toggle, { ...block, folded }); changed = true;
          }
        } else if (update) {
          const position = update.owner();
          if (!update.remove && position !== undefined && update.node && tr.doc.nodeAt(position) === update.node) {
            const existing = blocks.get(update.owner);
            if (!existing || existing.node !== update.node) {
              if (update.active) {
                const structure = getCodeStructure(update.node.textContent, update.language ?? '');
                if (structure) blocks.set(update.owner, { owner: update.owner, position, node: update.node, structure, folded: rememberedFolds.get(update.node) ?? new Set(), active: true,
                  visibleFrom: 0, visibleTo: structure.lines.length > WINDOWED_CODE_LINES ? INITIAL_CODE_GUTTERS : structure.lines.length });
                changed = true;
              }
            } else if (existing.active !== !!update.active) {
              // Removing only the gutter preserves folded heights offscreen.
              if (!update.active && !existing.folded.size) blocks.delete(update.owner);
              else blocks.set(update.owner, { ...existing, active: !!update.active });
              changed = true;
            }
          } else changed = blocks.delete(update.owner) || changed;
        }
        if (!changed) return previous;
        for (const block of blocks.values()) rememberedFolds.set(block.node, block.folded);
        let decorations = previous.decorations.map(tr.mapping, tr.doc);
        for (const [owner, old] of previous.blocks) {
          if (blocks.get(owner) === old) continue;
          const from = tr.mapping.map(old.position + 1), to = tr.mapping.map(old.position + old.node.nodeSize - 1);
          decorations = decorations.remove(decorations.find(from, to));
        }
        for (const [owner, block] of blocks) {
          if (previous.blocks.get(owner) !== block) decorations = decorations.add(tr.doc, blockDecorations(block));
        }
        return { blocks, decorations };
      },
    },
    props: { decorations: state => key.getState(state)?.decorations },
    view(view) {
      const doc = view.dom.ownerDocument, win = doc.defaultView;
      let frame = 0;
      const schedule = () => {
        if (frame || !win) return;
        let needed = false;
        for (const block of key.getState(view.state)?.blocks.values() ?? []) {
          if (block.active && block.structure.lines.length > WINDOWED_CODE_LINES) { needed = true; break; }
        }
        if (!needed) return;
        frame = win.requestAnimationFrame(() => {
          frame = 0;
          const viewport: Array<{ owner: Owner; from: number; to: number }> = [];
          for (const block of key.getState(view.state)?.blocks.values() ?? []) {
            if (!block.active || block.structure.lines.length <= WINDOWED_CODE_LINES) continue;
            const range = visibleCodeLines(view, block.position, block.structure.lines);
            if (range && (range[0] !== block.visibleFrom || range[1] !== block.visibleTo)) viewport.push({ owner: block.owner, from: range[0], to: range[1] });
          }
          if (viewport.length) view.dispatch(view.state.tr.setMeta(key, { viewport } satisfies Update).setMeta('addToHistory', false));
        });
      };
      doc.addEventListener('scroll', schedule, true); win?.addEventListener('resize', schedule);
      const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
      resize?.observe(view.dom);
      return { update: schedule, destroy() { if (frame) win?.cancelAnimationFrame(frame); resize?.disconnect(); doc.removeEventListener('scroll', schedule, true); win?.removeEventListener('resize', schedule); } };
    },
  });
}

/** One shared observer entry per mounted block, no layout reads or document scan. */
export function useCodeBlockControls(editor: Editor, node: Node, getPos: Owner, language: string, element: RefObject<HTMLElement | null>, expanded: boolean) {
  useEffect(() => {
    if (!element.current) return;
    let timer: ReturnType<typeof setTimeout>;
    const publish = (near: boolean) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (editor.isDestroyed || !key.getState(editor.state)) return;
        editor.view.dispatch(editor.state.tr.setMeta(key, { owner: getPos, node, active: near && expanded, language } satisfies Update).setMeta('addToHistory', false));
        // Reuse the already bounded line index, without reading layout or
        // rescanning source. Keep the last gutter width while parked offscreen.
        const block = key.getState(editor.state)?.blocks.get(getPos);
        if (block && element.current) {
          element.current.style.setProperty('--nb-code-line-digits', String(Math.min(5, Math.max(2, String(block.structure.lines.length).length))));
        }
      }, near ? 40 : 0);
    };
    const stop = observeNearby(element.current, publish);
    return () => { clearTimeout(timer); stop(); };
  }, [editor, node, getPos, language, element, expanded]);
  useEffect(() => () => {
    queueMicrotask(() => {
      if (!editor.isDestroyed && key.getState(editor.state)?.blocks.has(getPos)) {
        editor.view.dispatch(editor.state.tr.setMeta(key, { owner: getPos, remove: true } satisfies Update).setMeta('addToHistory', false));
      }
    });
  }, [editor, getPos]);
}
