import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import './headingFolding.css';

/** View state only: Markdown and exported/printed documents always contain the section. */
export const headingFoldingKey = new PluginKey<DecorationSet>('noteboard-heading-folding');
export const BLOCK_MOVE_META = 'noteboard-block-move';
export interface BlockMove { from: number; to: number; inserted: number }

export function headingSectionEnd(doc: PMNode, pos: number): number {
  const heading = doc.nodeAt(pos);
  if (heading?.type.name !== 'heading' || doc.resolve(pos).depth !== 0) return pos + (heading?.nodeSize ?? 0);
  let end = pos + heading.nodeSize;
  for (let index = doc.resolve(pos).index() + 1; index < doc.childCount; index++) {
    const child = doc.child(index);
    if (child.type.name === 'heading' && child.attrs.level <= heading.attrs.level) break;
    end += child.nodeSize;
  }
  return end;
}

export function foldedSectionEnd(state: EditorState, pos: number): number | undefined {
  const folded = headingFoldingKey.getState(state)?.find(pos + 1, pos + 1, spec => spec.folded);
  return folded?.length ? headingSectionEnd(state.doc, pos) : undefined;
}

function headingButton(pos: number, folded: boolean): Decoration {
  return Decoration.widget(pos + 1, (view, getPos) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nb-heading-fold-toggle';
    button.setAttribute('aria-label', folded ? '展开章节' : '折叠章节');
    button.setAttribute('aria-expanded', String(!folded));
    button.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    button.onpointerdown = event => event.preventDefault();
    button.onclick = event => {
      event.preventDefault();
      const at = getPos();
      if (at !== undefined) toggleHeadingFold(view.state, view.dispatch, at - 1);
      view.focus();
    };
    return button;
  }, { side: -1, folded, headingToggle: true, stopEvent: () => true });
}

function rebuild(doc: PMNode, folds: Set<number>): DecorationSet {
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
  return DecorationSet.create(doc, decorations);
}

function foldPositions(decorations: DecorationSet): number[] {
  return decorations.find(undefined, undefined, spec => spec.folded).map(decoration => decoration.from - 1);
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
    return [new Plugin<DecorationSet>({
      key: headingFoldingKey,
      state: {
        init: (_, state) => rebuild(state.doc, new Set()),
        apply(tr, previous) {
          const toggle = tr.getMeta(headingFoldingKey) as number | undefined;
          if (!tr.docChanged && toggle === undefined) {
            if (!tr.selectionSet) return previous;
            const folds = foldPositions(previous);
            const visible = folds.filter(pos => {
              const start = pos + (tr.doc.nodeAt(pos)?.nodeSize ?? 0);
              return tr.selection.from < start || tr.selection.from >= headingSectionEnd(tr.doc, pos);
            });
            return visible.length === folds.length ? previous : rebuild(tr.doc, new Set(visible));
          }
          if (toggle !== undefined) {
            const folds = new Set(foldPositions(previous));
            if (folds.has(toggle)) folds.delete(toggle); else folds.add(toggle);
            return rebuild(tr.doc, folds);
          }
          if (onlyInlineChanges(tr)) return previous.map(tr.mapping, tr.doc);
          const move = tr.getMeta(BLOCK_MOVE_META) as BlockMove | undefined;
          const folds = new Set<number>();
          for (const pos of foldPositions(previous)) {
            const mapped = move && pos >= move.from && pos < move.to
              ? move.inserted + pos - move.from
              : tr.mapping.mapResult(pos, 1);
            const at = typeof mapped === 'number' ? mapped : mapped.deleted ? -1 : mapped.pos;
            if (at >= 0 && tr.doc.nodeAt(at)?.type.name === 'heading') folds.add(at);
          }
          return rebuild(tr.doc, folds);
        },
      },
      props: { decorations: state => headingFoldingKey.getState(state) },
    })];
  },
});
