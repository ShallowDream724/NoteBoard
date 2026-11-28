import { StateEffect, StateField, Transaction, type EditorSelection, type Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { CodeNavigationCapabilities, CodeSymbolIndex } from '../../core/editor/editorTypes';
import type { LanguageId } from '../../core/ipc/types';
import { collectCodeSymbols } from './codeSymbols';

interface JumpOrigin {
  selection: EditorSelection;
  scroll: StateEffect<unknown>;
}

const MAX_JUMPS = 20;
const saveOrigin = StateEffect.define<JumpOrigin>();
const popOrigin = StateEffect.define<null>();

export const codeJumpHistory = StateField.define<readonly JumpOrigin[]>({
  create: () => [],
  update(origins, transaction) {
    let history = origins;
    if (transaction.docChanged && history.length) {
      history = history.flatMap(origin => {
        const scroll = origin.scroll.map(transaction.changes);
        return scroll ? [{ selection: origin.selection.map(transaction.changes), scroll }] : [];
      });
    }
    for (const effect of transaction.effects) {
      if (effect.is(saveOrigin)) history = [...history.slice(1 - MAX_JUMPS), effect.value];
      if (effect.is(popOrigin)) history = history.slice(0, -1);
    }
    return history;
  },
});

export function createCodeNavigation(view: EditorView, getLanguage: () => LanguageId): CodeNavigationCapabilities {
  let cached: { doc: Text; language: LanguageId; index: Promise<CodeSymbolIndex> } | undefined;
  return {
    readSymbols() {
      const state = view.state;
      const { doc } = state;
      const language = getLanguage();
      if (cached?.doc === doc && cached.language === language) return cached.index;
      const index = collectCodeSymbols(state, language).then(({ symbols, limited }): CodeSymbolIndex => ({
        symbols,
        limited,
        jump(symbol) {
          if (view.state.doc !== doc || getLanguage() !== language || !symbols.includes(symbol)) return false;
          const { position } = symbol;
          const selection = view.state.selection;
          if (selection.main.head !== position || !selection.main.empty) {
            view.dispatch({
              selection: { anchor: position },
              effects: [saveOrigin.of({ selection, scroll: view.scrollSnapshot() }), EditorView.scrollIntoView(position, { y: 'center' })],
              annotations: Transaction.addToHistory.of(false),
            });
          } else {
            view.dispatch({ effects: EditorView.scrollIntoView(position, { y: 'center' }) });
          }
          view.focus();
          return true;
        },
      })).catch(error => {
        if (cached?.index === index) cached = undefined;
        throw error;
      });
      cached = { doc, language, index };
      return index;
    },
    canReturn: () => !!view.state.field(codeJumpHistory, false)?.length,
    returnToPrevious() {
      const origin = view.state.field(codeJumpHistory, false)?.at(-1);
      if (!origin) return false;
      view.dispatch({
        selection: origin.selection,
        effects: [popOrigin.of(null), origin.scroll],
        annotations: Transaction.addToHistory.of(false),
      });
      view.focus();
      return true;
    },
  };
}
