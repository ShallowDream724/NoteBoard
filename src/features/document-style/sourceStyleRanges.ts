import type { Node as DocumentNode } from '@tiptap/pm/model';
import type { JSONContent } from '@tiptap/core';
import { mapDocumentPositions } from '../editor-md/sourcePosition';
import { documentColor } from './colors';
import type { StyleSpan } from './styleSpanTree';

export type StyleLayer = 'text' | 'block' | 'cell' | 'math';
export interface SpanStyle { kind: StyleLayer; attrs: Record<string, string | number | null> }
export type SourceStyleRange = StyleSpan<SpanStyle>;
type Manager = Parameters<typeof mapDocumentPositions>[1];

/** Four radix passes keep endpoint ordering linear even in heavily styled
 * documents. No repeated prefix searches or per-range editor transactions. */
function endpoints(ranges: readonly SourceStyleRange[]): number[] {
  let input = new Uint32Array(ranges.length * 2), output = new Uint32Array(input.length);
  ranges.forEach((range, index) => { input[index * 2] = range.from; input[index * 2 + 1] = range.to; });
  for (let shift = 0; shift < 32; shift += 8) {
    const counts = new Uint32Array(256);
    for (const value of input) counts[(value >>> shift) & 255]++;
    let total = 0;
    for (let i = 0; i < 256; i++) { const count = counts[i]; counts[i] = total; total += count; }
    for (const value of input) output[counts[(value >>> shift) & 255]++] = value;
    [input, output] = [output, input];
  }
  const unique: number[] = [];
  for (const value of input) if (unique[unique.length - 1] !== value) unique.push(value);
  return unique;
}
export function mapStyleRanges(doc: DocumentNode, manager: Manager, body: string, direction: 'source' | 'visual', ranges: readonly SourceStyleRange[]): SourceStyleRange[] {
  if (!ranges.length) return [];
  const points = endpoints(ranges), mapped = mapDocumentPositions(doc, manager, body, direction, points);
  const lookup = new Map(points.map((point, index) => [point, mapped[index]]));
  return ranges.map(range => ({ ...range, from: lookup.get(range.from)!, to: lookup.get(range.to)! })).filter(range => range.to > range.from);
}
export function documentStyleRanges(doc: DocumentNode): SourceStyleRange[] {
  const ranges: SourceStyleRange[] = [];
  doc.descendants((node, pos) => {
    if (node.isText || node.type.name === 'mathInline') {
      const color = documentColor(node.marks.find(mark => mark.type.name === 'textColor')?.attrs.color);
      const highlight = node.marks.find(mark => mark.type.name === 'highlight');
      if (color || highlight) ranges.push({ from: pos, to: pos + node.nodeSize,
        value: { kind: 'text', attrs: { color, background: highlight ? documentColor(highlight.attrs.color) ?? '#fef08a' : null } } });
    } else if (node.type.name === 'mathBlock') {
      const textColor = documentColor(node.attrs.textColor), background = documentColor(node.attrs.background);
      if (textColor || background) ranges.push({ from: pos, to: pos + node.nodeSize, value: { kind: 'math', attrs: { textColor, background } } });
    } else {
      const attrs: SpanStyle['attrs'] = {}; let kind: StyleLayer | undefined;
      if (['paragraph','heading'].includes(node.type.name)) {
        kind = 'block';
        if (node.attrs.textAlign) attrs.textAlign = node.attrs.textAlign;
        if (node.attrs.indent) attrs.indent = node.attrs.indent;
      } else if (['tableCell','tableHeader'].includes(node.type.name)) {
        kind = 'cell';
        if (node.attrs.align) attrs.align = node.attrs.align;
        if (node.attrs.verticalAlign) attrs.verticalAlign = node.attrs.verticalAlign;
      }
      if (kind && Object.keys(attrs).length && node.content.size) ranges.push({ from: pos + 1, to: pos + node.nodeSize - 1, value: { kind, attrs } });
    }
  });
  return ranges;
}

/** Apply ordered runs with one document traversal. Text splitting preserves
 * other marks; block/cell attributes remain separate from inline colors. */
export function applyStyleRanges(doc: DocumentNode, ranges: readonly SourceStyleRange[]): JSONContent {
  const layers = { text: ranges.filter(range => range.value.kind === 'text'), block: ranges.filter(range => range.value.kind === 'block'), cell: ranges.filter(range => range.value.kind === 'cell'), math: ranges.filter(range => range.value.kind === 'math') };
  const cursor = { text: 0, block: 0, cell: 0, math: 0 };
  function visit(node: DocumentNode, pos: number): JSONContent[] {
    if (node.isText || node.type.name === 'mathInline') {
      const pieces: JSONContent[] = []; let at = pos; const end = pos + node.nodeSize;
      while (at < end) {
        while (layers.text[cursor.text]?.to <= at) cursor.text++;
        const range = layers.text[cursor.text];
        const styled = range && range.from <= at && range.to > at;
        const to = Math.min(end, styled ? range.to : range?.from ?? end);
        const json: JSONContent = node.isText ? { type: 'text', text: node.text!.slice(at - pos, to - pos) } : node.toJSON();
        const marks = node.marks.map(mark => mark.toJSON());
        if (styled) {
          json.marks = marks.filter(mark => !['textColor','highlight'].includes(mark.type));
          if (range.value.attrs.color) json.marks.push({ type: 'textColor', attrs: { color: range.value.attrs.color } });
          if (range.value.attrs.background) json.marks.push({ type: 'highlight', attrs: { color: range.value.attrs.background } });
        } else json.marks = marks;
        pieces.push(json); at = to;
      }
      return pieces;
    }
    const json: JSONContent = { type: node.type.name, attrs: { ...node.attrs } };
    if (node.marks.length) json.marks = node.marks.map(mark => mark.toJSON());
    const kind = node.type.name === 'mathBlock' ? 'math' : ['paragraph','heading'].includes(node.type.name) ? 'block' : ['tableCell','tableHeader'].includes(node.type.name) ? 'cell' : undefined;
    if (kind) {
      const start = kind === 'math' ? pos : pos + 1, end = kind === 'math' ? pos + node.nodeSize : pos + node.nodeSize - 1;
      while (kind === 'math' ? layers[kind][cursor[kind]]?.to <= start : layers[kind][cursor[kind]]?.to < start) cursor[kind]++;
      const range = layers[kind][cursor[kind]];
      if (range && (kind === 'math' ? range.from < end && range.to > start : range.from <= end && range.to >= start)) Object.assign(json.attrs!, range.value.attrs);
    }
    if (node.content.size) {
      json.content = []; let childPos = pos + 1;
      node.forEach(child => { json.content!.push(...visit(child, childPos)); childPos += child.nodeSize; });
    }
    return [json];
  }
  return visit(doc, -1)[0];
}
