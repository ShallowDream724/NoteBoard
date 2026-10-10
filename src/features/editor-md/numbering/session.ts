import type { Editor } from '@tiptap/core';

// One numeric-input gesture per editor. This weak registry owns no document
// cache and is cleared on commit, cancellation and editor destruction.
const pending = new WeakMap<Editor, () => void>();
export function settleNumberingDraft(editor: Editor) { pending.get(editor)?.(); }
export function ownNumberingDraft(editor: Editor, commit: () => void) {
  settleNumberingDraft(editor); pending.set(editor, commit);
  return () => { if (pending.get(editor) === commit) pending.delete(editor); };
}
