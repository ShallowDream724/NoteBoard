import type { JSONContent } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';
import { documentColor } from './colors';
import { BLOCK_COLOR_FIELDS, BLOCK_COLOR_TYPES } from './blockAppearanceSchema';
import { normalizeNumberingStyle } from '../editor-md/numbering/styles';

const PREFIX = '<!-- noteboard-styles ';
const MAX_BYTES = 2_000_000, MAX_RECORDS = 20_000;
type Attributes = Record<string, string | number>;
interface Range { from: number; to: number; kind: 'highlight' | 'textColor'; color: string | null }
interface RecordEntry { path: number[]; attrs?: Attributes; ranges?: Range[] }
interface BlockEntry { index: number; guard: string; records: RecordEntry[] }
interface Metadata { version: 1; guard: string; blocks: BlockEntry[] }
interface Manager { serialize: (json: JSONContent) => string; parse: (markdown: string) => JSONContent }
const installed = new WeakSet<object>();
const textBlocks = new Set(['paragraph', 'heading']);
const indentBlocks = new Set(['paragraph', 'heading', 'horizontalRule']);
const cells = new Set(['tableCell', 'tableHeader']);
const coloredBlocks = new Set<string>(BLOCK_COLOR_TYPES);

/** Only remove our well-formed final comment, never a fenced/quoted example. */
export function presentationBody(markdown: string, lexer: { lexer: (source: string) => Array<{ type: string; raw: string }> }): string {
  const tokens = lexer.lexer(markdown).filter(token => token.type !== 'space'), last = tokens[tokens.length - 1];
  if (last?.type !== 'html' || !last.raw.startsWith(PREFIX)) return markdown;
  const tail = last.raw.trimEnd();
  try {
    if (tail.endsWith(' -->') && JSON.parse(tail.slice(PREFIX.length, -4))?.version === 1) {
      const start = markdown.lastIndexOf(PREFIX), before = markdown.slice(0, start), separator = /(?:\r?\n){2}$/.exec(before)?.[0].length ?? 0;
      if (start > 0 && !separator) return markdown;
      return before.slice(0, before.length - separator);
    }
  } catch { /* ordinary source */ }
  return markdown;
}

function presentationAttrs(node: JSONContent): Attributes {
  const attrs: Attributes = {}, source = node.attrs ?? {};
  if (coloredBlocks.has(node.type!)) for (const field of BLOCK_COLOR_FIELDS) {
    const color = documentColor(source[field]); if (color) attrs[field] = color;
  }
  if (textBlocks.has(node.type!) && ['left', 'center', 'right'].includes(source.textAlign)) attrs.textAlign = source.textAlign;
  if (indentBlocks.has(node.type!) && Number.isInteger(source.indent) && source.indent > 0 && source.indent <= 8) attrs.indent = source.indent;
  if (cells.has(node.type!) && ['top', 'middle', 'bottom'].includes(source.verticalAlign)) attrs.verticalAlign = source.verticalAlign;
  if (cells.has(node.type!) && ['left', 'center', 'right'].includes(source.textAlign ?? source.align)) attrs.align = source.textAlign ?? source.align;
  if (node.type === 'mathBlock' && ['left', 'right'].includes(source.textAlign)) attrs.textAlign = source.textAlign;
  if (node.type === 'mathBlock') for (const key of ['textColor', 'background']) {
    const color = documentColor(source[key]); if (color) attrs[key] = color;
  }
  if (node.type === 'orderedList') {
    if (typeof source.numberStyle === 'string' && normalizeNumberingStyle(source.numberStyle) === source.numberStyle) attrs.numberStyle = source.numberStyle;
    if (source.numbering === 'continue' || source.numbering === 'restart') attrs.numbering = source.numbering;
  }
  return attrs;
}
function extract(node: JSONContent, path: number[], records: RecordEntry[]): JSONContent {
  const attrs = presentationAttrs(node), ranges: Range[] = [];
  let offset = 0;
  if (textBlocks.has(node.type!)) for (const child of node.content ?? []) {
    const size = child.text?.length ?? 1;
    for (const mark of child.marks ?? []) if (mark.type === 'highlight' || mark.type === 'textColor') {
      const color = documentColor(mark.attrs?.color);
      if (mark.type === 'highlight' || color) ranges.push({ from: offset, to: offset + size, kind: mark.type, color });
    }
    offset += size;
  }
  if (Object.keys(attrs).length || ranges.length) records.push({ path, ...(Object.keys(attrs).length ? { attrs } : {}), ...(ranges.length ? { ranges } : {}) });
  const cleanAttrs = { ...node.attrs };
  if (coloredBlocks.has(node.type!)) for (const field of BLOCK_COLOR_FIELDS) delete cleanAttrs[field];
  if (node.type === 'table') delete cleanAttrs.tableAlign;
  if (textBlocks.has(node.type!)) delete cleanAttrs.textAlign;
  if (indentBlocks.has(node.type!)) delete cleanAttrs.indent;
  if (cells.has(node.type!)) { delete cleanAttrs.align; delete cleanAttrs.textAlign; delete cleanAttrs.verticalAlign; }
  if (node.type === 'mathBlock') { delete cleanAttrs.textColor; delete cleanAttrs.background; delete cleanAttrs.textAlign; }
  if (node.type === 'orderedList') { delete cleanAttrs.numberStyle; delete cleanAttrs.numbering; }
  return { ...node, ...(node.attrs ? { attrs: cleanAttrs } : {}),
    ...(node.marks ? { marks: node.marks.filter(mark => mark.type !== 'highlight' && mark.type !== 'textColor') } : {}),
    ...(node.content ? { content: node.content.map((child, index) => extract(child, [...path, index], records)) } : {}) };
}
/** A guard identifies exact semantic content/structure, never a global text search.
 * Two independent 32-bit accumulators and length make accidental reuse unlikely. */
function guard(node: JSONContent) {
  const plain = extract(node, [], []);
  const signature = JSON.stringify(plain);
  let a = 2166136261, b = 5381;
  for (let i = 0; i < signature.length; i++) { const c = signature.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = Math.imul(b, 33) ^ c; }
  return `${signature.length.toString(36)}:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`;
}
function canonical(schema: Schema, json: JSONContent): JSONContent { return schema.nodeFromJSON(json).toJSON(); }
function applyRanges(node: JSONContent, ranges: Range[]) {
  const groups = ['highlight', 'textColor'].map(kind => ranges.filter(range => range.kind === kind).sort((a,b) => a.from - b.from));
  for (const group of groups) for (let index = 1; index < group.length; index++) if (group[index].from < group[index-1].to) return;
  const cursors = [0,0];
  let offset = 0;
  node.content = (node.content ?? []).flatMap(child => {
    const length = child.text?.length ?? 1, start = offset; offset += length;
    if (!child.text && child.type !== 'mathInline') return [child];
    const local: Range[] = [];
    groups.forEach((group, g) => {
      while (group[cursors[g]]?.to <= start) cursors[g]++;
      for (let index = cursors[g]; index < group.length && group[index].from < offset; index++) local.push(group[index]);
    });
    if (!local.length) return [child];
    const points = [...new Set([0, length, ...local.flatMap(range => [Math.max(0, range.from - start), Math.min(length, range.to - start)])])].sort((a,b) => a-b);
    return points.slice(0, -1).map((from, index) => {
      const marks = [...(child.marks ?? [])];
      groups.forEach((group, g) => {
        while (group[cursors[g]]?.to <= start + from) cursors[g]++;
        const range = group[cursors[g]];
        if (range && range.from <= start + from && range.to >= start + points[index+1]) {
        const old = marks.findIndex(mark => mark.type === range.kind); if (old >= 0) marks.splice(old, 1);
        marks.push({ type: range.kind, attrs: { color: range.color } });
        }
      });
      return { ...child, ...(child.text ? { text: child.text.slice(from, points[index+1]) } : {}), marks };
    });
  });
}
function restore(json: JSONContent, value: unknown): JSONContent {
  const metadata = value as Partial<Metadata>;
  if (!metadata || metadata.version !== 1 || !Array.isArray(metadata.blocks) || metadata.blocks.length > MAX_RECORDS) return json;
  const blocks = json.content ?? [], byGuard = new Map<string, number[]>();
  const unchanged = guard(json) === metadata.guard;
  blocks.forEach((block, index) => { const key = guard(block), indices = byGuard.get(key) ?? []; indices.push(index); byGuard.set(key, indices); });
  const used = new Set<number>(); let count = 0;
  for (const entry of metadata.blocks) {
    if (!entry || typeof entry.guard !== 'string' || !Array.isArray(entry.records) || (count += entry.records.length) > MAX_RECORDS) continue;
    // Unique matching blocks can survive insertion/reordering. Ambiguous copies
    // are deliberately ignored, even at the previous index.
    const matches = byGuard.get(entry.guard);
    const target = unchanged && Number.isInteger(entry.index) && matches?.includes(entry.index) ? entry.index : matches?.length === 1 ? matches[0] : undefined;
    if (target === undefined || used.has(target)) continue;
    const block = blocks[target]; used.add(target);
    for (const record of entry.records) {
      if (!record || !Array.isArray(record.path) || record.path.length > 64 || record.path.some(index => !Number.isInteger(index) || index < 0)) continue;
      let node: JSONContent | undefined = block;
      for (const index of record.path) node = node?.content?.[index];
      if (!node) continue;
      if (record.attrs && typeof record.attrs === 'object') node.attrs = { ...node.attrs, ...presentationAttrs({ type: node.type, attrs: record.attrs }) };
      if (textBlocks.has(node.type!) && Array.isArray(record.ranges) && record.ranges.length <= MAX_RECORDS) {
        const length = (node.content ?? []).reduce((sum, child) => sum + (child.text?.length ?? 1), 0);
        const ranges = record.ranges.filter(range => range && Number.isInteger(range.from) && Number.isInteger(range.to) && range.from >= 0 && range.to > range.from && range.to <= length
          && (range.kind === 'highlight' || range.kind === 'textColor') && (range.kind === 'highlight' && range.color === null || documentColor(range.color) !== null));
        applyRanges(node, ranges);
      }
    }
  }
  return json;
}

/** Install once on the shared grammar manager: editor, workers and clipboard
 * use the same body-first codec. No editor/view references are retained. */
export function installPresentationCodec<T extends Manager>(manager: T, schema: Schema): T {
  if (installed.has(manager)) return manager;
  installed.add(manager);
  const serialize = manager.serialize.bind(manager), parse = manager.parse.bind(manager);
  manager.serialize = json => {
    if (json.type !== 'doc') return serialize(json);
    const blocks: BlockEntry[] = [];
    const clean = { ...json, content: (json.content ?? []).map((block, index) => {
      const records: RecordEntry[] = [], stripped = extract(block, [], records);
      if (records.length) blocks.push({ index, guard: '', records });
      return stripped;
    }) };
    if (!blocks.length) return serialize(json);
    if (blocks.length > MAX_RECORDS || blocks.reduce((sum, block) => sum + block.records.length, 0) > MAX_RECORDS
      || blocks.some(block => block.records.some(record => (record.ranges?.length ?? 0) > MAX_RECORDS))) throw new Error('独立样式范围过多，请简化样式后保存');
    const normalized = canonical(schema, clean), raw = serialize(normalized);
    for (const block of blocks) block.guard = guard(normalized.content![block.index]);
    const metadata = JSON.stringify({ version: 1, guard: guard(normalized), blocks }).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('--', '\\u002d\\u002d');
    if (metadata.length > MAX_BYTES) throw new Error('样式数据过大，请减少独立样式范围后保存');
    return `${raw.trimEnd()}\n\n${PREFIX}${metadata} -->`;
  };
  manager.parse = markdown => {
    // Only a standalone final HTML token may carry metadata. A code fence or a
    // quoted example containing the same text must stay ordinary content.
    const candidate = markdown.lastIndexOf(PREFIX), offset = candidate === 0 || candidate > 0 && /(?:\r?\n){2}$/.test(markdown.slice(0, candidate)) ? candidate : -1;
    if (offset < 0 || markdown.length - offset > MAX_BYTES + PREFIX.length + 16) return parse(markdown);
    const tail = markdown.slice(offset).trimEnd();
    if (!tail.endsWith(' -->')) return parse(markdown);
    // Parsing the candidate body separately is insufficient for an open fence.
    // The original lexer knows whether this last comment is top-level HTML.
    const lexer = (manager as T & { instance?: { lexer: (input: string) => Array<{ type: string; raw: string }> } }).instance;
    if (lexer) {
      const tokens = lexer.lexer(markdown).filter(token => token.type !== 'space');
      const last = tokens[tokens.length - 1];
      if (last?.type !== 'html' || last.raw.trimEnd() !== tail) return parse(markdown);
    } else return parse(markdown);
    let value: unknown; try { value = JSON.parse(tail.slice(PREFIX.length, -4)); } catch { return parse(markdown); }
    if ((value as Partial<Metadata>)?.version !== 1) return parse(markdown);
    const plain = parse(markdown.slice(0, offset).trimEnd());
    try { return restore(canonical(schema, plain), value); } catch { return plain; }
  };
  return manager;
}
