import { Annotation, Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { NATIVE_DOCUMENT_HEADER, replaceNativeMetadata, type NativeMetadata } from '../../core/nativeDocument';

/** Programmatic source synchronization never starts a user-edit/history group. */
export const sourceReplacement = Annotation.define<boolean>();

/** Flush pending source snapshots first. This patches only the small header and
 * lets CodeMirror map its selection without resetting source or undo state. */
export function setSourceNativeMetadata(view: EditorView, metadata: NativeMetadata): void {
  const record = replaceNativeMetadata(`${NATIVE_DOCUMENT_HEADER}\n`, metadata).slice(NATIVE_DOCUMENT_HEADER.length + 1).trimEnd();
  const doc = view.state.doc;
  if (doc.line(1).text.replace(/^\uFEFF/, '') !== NATIVE_DOCUMENT_HEADER) throw new Error('无法更新缺少有效 NB 文档头的元数据。');
  let from = doc.line(1).to, to = from, insert = `\n${record}`;
  for (let index = 2; index <= doc.lines; index++) {
    const line = doc.line(index);
    if (!line.text.trim() && index < doc.lines) continue;
    from = line.from; to = line.text.startsWith('@meta ') ? line.to : from;
    insert = to > from ? record : `${record}\n`;
    break;
  }
  if (doc.sliceString(from, to) === insert) return;
  view.dispatch({ changes: { from, to, insert }, annotations: [Transaction.addToHistory.of(false), sourceReplacement.of(true)] });
}
