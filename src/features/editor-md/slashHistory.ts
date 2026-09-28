import type { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';

// A menu action may dispatch more than one transaction. Its synchronous scope
// belongs to the editor session, never to a separate command history stack.
const activeActions = new WeakMap<Editor, number>();

export function runSlashCommandAction(editor: Editor, action: () => void): void {
  activeActions.set(editor, (activeActions.get(editor) ?? 0) + 1);
  try {
    action();
  } finally {
    const remaining = (activeActions.get(editor) ?? 1) - 1;
    if (remaining) activeActions.set(editor, remaining);
    else activeActions.delete(editor);
  }
}

export function isSlashCommandAction(editor: Editor): boolean {
  return activeActions.has(editor);
}

/** The initial slash starts a history group before the query is typed. */
export function slashTriggerPosition(tr: Transaction): number | null {
  for (let index = 0; index < tr.steps.length; index++) {
    const before = tr.docs[index];
    const after = tr.docs[index + 1] ?? tr.doc;
    let trigger: number | null = null;
    tr.steps[index].getMap().forEach((oldFrom, oldTo, newFrom, newTo) => {
      if (oldFrom !== oldTo || newTo - newFrom !== 1 || after.textBetween(newFrom, newTo) !== '/') return;
      const $from = before.resolve(oldFrom);
      if (!$from.parent.isTextblock) return;
      const prefix = $from.parent.textBetween(0, $from.parentOffset);
      if (!prefix || /\s$/.test(prefix)) trigger = newFrom;
    });
    if (trigger !== null) return trigger;
  }
  return null;
}
