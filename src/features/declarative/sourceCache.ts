import type { JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { AuthoringParseResult, AuthoringSpan } from './types';
import { writeAuthoring, type WrittenAuthoring } from './write';

export interface AuthoringProjection { source: string; document: JSONContent; spans: AuthoringSpan[]; reparse?: (source: string) => AuthoringParseResult; syntheticTail?: boolean }
const projections = new WeakMap<JSONContent, AuthoringProjection>();
const bindings = new WeakMap<PMNode, { projection: AuthoringProjection; baseline: PMNode }>();
// This bounded bridge lives only between Markdown parsing and schema materialization.
// It is keyed by exact source bytes, never by another document's semantic content.
const recent = new Map<string, { projection: AuthoringProjection; bytes: number }>(); let recentBytes = 0;
const MAX_BRIDGE_BYTES = 4 * 1024 * 1024;
export function rememberParsedAuthoring(result: AuthoringParseResult, source: string, reparse?: AuthoringProjection['reparse']) {
  const projection = { source, document: result.document, spans: result.spans, reparse }; projections.set(result.document, projection);
  const existing = recent.get(source); if (existing) { recentBytes -= existing.bytes; recent.delete(source); }
  const bytes = source.length * 2 + JSON.stringify(result.document).length * 2 + result.spans.reduce((total, span) => total + 64 + span.path.length * 8 + (span.offsets?.length ?? 0) * 8, 0);
  if (bytes > MAX_BRIDGE_BYTES) return;
  recent.set(source, { projection, bytes }); recentBytes += bytes;
  while (recentBytes > MAX_BRIDGE_BYTES || recent.size > 16) { const key = recent.keys().next().value!; recentBytes -= recent.get(key)!.bytes; recent.delete(key); }
}
export function rememberAuthoringSource(doc: PMNode, result: AuthoringParseResult | string) {
  const projection = typeof result === 'string' ? recent.get(result)?.projection ?? { source: result, document: doc.toJSON(), spans: [] } : projections.get(result.document);
  if (projection) {
    const actual = doc.toJSON() as JSONContent, syntheticTail = (actual.content?.length ?? 0) === (projection.document.content?.length ?? 0) + 1 && doc.lastChild?.type.name === 'paragraph' && !doc.lastChild.content.size;
    bindings.set(doc, { projection: { ...projection, document: actual, syntheticTail }, baseline: doc });
  }
}
export function inheritAuthoringSource(previous: PMNode, next: PMNode) { const binding = bindings.get(previous); if (binding) bindings.set(next, binding); }
export function hasAuthoringSource(doc: PMNode) { return bindings.has(doc); }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const pathKey = (path: number[]) => path.join('.');
const escapeText = (text: string) => text.replace(/[\\`*_[\]{}<>!~|]/g, '\\$&');
export function serializeBoundAuthoring(doc: PMNode): WrittenAuthoring | null {
  const binding = bindings.get(doc); if (!binding) return null;
  const { projection, baseline } = binding;
  if (doc.eq(baseline)) return { text: projection.source, spans: projection.spans };
  const original = projection.document, current = doc.toJSON() as JSONContent;
  const byPath = new Map<string, AuthoringSpan[]>(); for (const span of projection.spans) { const key = pathKey(span.path); byPath.set(key, [...(byPath.get(key) ?? []), span]); }
  interface Patch { from: number; to: number; text: string }
  const patches: Patch[] = [];
  const find = (path: number[], kind: AuthoringSpan['kind']) => byPath.get(pathKey(path))?.filter(span => span.kind === kind).sort((a, b) => (b.to - b.from) - (a.to - a.from))[0];
  function replace(old: JSONContent, node: JSONContent, path: number[]): boolean {
    const span = find(path, 'node'); if (!span) return false;
    if (span.encoding === 'json') { patches.push({ from: span.from, to: span.to, text: JSON.stringify(node) }); return true; }
    let written: WrittenAuthoring;
    if (node.type === 'text' || node.type === 'mathInline' || node.type === 'hardBreak') written = writeAuthoring({ type: 'doc', content: [{ type: 'paragraph', content: [node] }] }, doc.type.schema);
    else written = writeAuthoring(node, doc.type.schema);
    // Attribute-only changes to a declarative container retain its exact body,
    // including nested definitions and formatting the author did not touch.
    const raw = projection.source.slice(span.from, span.to);
    if (same(old.content, node.content) && /^ {0,3}:{3,}[ \t]+/.test(raw) && /^:{3,}[ \t]+/.test(written.text)) {
      const firstLine = raw.indexOf('\n'), generatedLine = written.text.indexOf('\n');
      if (firstLine >= 0 && generatedLine >= 0) { patches.push({ from: span.from, to: span.from + firstLine, text: written.text.slice(0, generatedLine).replace(/^:+/, raw.match(/^ *(:+)/)![1]) }); return true; }
    }
    patches.push({ from: span.from, to: span.to, text: written.text }); return true;
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
      patches.push({ from: span.contentFrom ?? span.from, to: span.contentTo ?? span.to, text: span.encoding === 'json' ? JSON.stringify(node.text ?? '').slice(1, -1) : raw ? node.text ?? '' : escapeText(node.text ?? '') }); return true;
    }
    if ((old.content?.length ?? 0) !== (node.content?.length ?? 0)) return replace(old, node, path);
    const saved = patches.length;
    for (let index = 0; index < (old.content?.length ?? 0); index++) if (!diff(old.content![index], node.content![index], [...path, index], node.type)) { patches.length = saved; return replace(old, node, path); }
    return true;
  }
  if (!diff(original, current, [])) return null;
  patches.sort((a, b) => a.from - b.from);
  if (patches.some((patch, index) => index && patch.from < patches[index - 1].to)) return null;
  let cursor = 0, text = ''; for (const patch of patches) { text += projection.source.slice(cursor, patch.from) + patch.text; cursor = patch.to; } text += projection.source.slice(cursor);
  if (projection.reparse) {
    const parsed = projection.reparse(text);
    try {
      const candidate = doc.type.schema.nodeFromJSON(parsed.document);
      if (!doc.eq(candidate)) {
        const withoutTail = { ...current, content: current.content?.slice(0, -1) };
        if (!projection.syntheticTail || !doc.lastChild || doc.lastChild.type.name !== 'paragraph' || doc.lastChild.content.size || !doc.type.schema.nodeFromJSON(withoutTail).eq(candidate)) return null;
      }
    } catch { return null; }
    rememberAuthoringSource(doc, parsed); return { text, spans: parsed.spans };
  }
  return { text, spans: [] };
}
