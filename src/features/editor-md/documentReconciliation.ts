import type { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { NodeAttributesStep } from './nodeAttributesStep';
import { ReplaceStep } from '@tiptap/pm/transform';

/** Snapshot history changes only the differing slice. Untouched node views,
 * syntax decorations and decoded media keep their existing lifetimes. */
export function reconcileDocumentHistory(editor: Editor, target: Node): void {
  const current = editor.state.doc;
  const start = current.content.findDiffStart(target.content);
  if (start === null) return;
  const before = current.nodeAt(start), after = target.nodeAt(start);
  if (before && after && !before.isText && before.type === after.type
    && before.content.eq(after.content)
    && before.marks.length === after.marks.length
    && before.marks.every((mark, index) => mark.eq(after.marks[index]))) {
    // Attribute changes do not replace a node's content or its editing controls.
    // Use the same zero-width maps for every node kind, including containers.
    const attrs = editor.state.tr.step(new NodeAttributesStep(start, after.attrs));
    if (attrs.doc.eq(target)) {
      attrs.setMeta('addToHistory', false).setMeta('noteboard-document-replacement', 'history');
      editor.view.dispatch(attrs);
      return;
    }
  }
  const end = current.content.findDiffEnd(target.content)!;
  // A repeated prefix/suffix can overlap when text is inserted or removed.
  const overlap = start - Math.min(end.a, end.b);
  const fromEnd = end.a + Math.max(0, overlap);
  const toEnd = end.b + Math.max(0, overlap);
  let tr = editor.state.tr;
  const result = tr.maybeStep(new ReplaceStep(start, fromEnd, target.slice(start, toEnd)));
  if (result.failed || !tr.doc.eq(target)) {
    // An open slice crossing an isolating container must not be fitted into a
    // different nesting structure. Widen only to the affected top-level blocks.
    const oldStart = current.resolve(start), oldEnd = current.resolve(fromEnd);
    const newStart = target.resolve(start), newEnd = target.resolve(toEnd);
    const from = oldStart.depth ? oldStart.before(1) : start;
    const to = oldEnd.depth ? oldEnd.after(1) : fromEnd;
    const targetFrom = newStart.depth ? newStart.before(1) : start;
    const targetTo = newEnd.depth ? newEnd.after(1) : toEnd;
    tr = editor.state.tr.replaceWith(from, to, target.content.cut(targetFrom, targetTo));
    if (!tr.doc.eq(target)) throw new Error('History restoration changed document structure');
  }
  tr.setMeta('addToHistory', false).setMeta('noteboard-document-replacement', 'history');
  editor.view.dispatch(tr);
}
