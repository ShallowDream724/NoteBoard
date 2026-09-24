import type { ChainedCommands, Editor } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import type { Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

export const DISCRETE_EDIT_META = 'noteboard-discrete-edit';
/** One user action, one application-history group, isolated from adjacent typing. */
export function discreteTransaction(tr: Transaction): Transaction {
  return closeHistory(tr).setMeta(DISCRETE_EDIT_META, true);
}
export function dispatchDiscreteEdit(view: EditorView, tr: Transaction): void {
  view.dispatch(discreteTransaction(tr));
  view.dispatch(closeHistory(view.state.tr));
}
export function runDiscreteEdit(editor: Editor, command: (chain: ChainedCommands) => ChainedCommands): boolean {
  const chain = editor.chain().command(({ tr }) => { discreteTransaction(tr); return true; });
  const result = command(chain).run();
  editor.view.dispatch(closeHistory(editor.state.tr));
  return result;
}
