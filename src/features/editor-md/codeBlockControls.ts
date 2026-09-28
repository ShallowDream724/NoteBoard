import { useEffect, type RefObject } from 'react';
import type { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, NodeSelection, type Selection } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { observeCodeVisibility, type CodeVisibility } from './codeVisibility';
import { getCodeStructure, type CodeStructure, type CodeFold } from './codeBlockStructure';
import { createDisclosureTriangle } from '../../components/DisclosureTriangle';
import { INITIAL_CODE_GUTTERS, WINDOWED_CODE_LINES, visibleCodeLines } from './codeBlockViewport';
import { BLOCK_MOVE_META, type BlockMove } from './headingFolding';
import { afterCodeComposition } from './codeComposition';

type Owner = () => number | undefined;
interface Block { owner: Owner; position: number; node: Node; structure: CodeStructure; folded: Set<number>; active: boolean; visibleFrom: number; visibleTo: number }
interface State { blocks: Map<Owner, Block>; decorations: DecorationSet }
type BlockUpdate = { owner: Owner; node?: Node; language?: string; active?: boolean; remove?: boolean; structure?: CodeStructure; range?: [number, number] };
type Update = BlockUpdate | { updates: BlockUpdate[] } | { toggle: Owner; from: number };
const key = new PluginKey<State>('code-block-controls');
const batches = new WeakMap<Editor, Map<Owner, BlockUpdate>>();
const deferred = new WeakMap<Editor, () => void>();

function flushControls(editor: Editor) {
  if (editor.isDestroyed || !key.getState(editor.state)) { batches.delete(editor); return; }
  if (editor.view.composing) {
    if (!deferred.has(editor)) deferred.set(editor, afterCodeComposition(editor, () => {
      deferred.delete(editor);
      flushControls(editor);
    }));
    return;
  }
  const pending = batches.get(editor); batches.delete(editor);
  if (pending?.size) editor.view.dispatch(editor.state.tr.setMeta(key, { updates: [...pending.values()] } satisfies Update).setMeta('addToHistory', false));
}

function publishControls(editor: Editor, update: BlockUpdate) {
  let batch = batches.get(editor);
  if (!batch) {
    batch = new Map(); batches.set(editor, batch);
    queueMicrotask(() => flushControls(editor));
  }
  batch.set(update.owner, update);
}

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
  if (block.structure.lines.length > WINDOWED_CODE_LINES) {
    // Keep the large plain tail in stable small DOM text runs. Replacing a single
    // 10,000-line text node makes Chromium reserialize its entire accessibility
    // inline-text tree on each visible-gutter/token update (hundreds of ms).
    const chunkLines = WINDOWED_CODE_LINES;
    for (let line = 0; line < block.structure.lines.length; line += chunkLines) {
      const from = block.structure.lines[line].from;
      const to = block.structure.lines[line + chunkLines]?.from ?? block.node.content.size;
      if (to > from) result.push(Decoration.inline(start + from, start + to, { 'data-code-chunk': String(line / chunkLines) }));
    }
  }
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
  let view: EditorView | undefined;
  return new Plugin<State>({
    key,
    view: current => { view = current; return { destroy: () => { if (view === current) view = undefined; } }; },
    state: {
      init: () => ({ blocks: new Map(), decorations: DecorationSet.empty }),
      apply(tr, previous) {
        const update = tr.getMeta(key) as Update | undefined;
        if (!tr.docChanged && !tr.selectionSet && !update) return previous;
        if (view?.composing && tr.docChanged && !update) {
          // Keep the already rendered presentation stable while the browser owns
          // the preedit DOM. The NodeView publishes final metadata on completion.
          const blocks = new Map<Owner, Block>();
          for (const [owner, block] of previous.blocks) {
            const position = tr.mapping.map(block.position, 1);
            if (tr.doc.nodeAt(position)?.type === block.node.type) blocks.set(owner, { ...block, position });
          }
          return { blocks, decorations: previous.decorations.map(tr.mapping, tr.doc) };
        }
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
        if (update && 'toggle' in update) {
          const block = blocks.get(update.toggle);
          if (block) {
            const folded = new Set(block.folded);
            if (folded.has(update.from)) folded.delete(update.from); else folded.add(update.from);
            blocks.set(update.toggle, { ...block, folded }); changed = true;
          }
        } else if (update) {
          for (const item of 'updates' in update ? update.updates : [update]) {
            const position = item.owner();
            if (!item.remove && position !== undefined && item.node && tr.doc.nodeAt(position) === item.node) {
              const existing = blocks.get(item.owner);
              if (!existing || existing.node !== item.node) {
                if (item.active) {
                  const structure = item.structure ?? getCodeStructure(item.node.textContent, item.language ?? '');
                  if (structure) blocks.set(item.owner, { owner: item.owner, position, node: item.node, structure, folded: rememberedFolds.get(item.node) ?? new Set(), active: true,
                    visibleFrom: item.range?.[0] ?? 0, visibleTo: item.range?.[1] ?? (structure.lines.length > WINDOWED_CODE_LINES ? INITIAL_CODE_GUTTERS : structure.lines.length) });
                  changed = true;
                }
              } else if (existing.active !== !!item.active || (item.range && (item.range[0] !== existing.visibleFrom || item.range[1] !== existing.visibleTo))) {
                // Keep folded heights and stable long-code text runs offscreen.
                if (!item.active && !existing.folded.size && existing.structure.lines.length <= WINDOWED_CODE_LINES) blocks.delete(item.owner);
                else blocks.set(item.owner, { ...existing, active: !!item.active, visibleFrom: item.range?.[0] ?? existing.visibleFrom, visibleTo: item.range?.[1] ?? existing.visibleTo });
                changed = true;
              }
            } else changed = blocks.delete(item.owner) || changed;
          }
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
  });
}

/** One shared geometry service per editor; gutters never wait for syntax work. */
export function useCodeBlockControls(editor: Editor, node: Node, getPos: Owner, language: string, element: RefObject<HTMLElement | null>, expanded: boolean) {
  useEffect(() => {
    if (!element.current) return;
    let structure: CodeStructure | null | undefined;
    let resume: (() => void) | undefined;
    let latestSample: CodeVisibility;
    const onVisibility = ({ visible, viewport }: CodeVisibility) => {
      latestSample = { visible, viewport };
      if (editor.view.composing) {
        resume ??= afterCodeComposition(editor, () => { resume = undefined; onVisibility(latestSample); });
        return;
      }
      if (editor.isDestroyed || !key.getState(editor.state)) return;
      const active = visible && expanded, existing = key.getState(editor.state)?.blocks.get(getPos);
      if (active && structure === undefined) structure = existing?.structure ?? getCodeStructure(node.textContent, language);
      const position = getPos();
      const range = active && structure && structure.lines.length > WINDOWED_CODE_LINES && position !== undefined
        ? visibleCodeLines(editor.view, position, structure.lines, viewport) : undefined;
      if (existing?.node === node && existing.active === active && (!range || (range[0] === existing.visibleFrom && range[1] === existing.visibleTo))) return;
      if (!active && !existing) return;
      publishControls(editor, { owner: getPos, node, active, language, structure: structure ?? undefined, range });
      if (structure && element.current) {
        element.current.style.setProperty('--nb-code-line-digits', String(Math.min(5, Math.max(2, String(structure.lines.length).length))));
      }
    };
    const stop = observeCodeVisibility(editor.view.dom, element.current, onVisibility);
    return () => { resume?.(); stop(); };
  }, [editor, node, getPos, language, element, expanded]);
  useEffect(() => () => {
    queueMicrotask(() => {
      if (!editor.isDestroyed && key.getState(editor.state)?.blocks.has(getPos)) {
        publishControls(editor, { owner: getPos, remove: true });
      }
    });
  }, [editor, getPos]);
}
