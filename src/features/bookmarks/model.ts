import type { Node as PMNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { isHistoryTransaction } from '@tiptap/pm/history';
import { StepMap } from '@tiptap/pm/transform';

import type { DocumentBookmark } from './types';
import { rangeMatches, rangeQuote, recoverRangeBookmarks } from './rangeAnchors';
export { MAX_DOCUMENT_BOOKMARKS, type DocumentBookmark } from './types';
export interface BookmarkTarget { pos: number; node: PMNode }

/** Bound preview work even for a table/list with thousands of descendants. */
export function bookmarkPreview(node: PMNode, limit = 160): string {
  let text = '';
  const visit = (current: PMNode) => {
    if (text.length >= limit) return;
    if (current.isText) { text += (current.text ?? '').slice(0, limit - text.length); return; }
    if (current.isLeaf) {
      const source = current.attrs.alt || current.attrs.latex || current.attrs.source || current.attrs.src;
      if (typeof source === 'string') text += source.slice(0, limit - text.length);
      return;
    }
    for (let i = 0; i < current.childCount && text.length < limit; i++) {
      if (i && current.child(i).isBlock) text += ' ';
      visit(current.child(i));
    }
  };
  visit(node);
  return text.replace(/\s+/g, ' ').trim().slice(0, limit);
}

const typeLabels: Record<string, string> = {
  paragraph: '空段落', heading: '标题', image: '图片', table: '表格', codeBlock: '代码块',
  mathBlock: '公式', horizontalRule: '分割线', disclosure: '折叠块', listItem: '列表项', taskItem: '待办',
};
export function bookmarkLabel(node: PMNode): string { return bookmarkPreview(node, 80) || typeLabels[node.type.name] || '内容块'; }

/** Explicit node boundaries target that block; a caret targets its nearest textblock. */
export function resolveBookmarkBlock(doc: PMNode, position: number): BookmarkTarget | null {
  if (!Number.isInteger(position) || position < 0 || position > doc.content.size) return null;
  const exact = doc.nodeAt(position);
  if (exact?.isBlock && !['annotationStore', 'documentPresentation'].includes(exact.type.name)) return { pos: position, node: exact };
  const at = doc.resolve(position);
  for (let depth = at.depth; depth > 0; depth--) {
    const node = at.node(depth);
    if (node.isTextblock || node.isAtom && node.isBlock) return { pos: at.before(depth), node };
  }
  return null;
}

export function createBookmark(target: BookmarkTarget, id: string): DocumentBookmark {
  return { id, pos: target.pos, size: target.node.nodeSize, nodeType: target.node.type.name,
    quote: bookmarkPreview(target.node), label: bookmarkLabel(target.node), missing: false };
}
export function captureBookmarkContexts(doc: PMNode, records: readonly DocumentBookmark[]): DocumentBookmark[] {
  return records.map(record => {
    if (record.missing) return { ...record };
    const end = Math.min(doc.content.size, record.pos + record.size);
    return { ...record,
      contextBefore: doc.textBetween(Math.max(0, record.pos - 64), record.pos, ' ').slice(-64),
      contextAfter: doc.textBetween(end, Math.min(doc.content.size, end + 64), ' ').slice(0, 64),
    };
  });
}

function signature(type: string, quote: string, before?: string, after?: string) {
  return `${type}\u0000${quote}${before === undefined ? '' : `\u0000${before}\u0000${after ?? ''}`}`;
}

/** One temporary index per recovery; repeated quotes deliberately remain unresolved. */
export function recoverBookmarks(doc: PMNode, records: readonly DocumentBookmark[], restoreMissing = false): DocumentBookmark[] {
  if (!records.length) return [];
  const ranges = records.filter(record => record.kind === 'range');
  if (ranges.length) {
    const recovered = [...recoverRangeBookmarks(doc, ranges, restoreMissing),
      ...recoverBookmarks(doc, records.filter(record => record.kind !== 'range'), restoreMissing)];
    const byId = new Map(recovered.map(record => [record.id, record]));
    return records.map(record => byId.get(record.id)!);
  }
  const eligible = records.filter(record => !record.missing || restoreMissing);
  if (!eligible.length) return records.map(record => ({ ...record }));
  const wanted = new Set(eligible.map(record => signature(record.nodeType, record.quote, record.contextBefore, record.contextAfter)));
  const wantedQuotes = new Set(eligible.map(record => signature(record.nodeType, record.quote)));
  const types = new Set(eligible.map(record => record.nodeType));
  const found = new Map<string, BookmarkTarget | null>();
  doc.descendants((node, pos) => {
    if (['annotationStore', 'documentPresentation'].includes(node.type.name)) return false;
    if (!types.has(node.type.name)) return;
    const quote = bookmarkPreview(node), plain = signature(node.type.name, quote);
    if (!wantedQuotes.has(plain)) return;
    found.set(plain, found.has(plain) ? null : { pos, node });
    const withContext = signature(node.type.name, quote,
      doc.textBetween(Math.max(0, pos - 64), pos, ' ').slice(-64),
      doc.textBetween(pos + node.nodeSize, Math.min(doc.content.size, pos + node.nodeSize + 64), ' ').slice(0, 64));
    if (wanted.has(withContext)) found.set(withContext, found.has(withContext) ? null : { pos, node });
  });
  return records.map(record => {
    if (record.missing && !restoreMissing) return { ...record };
    const target = found.get(signature(record.nodeType, record.quote)) ??
      found.get(signature(record.nodeType, record.quote, record.contextBefore, record.contextAfter));
    return target ? { ...record, pos: target.pos, size: target.node.nodeSize, missing: false } : { ...record, missing: true };
  });
}

interface MoveRange { from: number; to: number; inserted: number }
/** O(bookmarks), with no document scan in the ordinary typing path. */
export function mapBookmarks(tr: Transaction, previous: readonly DocumentBookmark[], moves: readonly MoveRange[] = []): readonly DocumentBookmark[] {
  const replacement = tr.getMeta('noteboard-document-replacement');
  let mapping: Pick<Transaction['mapping'], 'map' | 'mapResult'> = tr.mapping;
  let semanticMap: StepMap | undefined;
  if (replacement) {
    // Source-mode synchronization can replace the complete root even for one
    // word edit. Recover the actual changed slice before mapping point anchors.
    const start = tr.before.content.findDiffStart(tr.doc.content);
    if (start === null) return previous;
    const end = start === null ? null : tr.before.content.findDiffEnd(tr.doc.content);
    if (start !== null && end) {
      const overlap = Math.max(0, start - Math.min(end.a, end.b));
      semanticMap = new StepMap([start, end.a + overlap - start, end.b + overlap - start]);
      mapping = semanticMap;
    }
  }
  const mapped = previous.map(record => {
    if (record.missing) {
      const pos = mapping.map(record.pos, -1);
      return pos === record.pos ? record : { ...record, pos };
    }
    const move = moves.find(range => record.pos >= range.from && record.pos < range.to);
    const from = mapping.mapResult(record.pos, 1), to = mapping.map(record.pos + record.size, -1);
    const pos = move ? move.inserted + record.pos - move.from : from.pos;
    if (record.kind === 'range') {
      const history = replacement === 'history' || isHistoryTransaction(tr);
      const start = move ? pos : history ? mapping.map(record.pos, -1) : pos;
      const end = move && record.pos + record.size <= move.to ? start + record.size
        : history ? mapping.map(record.pos + record.size, 1) : to;
      if (end <= start || end > tr.doc.content.size) return { ...record, pos: start, missing: true };
      const quote = rangeQuote(tr.doc, start, end);
      return start === record.pos && end - start === record.size && quote === record.quote ? record
        : { ...record, pos: start, size: end - start, quote, missing: false };
    }
    if (!move && (from.deletedAcross || to <= from.pos)) return { ...record, pos, missing: true };
    const node = tr.doc.nodeAt(pos);
    if (!node?.isBlock) return { ...record, pos, missing: true };
    // Immutable unchanged blocks retain both record and bounded preview.
    if (!move && pos === record.pos && node === tr.before.nodeAt(record.pos)) return record;
    const quote = bookmarkPreview(node);
    if (replacement === 'sync' && semanticMap && quote !== record.quote) {
      const before = tr.before.resolve(record.pos), after = tr.doc.resolve(pos);
      let structureChanged = before.depth !== after.depth;
      for (let depth = 0; depth <= Math.min(before.depth, after.depth) && !structureChanged; depth++) {
        structureChanged = before.node(depth).childCount !== after.node(depth).childCount;
      }
      let replacedContent = false;
      semanticMap.forEach((from, to) => { replacedContent ||= from <= record.pos + 1 && to >= record.pos + record.size - 1; });
      if (structureChanged && replacedContent) return { ...record, pos, missing: true };
    }
    return { ...record, pos, size: node.nodeSize, nodeType: node.type.name,
      quote, missing: false };
  });
  const nativeHistory = isHistoryTransaction(tr);
  if (replacement === 'history' || nativeHistory) {
    // An undo insertion restores a deleted target at its mapped boundary, even
    // when several paragraphs share the same wording. Ordinary deletion must
    // never attach to the identical next paragraph.
    const previouslyMissing = new Set(previous.filter(record => record.missing).map(record => record.id));
    const insertions: Array<{ from: number; to: number }> = [];
    if (semanticMap) semanticMap.forEach((_oldFrom, _oldTo, from, to) => { if (to > from) insertions.push({ from, to }); });
    else tr.mapping.maps.forEach((map, index) => map.forEach((_oldFrom, _oldTo, from, to) => {
      if (to <= from) return;
      const after = tr.mapping.slice(index + 1);
      insertions.push({ from: after.map(from, -1), to: after.map(to, 1) });
    }));
    const restored = mapped.map(record => {
      if (!record.missing || !previouslyMissing.has(record.id) || !insertions.some(range => record.pos >= range.from && record.pos < range.to)) return record;
      if (record.kind === 'range') {
        if (rangeMatches(tr.doc, record)) return { ...record, missing: false };
        const recovered = recoverRangeBookmarks(tr.doc, [record], true)[0];
        return !recovered.missing && insertions.some(range => recovered.pos >= range.from && recovered.pos < range.to) ? recovered : record;
      }
      const node = tr.doc.nodeAt(record.pos);
      return node?.type.name === record.nodeType && bookmarkPreview(node) === record.quote
        ? { ...record, size: node.nodeSize, missing: false } : record;
    });
    // Undoing a structural replacement/move may recreate a unique block at a
    // different boundary. Pure deletion (including redo) cannot recover it.
    const insertsBlock = tr.steps.some(step => Boolean((step as unknown as { slice?: { content: { firstChild?: PMNode | null } } }).slice?.content.firstChild?.isBlock));
    if (!insertsBlock || tr.doc.content.size < tr.before.content.size) return restored;
    const recovered = recoverBookmarks(tr.doc, restored.filter(record => record.missing && !previouslyMissing.has(record.id)), true);
    const byId = new Map(recovered.map(record => [record.id, record]));
    return restored.map(record => byId.get(record.id) ?? record);
  }
  if (!replacement || !mapped.some(record => record.missing)) return mapped.every((record, index) => record === previous[index]) ? previous : mapped;
  const previouslyMissing = new Set(previous.filter(record => record.missing).map(record => record.id));
  const recovered = recoverBookmarks(tr.doc, mapped.filter(record => record.missing && !previouslyMissing.has(record.id)), true);
  const byId = new Map(recovered.map(record => [record.id, record]));
  return mapped.map(record => byId.get(record.id) ?? record);
}
