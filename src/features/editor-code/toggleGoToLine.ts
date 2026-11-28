import { gotoLine } from '@codemirror/search';
import type { Command } from '@codemirror/view';

export const toggleGoToLine: Command = view => {
  // CodeMirror's gotoLine opens a fresh dialog on every call.
  const input = view.dom.querySelector('.cm-dialog input[name="line"]');
  const close = input?.closest('.cm-dialog')?.querySelector<HTMLButtonElement>('.cm-dialog-close');
  if (!close) return gotoLine(view);

  close.click();
  view.focus();
  return true;
};
