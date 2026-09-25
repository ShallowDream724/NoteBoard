import type { Node as DocumentNode } from '@tiptap/pm/model';
import { NATIVE_CHILD_CONTAINERS, NATIVE_DOCUMENT_HEADER } from '../../core/nativeDocument';

type Direction = 'source' | 'visual';
type PointSelection = { anchor: number; head: number };
type Affinity = 'left' | 'right';
interface Escape { decoded: number; from: number; to: number; extra: number }
interface StringSpan { from: number; to: number; length: number; escapes: Escape[] }
interface SourceNode { from: number; to: number; type?: string; text?: StringSpan; children: SourceNode[] }
interface RecordSpan { from: number; to: number; line: number; kind: 'block' | 'child' | 'other'; node?: SourceNode; used?: boolean }
interface Segment { from: number; to: number; visualFrom: number; visualTo: number; text?: StringSpan }
interface Frame extends Segment { segments: Segment[]; fallback: number }
interface Index { doc: DocumentNode; source: string; sourceFrames: Frame[]; visualFrames: Frame[] }
const indexes = new WeakMap<object, Index>();
const canonicalTypes = new Set(['documentPresentation', 'annotationStore']);

/** A location-only JSON reader. It retains no values/attrs or second semantic
 * document tree; long image URLs and metadata strings are just skipped. */
class Locations {
  private at: number;
  constructor(private source: string, start: number, private end: number) { this.at = start; }
  private whitespace() { while (this.at < this.end && /\s/.test(this.source[this.at])) this.at++; }
  private take(char: string) { this.whitespace(); if (this.source[this.at++] !== char) throw new Error('JSON boundary'); }
  private string(keepEscapes = false): StringSpan {
    this.take('"'); const from = this.at, escapes: Escape[] = []; let length = 0, extra = 0;
    while (this.at < this.end) {
      const start = this.at, char = this.source[this.at++];
      if (char === '"') return { from, to: this.at - 1, length, escapes };
      if (char.charCodeAt(0) < 32) throw new Error('JSON string');
      if (char === '\\') {
        const escape = this.source[this.at++];
        if (escape === 'u') {
          if (!/^[\da-fA-F]{4}$/.test(this.source.slice(this.at, this.at + 4))) throw new Error('JSON escape');
          this.at += 4;
        } else if (!escape || !'"\\/bfnrt'.includes(escape)) throw new Error('JSON escape');
        extra += this.at - start - 1;
        if (keepEscapes) escapes.push({ decoded: length, from: start, to: this.at, extra });
      }
      length++;
    }
    throw new Error('JSON string');
  }
  private value(depth: number): void {
    if (depth > 256) throw new Error('JSON depth');
    this.whitespace(); const char = this.source[this.at];
    if (char === '"') { this.string(); return; }
    if (char === '{' || char === '[') {
      this.at++; this.whitespace(); const end = char === '{' ? '}' : ']';
      if (this.source[this.at] === end) { this.at++; return; }
      while (this.at < this.end) {
        if (char === '{') { this.string(); this.take(':'); }
        this.value(depth + 1); this.whitespace();
        if (this.source[this.at] === end) { this.at++; return; }
        this.take(',');
      }
      throw new Error('JSON boundary');
    }
    const start = this.at;
    while (this.at < this.end && !/[\s,\]}]/.test(this.source[this.at])) this.at++;
    if (!/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.test(this.source.slice(start, this.at))) throw new Error('JSON value');
  }
  private node(depth = 0): SourceNode {
    if (depth > 256) throw new Error('JSON depth');
    this.whitespace(); const from = this.at; this.take('{');
    const result: SourceNode = { from, to: from, children: [] };
    this.whitespace();
    if (this.source[this.at] !== '}') while (this.at < this.end) {
      const keySpan = this.string(), key = JSON.parse(this.source.slice(keySpan.from - 1, keySpan.to + 1)) as string;
      this.take(':');
      if (key === 'type') { const value = this.string(); result.type = JSON.parse(this.source.slice(value.from - 1, value.to + 1)) as string; }
      else if (key === 'text') result.text = this.string(true);
      else if (key === 'content') {
        this.take('['); this.whitespace(); result.children = [];
        if (this.source[this.at] !== ']') while (this.at < this.end) {
          result.children.push(this.node(depth + 1)); this.whitespace();
          if (this.source[this.at] === ']') break;
          this.take(',');
        }
        this.take(']');
      } else this.value(depth + 1);
      this.whitespace(); if (this.source[this.at] === '}') break;
      this.take(',');
    }
    this.take('}'); result.to = this.at; return result;
  }
  read(): SourceNode { const node = this.node(); this.whitespace(); if (this.at !== this.end || !node.type) throw new Error('JSON record'); return node; }
}

function records(source: string): RecordSpan[] {
  const result: RecordSpan[] = []; let from = 0, line = 1;
  while (from < source.length) {
    const newline = source.indexOf('\n', from), next = newline < 0 ? source.length : newline + 1;
    const to = (newline < 0 ? source.length : newline) - (source[(newline < 0 ? source.length : newline) - 1] === '\r' ? 1 : 0);
    const prefix = source.slice(from, Math.min(to, from + 7));
    if (!(line === 1 && source.slice(from, to).replace(/^\uFEFF/, '') === NATIVE_DOCUMENT_HEADER) && source.slice(from, to).trim()) {
      const kind = prefix === '@block ' ? 'block' : prefix === '@child ' ? 'child' : 'other';
      let node: SourceNode | undefined;
      if (kind !== 'other') try { node = new Locations(source, from + 7, to).read(); } catch { /* The editor retains this as a local error frame. */ }
      result.push({ from, to, line, kind, node });
    }
    from = next; line++;
  }
  return result;
}
function textPosition(node: DocumentNode, from: number): number {
  if (node.isTextblock) return from + 1;
  if (node.isAtom || !node.childCount) return from;
  return textPosition(node.firstChild!, from + 1);
}
function segments(parsed: SourceNode | undefined, node: DocumentNode, from: number, result: Segment[]): void {
  if (!parsed || parsed.type !== node.type.name) return;
  if (node.isText && parsed.text) {
    result.push({ from: parsed.text.from, to: parsed.text.to, visualFrom: from, visualTo: from + node.nodeSize, text: parsed.text }); return;
  }
  if (node.isAtom || !node.childCount) {
    const point = textPosition(node, from);
    result.push({ from: parsed.from, to: parsed.to, visualFrom: point, visualTo: node.isTextblock ? point : from + node.nodeSize }); return;
  }
  let childIndex = 0, visual = from + 1, consumedText = 0;
  for (const child of parsed.children) {
    if (childIndex >= node.childCount) break;
    const actual = node.child(childIndex);
    // ProseMirror joins adjacent JSON text runs with equal marks. The authored
    // run lengths provide exact correspondence without matching text strings.
    if (child.type === 'text' && child.text && actual.isText) {
      const length = child.text.length;
      if (consumedText + length > actual.nodeSize) break;
      result.push({ from: child.text.from, to: child.text.to, visualFrom: visual + consumedText, visualTo: visual + consumedText + length, text: child.text });
      consumedText += length;
      if (consumedText === actual.nodeSize) { visual += actual.nodeSize; childIndex++; consumedText = 0; }
    } else {
      if (consumedText) break;
      segments(child, actual, visual, result); visual += actual.nodeSize; childIndex++;
    }
  }
}
function buildIndex(doc: DocumentNode, source: string): Index {
  const sourceRecords = records(source), lineRecords = new Map(sourceRecords.map((record, index) => [record.line, index]));
  const byRecord = new Map<RecordSpan, Frame>(), visualFrames: Frame[] = [];
  const add = (record: RecordSpan, node: DocumentNode, visualFrom: number, skeleton = false, lastRecord = record) => {
    record.used = true;
    const frame: Frame = { from: record.from, to: lastRecord.to, visualFrom, visualTo: visualFrom + (skeleton ? 1 : node.nodeSize), fallback: textPosition(node, visualFrom), segments: [] };
    if (!skeleton) segments(record.node, node, visualFrom, frame.segments);
    byRecord.set(record, frame); visualFrames.push(frame);
  };
  // Error line numbers can become stale after visual edits insert earlier frames.
  // Match their exact first record in document order, never search prose/fuzzily
  // align text. The same raw error may span several unsupported child records.
  const errorRecords = new Map<DocumentNode, { first: RecordSpan; last: RecordSpan }>();
  const errors = new Map<string, { records: RecordSpan[]; next: number }>();
  doc.forEach(node => { if (node.type.name === 'nativeError' && typeof node.attrs.raw === 'string') errors.set(node.attrs.raw.split('\n', 1)[0], { records: [], next: 0 }); });
  for (const record of sourceRecords) errors.get(source.slice(record.from, record.to))?.records.push(record);
  doc.forEach(node => {
    if (node.type.name !== 'nativeError' || typeof node.attrs.raw !== 'string') return;
    const candidates = errors.get(node.attrs.raw.split('\n', 1)[0]), first = candidates?.records[candidates.next++];
    if (!first) return;
    const index = lineRecords.get(first.line)!;
    let lastLine = first.line;
    for (const char of String(node.attrs.raw)) if (char === '\n') lastLine++;
    let last = first;
    for (let at = index; at < sourceRecords.length && sourceRecords[at].line <= lastLine; at++) { sourceRecords[at].used = true; last = sourceRecords[at]; }
    errorRecords.set(node, { first, last });
  });
  const canonical = new Map<string, RecordSpan>();
  for (const record of sourceRecords) if (!record.used && record.kind === 'block' && canonicalTypes.has(record.node?.type ?? '') && !canonical.has(record.node!.type!)) canonical.set(record.node!.type!, record);
  let cursor = 0;
  doc.forEach((node, from) => {
    const error = errorRecords.get(node);
    if (error) { add(error.first, node, from, false, error.last); return; }
    let record = canonical.get(node.type.name);
    if (!record || record.used) {
      while (cursor < sourceRecords.length && (sourceRecords[cursor].used || sourceRecords[cursor].kind !== 'block' || canonicalTypes.has(sourceRecords[cursor].node?.type ?? ''))) cursor++;
      record = sourceRecords[cursor++];
    }
    if (!record) return;
    const container = NATIVE_CHILD_CONTAINERS.has(node.type.name) && record.node?.type === node.type.name;
    add(record, node, from, container);
    if (container) {
      let at = lineRecords.get(record.line)! + 1, childFrom = from + 1;
      node.forEach(child => {
        const childRecord = sourceRecords[at];
        if (childRecord?.kind === 'child' && !childRecord.used) { add(childRecord, child, childFrom); at++; }
        childFrom += child.nodeSize;
      });
    }
  });
  const sourceFrames = sourceRecords.flatMap(record => { const frame = byRecord.get(record); return frame ? [frame] : []; });
  return { doc, source, sourceFrames, visualFrames };
}
function nearest<T>(entries: T[], point: number, from: (entry: T) => number, to: (entry: T) => number, affinity: Affinity): T | undefined {
  let low = 0, high = entries.length;
  while (low < high) { const middle = (low + high) >>> 1, end = to(entries[middle]); if (point < end || point === end && affinity === 'left') high = middle; else low = middle + 1; }
  const current = entries[Math.min(low, entries.length - 1)], previous = entries[low - 1];
  return previous && current && point < from(current) && point - to(previous) <= from(current) - point ? previous : current;
}
function sourcePoint(span: StringSpan, decoded: number): number {
  decoded = Math.max(0, Math.min(span.length, decoded)); let low = 0, high = span.escapes.length;
  while (low < high) { const middle = (low + high) >>> 1; if (span.escapes[middle].decoded < decoded) low = middle + 1; else high = middle; }
  return span.from + decoded + (span.escapes[low - 1]?.extra ?? 0);
}
function decodedPoint(span: StringSpan, source: number, affinity: Affinity): number {
  source = Math.max(span.from, Math.min(span.to, source)); let low = 0, high = span.escapes.length;
  while (low < high) { const middle = (low + high) >>> 1; if (span.escapes[middle].from < source) low = middle + 1; else high = middle; }
  const escape = span.escapes[low - 1];
  if (escape && source < escape.to) return escape.decoded + (affinity === 'right' ? 1 : 0);
  return source - span.from - (escape?.extra ?? 0);
}

/** Called only at mode-transfer boundaries. O(source length + semantic nodes) to
 * build one location index; cached endpoint queries use binary searches. */
export function mapNativeDocumentSelection(doc: DocumentNode, source: string, direction: Direction, selection: PointSelection, owner: object = doc): PointSelection {
  let index = indexes.get(owner);
  if (index?.doc !== doc || index.source !== source) { index = buildIndex(doc, source); indexes.set(owner, index); }
  const map = (point: number, affinity: Affinity) => {
    const visual = direction === 'source';
    const last = index.visualFrames[index.visualFrames.length - 1];
    if (visual && last && point > last.visualTo) return source.length;
    if (!visual && point >= source.length && doc.lastChild?.isTextblock && !doc.lastChild.content.size) return doc.content.size - 1;
    const from = (entry: Segment) => visual ? entry.visualFrom : entry.from, to = (entry: Segment) => visual ? entry.visualTo : entry.to;
    const frame = nearest(visual ? index.visualFrames : index.sourceFrames, point, from, to, affinity);
    if (!frame) return visual ? source.length : Math.min(1, doc.content.size);
    const segment = nearest(frame.segments, point, from, to, affinity);
    if (!segment) return visual ? frame.from : frame.fallback;
    if (segment.text) return visual ? sourcePoint(segment.text, point - segment.visualFrom) : segment.visualFrom + decodedPoint(segment.text, point, affinity);
    if (visual) return point >= segment.visualTo ? segment.to : segment.from;
    return point >= segment.to ? segment.visualTo : segment.visualFrom;
  };
  const forward = selection.anchor <= selection.head, collapsed = selection.anchor === selection.head;
  const maximum = direction === 'source' ? source.length : doc.content.size;
  const clamp = (value: number) => Math.max(0, Math.min(maximum, value));
  return { anchor: clamp(map(selection.anchor, forward ? 'right' : 'left')), head: clamp(map(selection.head, forward && !collapsed ? 'left' : 'right')) };
}
