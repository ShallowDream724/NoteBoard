import type { Node as PMNode } from '@tiptap/pm/model';
import type { DocumentBookmark } from './types';

/** Read at most the preview budget, even when the selection spans a whole book. */
export function rangeQuote(doc: PMNode, from: number, to: number): string {
  return doc.textBetween(from, Math.min(to, from + 160), ' ', '\ufffc').slice(0, 160);
}

export function validRange(doc: PMNode, record: DocumentBookmark): boolean {
  return record.pos >= 0 && record.size > 0 && record.pos + record.size <= doc.content.size;
}

export function rangeMatches(doc: PMNode, record: DocumentBookmark, pos = record.pos, context = false): boolean {
  const end = pos + record.size;
  if (pos < 0 || end > doc.content.size || rangeQuote(doc, pos, end) !== record.quote) return false;
  return !context || (
    (record.contextBefore === undefined || doc.textBetween(Math.max(0, pos - 64), pos, ' ').slice(-64) === record.contextBefore) &&
    (record.contextAfter === undefined || doc.textBetween(end, Math.min(doc.content.size, end + 64), ' ').slice(0, 64) === record.contextAfter)
  );
}

/** Recovery only: one temporary text-node index, never retained while typing.
 * Ambiguous or excessively repeated candidates stay missing rather than jump. */
export function recoverRangeBookmarks(doc: PMNode, records: readonly DocumentBookmark[], restoreMissing: boolean): DocumentBookmark[] {
  let textNodes: Array<{ text: string; pos: number }> | undefined;
  const index = () => {
    if (textNodes) return textNodes;
    textNodes = [];
    doc.descendants((node, pos) => {
      if (['annotationStore', 'documentPresentation'].includes(node.type.name)) return false;
      if (node.isText) textNodes!.push({ text: node.text!, pos });
      else if (node.isInline && node.isLeaf) textNodes!.push({ text: '\ufffc', pos });
    });
    return textNodes;
  };
  return records.map(record => {
    if (record.missing && !restoreMissing) return record;
    if (rangeMatches(doc, record, record.pos, true)) return { ...record, missing: false };
    const needle = record.quote[0];
    if (!needle) return { ...record, missing: true };
    let found: number | undefined, attempts = 0, ambiguous = false;
    for (const entry of index()) {
      let offset = -1;
      while ((offset = entry.text.indexOf(needle, offset + 1)) !== -1) {
        if (++attempts > 2048) { ambiguous = true; break; }
        const pos = entry.pos + offset;
        if (!rangeMatches(doc, record, pos, true)) continue;
        if (found !== undefined) { ambiguous = true; break; }
        found = pos;
      }
      if (ambiguous) break;
    }
    return found !== undefined && !ambiguous ? { ...record, pos: found, missing: false } : { ...record, missing: true };
  });
}
