import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import './documentReadingView.css';

export type FormulaReadingMode = 'expand' | 'scroll' | 'wrap';
export type TableReadingMode = Exclude<FormulaReadingMode, 'wrap'>;
interface ReadingState { formula: FormulaReadingMode; tables: DecorationSet }
type ReadingChange = { scope: 'formula'; mode: FormulaReadingMode } | { scope: 'table'; pos: number; mode: TableReadingMode };
export const documentReadingViewKey = new PluginKey<ReadingState>('documentReadingView');

export function documentFormulaReadingMode(state: EditorState): FormulaReadingMode {
  return documentReadingViewKey.getState(state)?.formula ?? 'expand';
}
export function tableReadingMode(state: EditorState, pos: number): TableReadingMode {
  return documentReadingViewKey.getState(state)?.tables.find(pos, pos + 1).find(item => item.from === pos)?.spec.mode ?? 'expand';
}
export function setDocumentFormulaReadingMode(editor: Editor, mode: FormulaReadingMode): boolean {
  if (!documentReadingViewKey.getState(editor.state)) return false;
  if (documentFormulaReadingMode(editor.state) !== mode) editor.view.dispatch(editor.state.tr
    .setMeta(documentReadingViewKey, { scope: 'formula', mode } satisfies ReadingChange).setMeta('addToHistory', false));
  return true;
}
export function setTableReadingMode(editor: Editor, pos: number, mode: TableReadingMode): boolean {
  if (!documentReadingViewKey.getState(editor.state) || editor.state.doc.nodeAt(pos)?.type.name !== 'table') return false;
  if (tableReadingMode(editor.state, pos) !== mode) editor.view.dispatch(editor.state.tr
    .setMeta(documentReadingViewKey, { scope: 'table', pos, mode } satisfies ReadingChange).setMeta('addToHistory', false));
  return true;
}

/** Formula presentation is one document-wide view property. New or virtualized
 * formulas inherit it without per-node transactions or rerendering LaTeX.
 * Tables retain sparse local overrides. Neither policy changes document/history. */
export const DocumentReadingView = Extension.create({
  name: 'documentReadingView',
  addProseMirrorPlugins: () => [new Plugin<ReadingState>({
    key: documentReadingViewKey,
    state: {
      init: () => ({ formula: 'expand', tables: DecorationSet.empty }),
      apply(tr, value) {
        let tables = tr.docChanged ? value.tables.map(tr.mapping, tr.doc) : value.tables;
        const change = tr.getMeta(documentReadingViewKey) as ReadingChange | undefined;
        if (change?.scope === 'formula') return { formula: change.mode, tables };
        if (change?.scope === 'table') {
          tables = tables.remove(tables.find(change.pos, change.pos + 1).filter(item => item.from === change.pos));
          const node = tr.doc.nodeAt(change.pos);
          if (change.mode === 'scroll' && node?.type.name === 'table') tables = tables.add(tr.doc,
            [Decoration.node(change.pos, change.pos + node.nodeSize, { 'data-block-reading': 'scroll' }, { mode: 'scroll' })]);
        }
        return tables === value.tables ? value : { formula: value.formula, tables };
      },
    },
    props: {
      attributes: state => ({ 'data-formula-reading': documentFormulaReadingMode(state) }),
      decorations: state => documentReadingViewKey.getState(state)?.tables,
    },
  })],
});
