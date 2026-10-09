import type { Transaction } from '@tiptap/pm/state';

/** Shared by document and embedded text editors, without document-view imports. */
export const TEXT_STYLE_MARKS = ['bold', 'italic', 'underline', 'strike', 'code', 'highlight', 'textColor', 'subscript', 'superscript'] as const;

/** Edit an existing transaction; links, annotations and structure retain meaning. */
export function clearTextStyleMarks(tr: Transaction, clearBlockTextColor = false): boolean {
  const { selection } = tr, schema = tr.doc.type.schema;
  const marks = TEXT_STYLE_MARKS.filter(name => !!schema.marks[name]);
  const ranges = selection.empty && selection.$from.parent.isTextblock
    ? [{ from: selection.$from.start(), to: selection.$from.end() }]
    : selection.ranges.map(({ $from, $to }) => ({ from: $from.pos, to: $to.pos }));
  for (const { from, to } of ranges) for (const mark of marks) tr.removeMark(from, to, schema.marks[mark]);
  if (clearBlockTextColor) for (const { from, to } of ranges) tr.doc.nodesBetween(from, to, (node, pos) => {
    if (node.attrs.blockTextColor && pos >= from && pos + node.nodeSize <= to) tr.setNodeAttribute(pos, 'blockTextColor', null);
  });
  if (selection.empty) for (const mark of marks) tr.removeStoredMark(schema.marks[mark]);
  return tr.docChanged || tr.storedMarksSet;
}
