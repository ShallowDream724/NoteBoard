import type { JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { AuthoringParseResult, AuthoringSpan } from './types';
import { writeAuthoring, type WrittenAuthoring } from './write';
import { changedBlockRuns, type BlockChange } from './sourceBlockChanges';
import { escapeMarkdownText } from '../editor-md/markdownTextEscape';

export interface AuthoringProjection { source: string; document: JSONContent; spans: AuthoringSpan[]; reparse?: (source: string) => AuthoringParseResult; syntheticTail?: boolean }
const projections = new WeakMap<JSONContent, AuthoringProjection>();
const bindings = new WeakMap<PMNode, { projection: AuthoringProjection; baseline: PMNode }>();
// This bounded bridge lives only between Markdown parsing and schema materialization.
// It is keyed by exact source bytes, never by another document's semantic content.
const recent = new Map<string, { projection: AuthoringProjection; bytes: number }>(); let recentBytes = 0;
const MAX_BRIDGE_BYTES = 4 * 1024 * 1024;
export function rememberParsedAuthoring(result: AuthoringParseResult, source: string, reparse?: AuthoringProjection['reparse'], bridge = true) {
  const projection = { source, document: result.document, spans: result.spans, reparse }; projections.set(result.document, projection);
  if (!bridge) return;
  const existing = recent.get(source); if (existing) { recentBytes -= existing.bytes; recent.delete(source); }
  const bytes = source.length * 2 + JSON.stringify(result.document).length * 2 + result.spans.reduce((total, span) => total + 64 + span.path.length * 8 + (span.offsets?.length ?? 0) * 8, 0);
  if (bytes > MAX_BRIDGE_BYTES) return;
  recent.set(source, { projection, bytes }); recentBytes += bytes;
  while (recentBytes > MAX_BRIDGE_BYTES || recent.size > 16) { const key = recent.keys().next().value!; recentBytes -= recent.get(key)!.bytes; recent.delete(key); }
}
export function rememberAuthoringSource(doc: PMNode, result: AuthoringParseResult | string, parsedJSON?: JSONContent) {
  const projection = typeof result === 'string'
    ? (parsedJSON && projections.get(parsedJSON)) ?? recent.get(result)?.projection ?? { source: result, document: doc.toJSON(), spans: [] }
    : projections.get(result.document);
  if (projection) {
    const actual = doc.toJSON() as JSONContent, syntheticTail = (actual.content?.length ?? 0) === (projection.document.content?.length ?? 0) + 1 && doc.lastChild?.type.name === 'paragraph' && !doc.lastChild.content.size;
    bindings.set(doc, { projection: { ...projection, document: actual, syntheticTail }, baseline: doc });
  }
}
export function inheritAuthoringSource(previous: PMNode, next: PMNode) { const binding = bindings.get(previous); if (binding) bindings.set(next, binding); }
export function forgetAuthoringSource(doc: PMNode) { bindings.delete(doc); }
/** A storage replacement supersedes any source inherited by the transaction. */
export function replaceAuthoringSource(previous: PMNode, next: PMNode) {
  const binding = bindings.get(previous);
  if (!binding) { forgetAuthoringSource(next); return; }
  const tail = next.lastChild;
  if (tail?.type.name === 'paragraph' && !tail.content.size && next.childCount === previous.childCount + 1
    && next.content.cut(0, next.content.size - tail.nodeSize).eq(previous.content)) {
    bindings.set(next, { projection: { ...binding.projection, document: next.toJSON(), syntheticTail: true }, baseline: next });
  } else bindings.set(next, binding);
}
export function hasAuthoringSource(doc: PMNode) { return bindings.has(doc); }
export function hasSyntheticAuthoringTail(doc: PMNode) {
  const tail = doc.lastChild;
  return !!bindings.get(doc)?.projection.syntheticTail && tail?.type.name === 'paragraph' && tail.eq(tail.type.create());
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const pathKey = (path: number[]) => path.join('.');
export function serializeBoundAuthoring(doc: PMNode, writeChanged?: (block: JSONContent) => string): WrittenAuthoring | null {
  const binding = bindings.get(doc); if (!binding) return null;
  const { projection, baseline } = binding;
  if (doc.eq(baseline)) return { text: projection.source, spans: projection.spans };
  const original = projection.document, current = doc.toJSON() as JSONContent;
  const byPath = new Map<string, AuthoringSpan[]>();
  for (const span of projection.spans) {
    const key = pathKey(span.path);
    const entries = byPath.get(key);
    if (entries) entries.push(span);
    else byPath.set(key, [span]);
  }
  interface Patch { from: number; to: number; text: string }
  const patches: Patch[] = [];
  const find = (path: number[], kind: AuthoringSpan['kind']) => byPath.get(pathKey(path))?.filter(span => span.kind === kind).sort((a, b) => (b.to - b.from) - (a.to - a.from))[0];
  const eol = projection.source.match(/\r?\n/)?.[0] ?? '\n';
  const writeBlock = (node: JSONContent) => (writeChanged ? writeChanged(node) : writeAuthoring(node, doc.type.schema).text).replace(/\r?\n/g, eol);
  // Item-only edits can preserve the original list, including reference links,
  // loose spacing and the author's marker. Leave nested/complex edits to the
  // ordinary diff and semantic validation.
  function spliceList(old: JSONContent, node: JSONContent, path: number[]): boolean {
    if (path.length !== 1 || !['bulletList', 'taskList', 'orderedList'].includes(node.type ?? '')) return false;
    const before = old.content ?? [], after = node.content ?? [];
    let first = 0, oldEnd = before.length, newEnd = after.length;
    while (first < oldEnd && first < newEnd && same(before[first], after[first])) first++;
    while (oldEnd > first && newEnd > first && same(before[oldEnd - 1], after[newEnd - 1])) { oldEnd--; newEnd--; }
    if (oldEnd !== first && newEnd !== first) return false;
    const block = find(path, 'node');
    if (!block) return false;
    const source = projection.source;
    const marker = /^( {0,3})([*+-]|(\d+)([.)]))([ \t]+)/;
    function itemStart(index: number) {
      if (index === before.length) return block!.to;
      if (!index) return block!.from;
      const item = find([...path, index], 'node');
      return item ? source.lastIndexOf('\n', item.from - 1) + 1 : -1;
    }
    const index = Math.min(first, before.length - 1);
    const exampleAt = itemStart(index);
    const style = exampleAt >= 0 ? marker.exec(source.slice(exampleAt, exampleAt + 32)) : null;
    const from = itemStart(first), to = itemStart(oldEnd);
    if (!style || from < block.from || to < from || to > block.to) return false;
    if (oldEnd > first) {
      const start = oldEnd === before.length && first > 0 ? source.lastIndexOf('\n', from - 1) : from;
      patches.push({ from: start > 0 && source[start - 1] === '\r' ? start - 1 : start, to, text: '' });
      return true;
    }
    const additions: string[] = [];
    for (let i = first; i < newEnd; i++) {
      const written = writeBlock({ ...node, content: [after[i]] });
      if (!marker.test(written)) return false;
      const bullet = style[3] ? String(Number(style[3]) + i - index) + style[4] : style[2];
      additions.push(written.replace(marker, () => style[1] + bullet + style[5]));
    }
    const body = additions.join(eol);
    patches.push({ from, to, text: first === before.length ? eol + body : body + eol });
    return true;
  }
  function replace(old: JSONContent, node: JSONContent, path: number[]): boolean {
    const span = find(path, 'node'); if (!span) return false;
    if (span.encoding === 'json') { patches.push({ from: span.from, to: span.to, text: JSON.stringify(node) }); return true; }
    const inline = node.type === 'text' || node.type === 'mathInline' || node.type === 'hardBreak';
    const written = path.length === 1 && writeChanged ? writeBlock(node)
      : writeAuthoring(inline ? { type: 'doc', content: [{ type: 'paragraph', content: [node] }] } : node, doc.type.schema).text;
    // Attribute-only changes to a declarative container retain its exact body,
    // including nested definitions and formatting the author did not touch.
    const raw = projection.source.slice(span.from, span.to);
    if (same(old.content, node.content) && /^ {0,3}:{3,}[ \t]+/.test(raw) && /^:{3,}[ \t]+/.test(written)) {
      const firstLine = raw.indexOf('\n'), generatedLine = written.indexOf('\n');
      if (firstLine >= 0 && generatedLine >= 0) { patches.push({ from: span.from, to: span.from + firstLine, text: written.slice(0, generatedLine).replace(/^:+/, raw.match(/^ *(:+)/)![1]) }); return true; }
    }
    patches.push({ from: span.from, to: span.to, text: written }); return true;
  }
  function diff(old: JSONContent, node: JSONContent, path: number[], parentType = ''): boolean {
    if (same(old, node)) return true;
    if (old.type !== node.type || !same(old.marks, node.marks) || !same(old.attrs, node.attrs)) {
      if (old.type === node.type && ['mathInline', 'mathBlock'].includes(node.type ?? '') && same({ ...old.attrs, latex: null }, { ...node.attrs, latex: null }) && same(old.marks, node.marks)) {
        const span = find(path, 'attribute'); if (span) { if (span.encoding === 'base64json') return replace(old, node, path); const value = String(node.attrs?.latex ?? ''); patches.push({ from: span.contentFrom ?? span.from, to: span.contentTo ?? span.to, text: span.encoding === 'json' ? JSON.stringify(value).slice(1, -1) : value }); return true; }
      }
      return replace(old, node, path);
    }
    if (old.type === 'text') {
      const span = find(path, 'text'); if (!span) return false;
      if (span.encoding === 'base64json') return replace(old, node, path);
      const raw = ['codeBlock', 'authoringRaw'].includes(parentType) || node.marks?.some(mark => mark.type === 'code' || mark.type === 'authoringLiteral');
      const before = old.text ?? '', after = node.text ?? '';
      let first = 0, oldEnd = before.length, newEnd = after.length;
      if (span.offsets?.length === before.length + 1) {
        while (first < oldEnd && first < newEnd && before[first] === after[first]) first++;
        while (oldEnd > first && newEnd > first && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd--; }
      }
      const inserted = after.slice(first, newEnd);
      const from = span.offsets?.[first] ?? span.contentFrom ?? span.from;
      const to = span.offsets?.[oldEnd] ?? span.contentTo ?? span.to;
      patches.push({ from, to, text: span.encoding === 'json' ? JSON.stringify(inserted).slice(1, -1) : raw ? inserted : escapeMarkdownText(inserted) });
      return true;
    }
    if ((old.content?.length ?? 0) !== (node.content?.length ?? 0)) return spliceList(old, node, path) || replace(old, node, path);
    const saved = patches.length;
    for (let index = 0; index < (old.content?.length ?? 0); index++) if (!diff(old.content![index], node.content![index], [...path, index], node.type)) { patches.length = saved; return replace(old, node, path); }
    return true;
  }
  const oldCount = baseline.childCount - (projection.syntheticTail ? 1 : 0);
  const hasTail = hasSyntheticAuthoringTail(doc);
  const newCount = doc.childCount - (hasTail ? 1 : 0);
  const changes = changedBlockRuns(baseline, doc, oldCount, newCount);
  const separator = eol + eol;
  let originalIndexes: Map<PMNode, number> | undefined;

  function renderRange(from: number, to: number): string[] {
    if (!originalIndexes) {
      originalIndexes = new Map();
      for (let i = 0; i < oldCount; i++) {
        const node = baseline.child(i);
        originalIndexes.set(node, originalIndexes.has(node) ? -1 : i);
      }
    }
    const blocks: string[] = [];
    for (let i = from; i < to; i++) {
      const index = originalIndexes.get(doc.child(i));
      const range = index !== undefined && index >= 0 ? find([index], 'node') : undefined;
      blocks.push(range ? projection.source.slice(range.from, range.to) : writeBlock(current.content![i]));
    }
    return blocks;
  }

  function splitParagraph(change: BlockChange): boolean {
    if (change.oldTo !== change.oldFrom + 1 || change.newTo !== change.newFrom + 2) return false;
    const old = baseline.child(change.oldFrom), left = doc.child(change.newFrom), right = doc.child(change.newFrom + 1);
    const offset = left.content.size;
    if (old.type.name !== 'paragraph' || !old.sameMarkup(left) || right.type.name !== 'paragraph' || !offset || offset >= old.content.size) return false;
    if (!old.content.cut(0, offset).eq(left.content) || !old.content.cut(offset).eq(right.content)) return false;
    const { index, offset: start } = old.childAfter(offset);
    const span = find([change.oldFrom, index], 'text');
    const at = span?.offsets?.[offset - start];
    if (at === undefined || span?.encoding) return false;
    patches.push({ from: at, to: at, text: separator });
    return true;
  }

  function patchBlocks({ oldFrom, oldTo, newFrom, newTo }: BlockChange): boolean {
    const blocks = renderRange(newFrom, newTo);
    if (oldFrom === oldTo) {
      const left = oldFrom ? find([oldFrom - 1], 'node') : undefined;
      const right = oldFrom < oldCount ? find([oldFrom], 'node') : undefined;
      if (!left && !right && oldCount) return false;
      const at = right?.from ?? left?.to ?? 0;
      const body = blocks.join(separator);
      patches.push({ from: at, to: at, text: right ? body + separator : left ? separator + body : body });
      return true;
    }
    const first = find([oldFrom], 'node'), last = find([oldTo - 1], 'node');
    if (!first || !last || first.from > last.to) return false;
    // Retain gaps with comments or link definitions even when several adjacent
    // rendered blocks are replaced. These bytes have no editable node.
    const gaps: string[] = [];
    let previous = first;
    for (let i = oldFrom + 1; i < oldTo; i++) {
      const next = find([i], 'node');
      if (!next || next.from < previous.to) return false;
      const gap = projection.source.slice(previous.to, next.from);
      if (/\S/.test(gap)) gaps.push(gap);
      previous = next;
    }
    let from = first.from, to = last.to;
    if (!blocks.length) {
      const right = find([oldTo], 'node'), left = oldFrom ? find([oldFrom - 1], 'node') : undefined;
      if (right && /^\s*$/.test(projection.source.slice(to, right.from))) to = right.from;
      else if (left && /^\s*$/.test(projection.source.slice(left.to, from))) from = left.to;
    }
    patches.push({ from, to, text: blocks.join(separator) + gaps.join('') });
    return true;
  }

  function materialize(): string | null {
    patches.sort((a, b) => a.from - b.from);
    let cursor = 0, text = '';
    for (const patch of patches) {
      if (patch.from < cursor || patch.to < patch.from || patch.to > projection.source.length) return null;
      text += projection.source.slice(cursor, patch.from) + patch.text;
      cursor = patch.to;
    }
    return text + projection.source.slice(cursor);
  }

  function validate(text: string): WrittenAuthoring | null {
    if (!projection.reparse) return { text, spans: [] };
    const parsed = projection.reparse(text);
    const candidate = doc.type.schema.nodeFromJSON(parsed.document);
    if (!doc.eq(candidate)) {
      if (!hasTail || !doc.copy(doc.content.cut(0, doc.content.size - doc.lastChild!.nodeSize)).eq(candidate)) return null;
    }
    rememberAuthoringSource(doc, parsed);
    return { text, spans: parsed.spans };
  }

  let previousText: string | null = null;
  for (const fine of [true, false]) {
    patches.length = 0;
    const complete = changes.every(change => {
      if (fine && splitParagraph(change)) return true;
      if (fine && change.oldTo - change.oldFrom === change.newTo - change.newFrom) {
        for (let i = change.oldFrom; i < change.oldTo; i++) {
          if (!diff(original.content![i], current.content![i - change.oldFrom + change.newFrom], [i])) return false;
        }
        return true;
      }
      return patchBlocks(change);
    });
    if (!complete) continue;
    const text = materialize();
    if (text === null || text === previousText) continue;
    previousText = text;
    try {
      const result = validate(text);
      if (result) return result;
    } catch {
      // A candidate patch may cross a Markdown delimiter. Retry at block scope.
    }
  }
  return null;
}
