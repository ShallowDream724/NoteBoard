import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { createDisclosureTriangle } from '../../components/DisclosureTriangle';
import './headingFolding.css';

/** View state only: Markdown and exported/printed documents always contain the section. */
interface FoldingState { decorations: DecorationSet; folds: Set<number> }
export const headingFoldingKey = new PluginKey<FoldingState>('noteboard-heading-folding');
export const BLOCK_MOVE_META = 'noteboard-block-move';
export interface BlockMove { from: number; to: number; inserted: number; ranges?: readonly { from: number; to: number; inserted: number }[] }
const sectionIndexes = new WeakMap<PMNode, Map<number, number>>();
function sectionIndex(doc: PMNode) {
  let result = sectionIndexes.get(doc);
  if (result) return result;
  result = new Map();
  const stack: Array<{ pos: number; level: number }> = [];
  doc.forEach((node, pos) => {
    if (node.type.name !== 'heading') return;
    while (stack.length && stack[stack.length - 1].level >= node.attrs.level) result!.set(stack.pop()!.pos, pos);
    stack.push({ pos, level: node.attrs.level });
  });
  for (const entry of stack) result.set(entry.pos, doc.content.size);
  sectionIndexes.set(doc, result); return result;
}

export function headingSectionEnd(doc: PMNode, pos: number): number {
  const heading = doc.nodeAt(pos);
  if (heading?.type.name !== 'heading' || doc.resolve(pos).depth !== 0) return pos + (heading?.nodeSize ?? 0);
  if (doc.childCount >= 128) return sectionIndex(doc).get(pos) ?? pos + heading.nodeSize;
  let end = pos + heading.nodeSize;
  for (let index = doc.resolve(pos).index() + 1; index < doc.childCount; index++) {
    const child = doc.child(index);
    if (child.type.name === 'heading' && child.attrs.level <= heading.attrs.level) break;
    end += child.nodeSize;
  }
  return end;
}

export function foldedSectionEnd(state: EditorState, pos: number): number | undefined {
  return headingFoldingKey.getState(state)?.folds.has(pos) ? headingSectionEnd(state.doc, pos) : undefined;
}

function headingButton(pos: number, folded: boolean): Decoration {
  return Decoration.widget(pos + 1, (view, getPos) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nb-heading-fold-toggle';
    button.setAttribute('aria-label', folded ? '展开章节' : '折叠章节');
    button.setAttribute('aria-expanded', String(!folded));
    button.appendChild(createDisclosureTriangle(button.ownerDocument));
    button.onpointerdown = event => event.preventDefault();
    button.onclick = event => {
      event.preventDefault();
      const at = getPos();
      if (at !== undefined) toggleHeadingFold(view.state, view.dispatch, at - 1);
      view.focus();
    };
    return button;
  }, { key: `heading-fold-${pos}-${folded}`, side: -1, folded, headingToggle: true, stopEvent: () => true });
}

function rebuild(doc: PMNode, folds: Set<number>): FoldingState {
  const decorations: Decoration[] = [];
  // A stack of heading levels finds all hidden descendants in one pass.
  const levels: number[] = [];
  doc.forEach((node, pos) => {
    if (node.type.name === 'heading') {
      while (levels.length && node.attrs.level <= levels[levels.length - 1]) levels.pop();
      decorations.push(headingButton(pos, folds.has(pos)));
    }
    if (levels.length) decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'nb-heading-fold-hidden' }));
    if (node.type.name === 'heading' && folds.has(pos)) levels.push(node.attrs.level);
  });
  return { decorations: DecorationSet.create(doc, decorations), folds };
}

/** Table sizing/colour changes preserve top-level section boundaries. */
function sameSections(before: PMNode, after: PMNode): boolean {
  if (before.childCount !== after.childCount) return false;
  for (let i = 0; i < before.childCount; i++) {
    const a = before.child(i), b = after.child(i);
    if (a !== b && (a.nodeSize !== b.nodeSize || a.type !== b.type || a.type.name === 'heading' && a.attrs.level !== b.attrs.level)) return false;
  }
  return true;
}

/** Inline typing only maps decorations; structure changes rebuild the affected view outline. */
function onlyInlineChanges(tr: Transaction): boolean {
  return tr.steps.every((step, index) => {
    let inline = true;
    let mapped = false;
    const before = tr.docs[index], after = index + 1 < tr.docs.length ? tr.docs[index + 1] : tr.doc;
    step.getMap().forEach((a, b, c, d) => {
      mapped = true;
      const oldFrom = before.resolve(a), oldTo = before.resolve(b);
      const newFrom = after.resolve(c), newTo = after.resolve(d);
      if (!oldFrom.sameParent(oldTo) || !newFrom.sameParent(newTo)
        || !oldFrom.parent.isTextblock || !newFrom.parent.isTextblock
        || !oldFrom.parent.sameMarkup(newFrom.parent)) inline = false;
    });
    // Attribute-only heading changes have an empty map but alter section boundaries.
    return inline && mapped;
  });
}

export function toggleHeadingFold(state: EditorState, dispatch: (tr: Transaction) => void, pos: number): void {
  const heading = state.doc.nodeAt(pos);
  if (heading?.type.name !== 'heading') return;
  const tr = state.tr.setMeta(headingFoldingKey, pos).setMeta('addToHistory', false);
  const end = headingSectionEnd(state.doc, pos);
  if (state.selection.to > pos + heading.nodeSize && state.selection.from < end) {
    tr.setSelection(TextSelection.create(state.doc, pos + 1));
  }
  dispatch(tr);
}

export const HeadingFolding = Extension.create({
  name: 'headingFolding',
  addProseMirrorPlugins() {
    return [new Plugin<FoldingState>({
      key: headingFoldingKey,
      state: {
        init: (_, state) => rebuild(state.doc, new Set()),
        apply(tr, previous) {
          const toggle = tr.getMeta(headingFoldingKey) as number | undefined;
          if (!tr.docChanged && toggle === undefined) {
            if (!tr.selectionSet) return previous;
            if (!previous.folds.size) return previous;
            const visible = [...previous.folds].filter(pos => {
              const start = pos + (tr.doc.nodeAt(pos)?.nodeSize ?? 0);
              return tr.selection.from < start || tr.selection.from >= headingSectionEnd(tr.doc, pos);
            });
            return visible.length === previous.folds.size ? previous : rebuild(tr.doc, new Set(visible));
          }
          if (toggle !== undefined) {
            const folds = new Set(previous.folds);
            if (folds.has(toggle)) folds.delete(toggle); else folds.add(toggle);
            return rebuild(tr.doc, folds);
          }
          if (onlyInlineChanges(tr)) return { decorations: previous.decorations.map(tr.mapping, tr.doc),
            folds: new Set([...previous.folds].map(pos => tr.mapping.map(pos, 1))) };
          if (!tr.getMeta(BLOCK_MOVE_META) && sameSections(tr.before, tr.doc)) return previous;
          const move = tr.getMeta(BLOCK_MOVE_META) as BlockMove | undefined;
          const folds = new Set<number>();
          for (const pos of previous.folds) {
            const movedRange = move?.ranges ? move.ranges.find(range => pos >= range.from && pos < range.to)
              : move && pos >= move.from && pos < move.to ? move : undefined;
            const mapped = movedRange
              ? movedRange.inserted + pos - movedRange.from
              : tr.mapping.mapResult(pos, 1);
            const at = typeof mapped === 'number' ? mapped : mapped.deleted ? -1 : mapped.pos;
            if (at >= 0 && tr.doc.nodeAt(at)?.type.name === 'heading') folds.add(at);
          }
          return rebuild(tr.doc, folds);
        },
      },
      props: { decorations: state => headingFoldingKey.getState(state)?.decorations },
    })];
  },
});
