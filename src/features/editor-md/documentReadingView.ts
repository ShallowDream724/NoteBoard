import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { CONTENT_VIEW_CHANGED } from '../../core/dom/contentViewport';
import './documentReadingView.css';

export type FormulaReadingMode = 'expand' | 'scroll' | 'wrap';
export type TableReadingMode = Exclude<FormulaReadingMode, 'wrap'>;
interface ReadingState { formula: FormulaReadingMode; table: TableReadingMode }
type ReadingChange = { scope: 'formula'; mode: FormulaReadingMode } | { scope: 'table'; mode: TableReadingMode };
export const documentReadingViewKey = new PluginKey<ReadingState>('documentReadingView');

export function documentFormulaReadingMode(state: EditorState): FormulaReadingMode {
  return documentReadingViewKey.getState(state)?.formula ?? 'expand';
}
export function documentTableReadingMode(state: EditorState): TableReadingMode {
  return documentReadingViewKey.getState(state)?.table ?? 'expand';
}
export function setDocumentFormulaReadingMode(editor: Editor, mode: FormulaReadingMode): boolean {
  if (!documentReadingViewKey.getState(editor.state)) return false;
  if (documentFormulaReadingMode(editor.state) !== mode) editor.view.dispatch(editor.state.tr
    .setMeta(documentReadingViewKey, { scope: 'formula', mode } satisfies ReadingChange).setMeta('addToHistory', false));
  return true;
}
export function setDocumentTableReadingMode(editor: Editor, mode: TableReadingMode): boolean {
  if (!documentReadingViewKey.getState(editor.state)) return false;
  if (documentTableReadingMode(editor.state) !== mode) editor.view.dispatch(editor.state.tr
    .setMeta(documentReadingViewKey, { scope: 'table', mode } satisfies ReadingChange).setMeta('addToHistory', false));
  return true;
}

/** Formula presentation is one document-wide view property. New or virtualized
 * formulas inherit it without per-node transactions or rerendering LaTeX.
 * Tables follow the same document scope. Neither policy changes document/history. */
export const DocumentReadingView = Extension.create({
  name: 'documentReadingView',
  addProseMirrorPlugins: () => [new Plugin<ReadingState>({
    key: documentReadingViewKey,
    state: {
      init: () => ({ formula: 'expand', table: 'expand' }),
      apply(tr, value) {
        const change = tr.getMeta(documentReadingViewKey) as ReadingChange | undefined;
        return change ? { ...value, [change.scope]: change.mode } : value;
      },
    },
    props: {
      attributes: state => ({ 'data-formula-reading': documentFormulaReadingMode(state), 'data-table-reading': documentTableReadingMode(state) }),
    },
    view: view => ({ update(next, previous) {
      if (documentReadingViewKey.getState(next.state) !== documentReadingViewKey.getState(previous)) view.dom.dispatchEvent(new Event(CONTENT_VIEW_CHANGED, { bubbles: true }));
    } }),
  })],
});
