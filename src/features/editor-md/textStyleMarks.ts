import type { Transaction } from '@tiptap/pm/state';
import { TEXT_STYLE_MARKS, textStyleResetAttributes } from './textStylePolicy';
import { clearSelectedCaptionStyles } from './captionTextFormatting';
import { NodeAttributesStep } from './nodeAttributesStep';
export { TEXT_STYLE_MARKS } from './textStylePolicy';

/** Edit an existing transaction; links, annotations and structure retain meaning. */
export function clearTextStyleMarks(tr: Transaction, clearBlockStyles = true): boolean {
  const { selection } = tr, schema = tr.doc.type.schema;
  const marks = TEXT_STYLE_MARKS.filter(name => !!schema.marks[name]);
  const ranges = selection.empty && selection.$from.parent.isTextblock
    ? [{ from: selection.$from.start(), to: selection.$from.end() }]
    : selection.ranges.map(({ $from, $to }) => ({ from: $from.pos, to: $to.pos }));
  for (const { from, to } of ranges) {
    // Hidden annotation storage is not part of the visible selection. Keep
    // literal source blocks out of mark removal just as the cell path does.
    const spans: { from: number; to: number }[] = []; let start = from;
    tr.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type.name !== 'annotationStore' && !node.type.spec.code) return;
      if (start < pos) spans.push({ from: start, to: Math.min(pos, to) });
      start = Math.max(start, pos + node.nodeSize); return false;
    });
    if (start < to) spans.push({ from: start, to });
    for (const span of spans) for (const mark of marks) tr.removeMark(span.from, span.to, schema.marks[mark]);
  }
  if (clearBlockStyles) for (const { from, to } of ranges) tr.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === 'annotationStore') return false;
    const wholeNode = pos >= from && pos + node.nodeSize <= to;
    const wholeBody = node.isTextblock && pos + 1 >= from && pos + node.nodeSize - 1 <= to;
    // Partial text must not reset the shared presentation of unselected text.
    const patch = wholeNode || wholeBody ? textStyleResetAttributes(node) : null;
    if (patch) tr.step(new NodeAttributesStep(pos, patch));
  });
  if (selection.empty) {
    const current = tr.storedMarks ?? selection.$from.marks();
    for (const mark of marks) if (schema.marks[mark].isInSet(current)) tr.removeStoredMark(schema.marks[mark]);
  }
  clearSelectedCaptionStyles(tr);
  return tr.docChanged || tr.storedMarksSet;
}
