import type { Node as DocumentNode } from '@tiptap/pm/model';
import type { AuthoringSpan } from '../declarative/types';

export interface AuthoringPoint { path: number[]; offset: number; kind: 'text' | 'node' | 'attribute'; source: number }
export interface AuthoringSelectionBookmark { anchor: AuthoringPoint; head: AuthoringPoint }
type Selection = { anchor: number; head: number };
const nodeLocations = new WeakMap<DocumentNode, Map<string, { node: DocumentNode; position: number }>>();
function nodeLocation(doc: DocumentNode, path: readonly number[]) {
  let locations = nodeLocations.get(doc);
  if (!locations) {
    locations = new Map();
    const visit = (node: DocumentNode, position: number, path: number[]) => {
      locations!.set(path.join('/'), { node, position });
      node.forEach((child, offset, index) => visit(child, position + 1 + offset, [...path, index]));
    };
    visit(doc, -1, []); nodeLocations.set(doc, locations);
  }
  return locations.get(path.join('/')) ?? null;
}
const bodyFrom = (span: AuthoringSpan) => span.contentFrom ?? span.from;
const bodyTo = (span: AuthoringSpan) => span.contentTo ?? span.to;
function decodedOffset(span: AuthoringSpan, source: number) {
  if (!span.offsets?.length) return Math.max(0, Math.min(bodyTo(span) - bodyFrom(span), source - bodyFrom(span)));
  let low = 0, high = span.offsets.length;
  while (low < high) { const middle = (low + high) >>> 1; if (span.offsets[middle] < source) low = middle + 1; else high = middle; }
  return Math.min(span.offsets.length - 1, low);
}
export function authoringSourceOffset(span: AuthoringSpan, offset: number) {
  return span.offsets?.[Math.min(span.offsets.length - 1, offset)] ?? Math.min(bodyTo(span), bodyFrom(span) + offset);
}
const samePath = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((value, i) => value === b[i]);
function sourceSpan(spans: readonly AuthoringSpan[], point: number) {
  let best: AuthoringSpan | undefined, distance = Infinity;
  for (const span of spans) {
    const gap = point < span.from ? span.from - point : point > span.to ? point - span.to : 0;
    if (gap < distance || gap === distance && span.to - span.from < (best ? best.to - best.from : Infinity)) { best = span; distance = gap; }
  }
  return best;
}
export function captureAuthoringSelection(spans: readonly AuthoringSpan[], selection: Selection): AuthoringSelectionBookmark {
  const point = (source: number): AuthoringPoint => {
    const span = sourceSpan(spans, source);
    return { path: span?.path ?? [], offset: span ? decodedOffset(span, source) : 0, kind: span?.kind ?? 'node', source };
  };
  return { anchor: point(selection.anchor), head: point(selection.head) };
}
export function authoringBookmarkSelection(spans: readonly AuthoringSpan[], bookmark: AuthoringSelectionBookmark): Selection {
  const point = (value: AuthoringPoint) => {
    const span = spans.find(span => span.kind === value.kind && samePath(span.path, value.path));
    return span ? authoringSourceOffset(span, value.offset) : value.source;
  };
  return { anchor: point(bookmark.anchor), head: point(bookmark.head) };
}
export function authoringToVisual(doc: DocumentNode, bookmark: AuthoringSelectionBookmark): Selection {
  const point = (value: AuthoringPoint) => {
    const found = nodeLocation(doc, value.path);
    if (!found || !value.path.length) return Math.min(1, doc.content.size);
    if (found.node.isText) return found.position + Math.min(found.node.nodeSize, value.offset);
    if (found.node.isTextblock) return found.position + 1 + Math.min(found.node.content.size, value.offset);
    return found.position;
  };
  return { anchor: point(bookmark.anchor), head: point(bookmark.head) };
}
export function visualToAuthoring(doc: DocumentNode, spans: readonly AuthoringSpan[], selection: Selection): Selection {
  const point = (position: number) => {
    let best: { span: AuthoringSpan; start: number } | undefined;
    for (const span of spans) {
      const found = nodeLocation(doc, span.path); if (!found) continue;
      const start = found.position + (found.node.isTextblock ? 1 : 0);
      if (position < found.position || position > found.position + found.node.nodeSize) continue;
      if (!best || span.path.length > best.span.path.length || span.path.length === best.span.path.length && (span.kind === 'text' || span.kind === 'attribute')) best = { span, start };
    }
    return best ? authoringSourceOffset(best.span, Math.max(0, position - best.start)) : 0;
  };
  return { anchor: point(selection.anchor), head: point(selection.head) };
}
export function authoringNodePosition(doc: DocumentNode, point: AuthoringPoint) { return nodeLocation(doc, point.path)?.position; }
