import type { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';

/** Snapshot history changes only the differing slice. Untouched node views,
 * syntax decorations and decoded media keep their existing lifetimes. */
export function reconcileDocumentHistory(editor: Editor, target: Node): void {
  const current = editor.state.doc;
  const start = current.content.findDiffStart(target.content);
  if (start === null) return;
  const end = current.content.findDiffEnd(target.content)!;
  // A repeated prefix/suffix can overlap when text is inserted or removed.
  const overlap = start - Math.min(end.a, end.b);
  const fromEnd = end.a + Math.max(0, overlap);
  const toEnd = end.b + Math.max(0, overlap);
  const tr = editor.state.tr.replace(start, fromEnd, target.slice(start, toEnd));
  tr.setMeta('addToHistory', false).setMeta('noteboard-document-replacement', 'history');
  editor.view.dispatch(tr);
}
