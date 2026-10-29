import type { Editor } from '@tiptap/core';
import { mapModeSelection, authoringPositionSpans } from './sourcePosition';
import { authoringNodePosition } from './authoringSourcePosition';

/** Atom positions identify a formula structurally. Inspect only that formula's
 * already-mapped source range to recover the editable TeX payload. */
export function markdownMathPayload(editor: Editor, source: string, position: number) {
  const node = editor.state.doc.nodeAt(position);
  if (!node || !['mathInline', 'mathBlock'].includes(node.type.name)) return null;
  const spans = authoringPositionSpans(editor.state.doc, editor.storage.markdown?.manager, source, editor);
  const payload = spans?.find(span => span.kind === 'attribute' && authoringNodePosition(editor.state.doc, { path: span.path, offset: 0, kind: 'attribute', source: span.from }) === position);
  if (payload) return { from: payload.contentFrom ?? payload.from, to: payload.contentTo ?? payload.to };
  const range = mapModeSelection(editor, source, 'source', { anchor: position, head: position + node.nodeSize });
  const latex = String(node.attrs.latex ?? ''), raw = source.slice(range.anchor, range.head);
  const opener = String(node.attrs.delimiter ?? (node.type.name === 'mathBlock' ? '$$' : '$'));
  const offset = raw.indexOf(latex, opener.length);
  if (offset < 0) return null;
  return { from: range.anchor + offset, to: range.anchor + offset + latex.length };
}
export function markdownMathSelection(editor: Editor, source: string, selection: { anchor: number; head: number }, visual: { anchor: number; head: number }) {
  for (const position of new Set([visual.anchor, visual.anchor - 1, visual.head, visual.head - 1])) {
    if (position < 0 || position >= editor.state.doc.content.size) continue;
    const payload = markdownMathPayload(editor, source, position);
    if (!payload || selection.anchor < payload.from || selection.anchor > payload.to || selection.head < payload.from || selection.head > payload.to) continue;
    return { position, anchor: selection.anchor - payload.from, head: selection.head - payload.from };
  }
  return null;
}
