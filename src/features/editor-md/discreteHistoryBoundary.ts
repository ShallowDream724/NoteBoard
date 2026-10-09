import { Extension } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { Plugin } from '@tiptap/pm/state';
import { DISCRETE_EDIT_META } from './discreteEdit';

/** Embedded editors use native history rather than the application's timeline.
 * A metadata-only boundary keeps typing after a discrete action separate. */
export const DiscreteHistoryBoundary = Extension.create({
  name: 'discreteHistoryBoundary',
  addProseMirrorPlugins() {
    return [new Plugin({
      appendTransaction(transactions, _oldState, state) {
        if (transactions.some(tr => tr.docChanged && tr.getMeta(DISCRETE_EDIT_META))) return closeHistory(state.tr);
        return null;
      },
    })];
  },
});
