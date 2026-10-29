import type { JSONContent } from '@tiptap/core';
import type { marked } from 'marked';
import { readInlineCommand, readBlockCommand, type SourceRecord } from './syntax';
import type { ResolvedSource } from './resolve';
import type { AuthoringSpan } from './types';
import { nativeInlineEncoding, nativeJsonSpans } from './nativeJsonSpans';

interface Segment { text: string; offsets: number[]; kind: 'text' | 'attribute' }
interface Token { type?: string; raw?: string; text?: string; latex?: string; tokens?: Token[]; items?: Token[]; header?: { tokens?: Token[]; text?: string }[]; rows?: { tokens?: Token[]; text?: string }[][]; groupTokens?: Token[][]; command?: { name: string; error?: string }; [key: string]: unknown }
const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
function decoded(raw: string, base: number, kind: Segment['kind'] = 'text'): Segment {
  let text = ''; const offsets: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entity = raw[i] === '&' ? /^&(#x[\da-f]+|#\d+|[a-z]+);/i.exec(raw.slice(i)) : null;
    if (entity) {
      const value = entity[1][0] === '#' ? String.fromCodePoint(parseInt(entity[1].slice(entity[1][1]?.toLowerCase() === 'x' ? 2 : 1), entity[1][1]?.toLowerCase() === 'x' ? 16 : 10)) : entities[entity[1]];
      if (value) { for (let j = 0; j < value.length; j++) offsets.push(base + i); text += value; i += entity[0].length - 1; continue; }
    }
    offsets.push(base + i); text += raw[i];
  }
  offsets.push(base + raw.length); return { text, offsets, kind };
}
/** Map through stripped Markdown container prefixes without a document-wide text lookup. */
function childLocation(raw: string, region: string, offsets: number[], from: number): { offsets: number[]; end: number } {
  const exact = region.indexOf(raw, from);
  if (exact >= 0) return { offsets: offsets.slice(exact, exact + raw.length + 1), end: exact + raw.length };
  const mapped: number[] = []; let cursor = from;
  for (const char of raw) { const next = region.indexOf(char, cursor); if (next < 0) { mapped.push(offsets[Math.min(cursor, offsets.length - 1)]); } else { mapped.push(offsets[next]); cursor = next + 1; } }
  mapped.push(offsets[Math.min(cursor, offsets.length - 1)]); return { offsets: mapped, end: cursor };
}
function collect(tokens: Token[], region: string, offsets: number[], output: Segment[], lexer: typeof marked, includeDefinitions = false) {
  let cursor = 0;
  for (const token of tokens) {
    const raw = token.raw ?? token.text ?? '', location = childLocation(raw, region, offsets, cursor); cursor = location.end;
    const own = location.offsets, base = own[0] ?? offsets[0] ?? 0;
    const push = (segment: Segment, relative = 0) => { segment.offsets = segment.offsets.map(offset => own[Math.min(raw.length, Math.max(0, offset - base + relative))] ?? base); output.push(segment); };
    if (token.type === 'authoringInlineSyntax') {
      const command = readInlineCommand(raw);
      if (!command || command.error) { output.push({ text: raw, offsets: own, kind: 'text' }); continue; }
      const groups = command.name === 'note' ? command.groups.slice(0, 1) : command.groups;
      groups.forEach((group, index) => collect(token.groupTokens?.[index] ?? lexer.Lexer.lexInline(group.text, lexer.defaults) as unknown as Token[], group.text, own.slice(group.from, group.to + 1), output, lexer));
    } else if (token.type === 'authoringBlockSyntax') {
      const command = readBlockCommand(raw);
      if (!command || !command.closed || !token.tokens?.length) { if (command?.name !== 'native' && !['annotation', 'explain'].includes(command?.name ?? '')) output.push({ text: raw, offsets: own, kind: 'text' }); continue; }
      if (includeDefinitions || !['annotation', 'explain'].includes(command.name)) collect(token.tokens, command.body, own.slice(command.bodyFrom, command.bodyFrom + command.body.length + 1), output, lexer, includeDefinitions);
    } else if (token.type === 'mathInline' || token.type === 'mathBlock') {
      const value = String(token.latex ?? ''), at = raw.indexOf(value); output.push({ text: value, offsets: own.slice(Math.max(0, at), Math.max(0, at) + value.length + 1), kind: 'attribute' });
    } else if (token.type === 'code' || token.type === 'codespan') {
      const value = String(token.text ?? ''), at = raw.indexOf(value); output.push({ text: value, offsets: own.slice(Math.max(0, at), Math.max(0, at) + value.length + 1), kind: 'text' });
    } else if (token.type === 'escape') output.push({ text: String(token.text ?? ''), offsets: [own[1] ?? base, own[raw.length] ?? base + raw.length], kind: 'text' });
    else if (token.tokens?.length) collect(token.tokens, raw, own, output, lexer, includeDefinitions);
    else if (token.items?.length) collect(token.items, raw, own, output, lexer, includeDefinitions);
    else if (token.header || token.rows) {
      const cells = [...(token.header ?? []), ...(token.rows ?? []).flat()]; let cellCursor = 0;
      for (const cell of cells) { const value = cell.text ?? '', where = childLocation(value, raw, own, cellCursor); cellCursor = where.end; collect(cell.tokens ?? [], value, where.offsets, output, lexer, includeDefinitions); }
    } else if (token.type === 'text') push(decoded(String(token.text ?? raw), base));
  }
}
export function authoringSpans(document: JSONContent, source: string, lexer: typeof marked, records: ResolvedSource[]): AuthoringSpan[] {
  const spans: AuthoringSpan[] = [], root: Segment[] = [], indices = Array.from({ length: source.length + 1 }, (_, index) => index);
  collect(lexer.lexer(source) as unknown as Token[], source, indices, root, lexer);
  const recordMap = new WeakMap<JSONContent, SourceRecord>(); for (const entry of records) recordMap.set(entry.node, entry.source);
  const usedRaw = new Map<string, number>();
  interface Pool { segments: Segment[]; index: number; offset: number }
  function match(value: string, kind: Segment['kind'], pool: Pool, path: number[]) {
    if (!value) return;
    for (let start = pool.index; start < pool.segments.length; start++) {
      const candidate = pool.segments[start]; if (candidate.kind !== kind) continue;
      const offset = start === pool.index ? pool.offset : 0; if (!value.startsWith(candidate.text.slice(offset)) && !candidate.text.slice(offset).startsWith(value)) continue;
      let remaining = value, index = start, local = offset; const mapped: number[] = [];
      while (remaining && index < pool.segments.length) {
        const segment = pool.segments[index]; if (segment.kind !== kind) break;
        const part = segment.text.slice(local), length = Math.min(remaining.length, part.length);
        if (remaining.slice(0, length) !== part.slice(0, length)) break;
        mapped.push(...segment.offsets.slice(local, local + length)); remaining = remaining.slice(length); local += length;
        if (local === segment.text.length) { index++; local = 0; }
      }
      if (remaining) continue;
      const last = (local ? pool.segments[index]?.offsets[local] : pool.segments[index - 1]?.offsets.at(-1)) ?? mapped.at(-1)! + 1; mapped.push(last);
      pool.index = index; pool.offset = local;
      spans.push({ path, kind, from: mapped[0], to: mapped.at(-1)!, contentFrom: mapped[0], contentTo: mapped.at(-1)!, offsets: mapped }); return;
    }
  }
  function walk(node: JSONContent, path: number[], pool: Pool) {
    const info = recordMap.get(node); let range: { from: number; to: number } | undefined, active = pool;
    if (info) {
      const at = source.indexOf(info.raw, usedRaw.get(info.raw) ?? 0);
      if (at >= 0) { usedRaw.set(info.raw, at + info.raw.length); range = { from: at, to: at + info.raw.length };
        if (info.kind === 'native') {
          const block = readBlockCommand(info.raw); if (block) spans.push(...nativeJsonSpans(block.body, node, path, offset => at + block.bodyFrom + offset));
          spans.push({ path, kind: 'node', ...range }); return;
        }
        if (info.kind === 'native-inline') {
          const command = readInlineCommand(info.raw), group = command?.groups[0];
          if (group) try { const bytes = Uint8Array.from(atob(group.text.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0)), json = new TextDecoder('utf-8', { fatal: true }).decode(bytes), { offsets } = nativeInlineEncoding(json); spans.push(...nativeJsonSpans(json, node, path, offset => at + group.from + offsets[offset], 'base64json')); } catch { /* Invalid carrier recovered separately. */ }
          spans.push({ path, kind: 'node', ...range }); return;
        }
        if (node.type === 'annotationBody') {
          const command = info.raw.startsWith('\\') ? readInlineCommand(info.raw) : null, block = command ? null : readBlockCommand(info.raw);
          const raw = command?.groups[1]?.text ?? block?.body ?? '', relative = command?.groups[1]?.from ?? block?.bodyFrom ?? 0, segments: Segment[] = [];
          const map = indices.slice(at + relative, at + relative + raw.length + 1);
          if (command) collect(lexer.Lexer.lexInline(raw, lexer.defaults) as Token[], raw, map, segments, lexer, true); else collect(lexer.lexer(raw) as unknown as Token[], raw, map, segments, lexer, true);
          active = { segments, index: 0, offset: 0 };
        } else if (node.type === 'authoringRaw') active = { segments: [{ text: node.content?.map(child => child.text ?? '').join('') ?? '', offsets: indices.slice(at, at + info.raw.length + 1), kind: 'text' }], index: 0, offset: 0 };
      }
    }
    const before = spans.length;
    if (node.type === 'text') match(node.text ?? '', 'text', active, path);
    else if (node.type === 'mathInline' || node.type === 'mathBlock') match(String(node.attrs?.latex ?? ''), 'attribute', active, path);
    node.content?.forEach((child, index) => walk(child, [...path, index], active));
    if (node.type !== 'text' || range) {
      const children = spans.slice(before).filter(span => span.path.length >= path.length && span.path.slice(0, path.length).every((part, index) => part === path[index]));
      if (range || children.length) spans.push({ path, kind: 'node', from: range?.from ?? Math.min(...children.map(span => span.from)), to: range?.to ?? Math.max(...children.map(span => span.to)) });
    }
  }
  walk(document, [], { segments: root, index: 0, offset: 0 });
  const blocks: { from: number; to: number }[] = []; let cursor = 0;
  for (const token of lexer.lexer(source) as unknown as Token[]) {
    const raw = token.raw ?? '', at = source.indexOf(raw, cursor); if (at < 0) continue; cursor = at + raw.length;
    if (token.type === 'space' || (token.type === 'authoringBlockSyntax' && ['annotation', 'explain'].includes(token.command?.name ?? ''))) continue;
    blocks.push({ from: at, to: at + raw.replace(/\s+$/, '').length });
  }
  let blockIndex = 0;
  document.content?.forEach((node, index) => { if (node.type === 'annotationStore') return; const range = blocks[blockIndex++]; if (range) spans.push({ path: [index], kind: 'node', ...range }); });
  return spans;
}

/** Schema materialization joins adjacent equal-mark text runs. Preserve the
 * source fragments' structural identity while exposing only final JSON paths. */
export function normalizeAuthoringSpanPaths(before: JSONContent, after: JSONContent, spans: AuthoringSpan[]): AuthoringSpan[] {
  const paths = new Map<string, { path: number[]; offset: number; length: number }>();
  function visit(original: JSONContent, actual: JSONContent, oldPath: number[], path: number[], offset = 0) {
    if (original.type !== actual.type) return;
    paths.set(oldPath.join('.'), { path, offset, length: actual.type === 'text' ? actual.text?.length ?? 0 : 0 });
    let index = 0, consumed = 0;
    original.content?.forEach((child, childIndex) => {
      const target = actual.content?.[index]; if (!target) return;
      if (child.type === 'text' && target.type === 'text') { visit(child, target, [...oldPath, childIndex], [...path, index], consumed); consumed += child.text?.length ?? 0; if (consumed >= (target.text?.length ?? 0)) { index++; consumed = 0; } }
      else { visit(child, target, [...oldPath, childIndex], [...path, index]); index++; consumed = 0; }
    });
  }
  visit(before, after, [], []);
  const grouped = new Map<string, { span: AuthoringSpan; offsets?: Array<number | undefined> }>();
  for (const source of spans) {
    const mapped = paths.get(source.path.join('.')); if (!mapped) continue;
    const key = `${source.kind}:${mapped.path.join('.')}`, previous = grouped.get(key);
    if (!previous) {
      const span = { ...source, path: mapped.path }, offsets = source.kind === 'text' && source.offsets ? Array<number | undefined>(mapped.length + 1).fill(undefined) : undefined;
      if (offsets) source.offsets!.forEach((value, index) => { offsets[mapped.offset + index] = value; });
      grouped.set(key, { span, offsets });
    } else {
      previous.span.from = Math.min(previous.span.from, source.from); previous.span.to = Math.max(previous.span.to, source.to);
      if (previous.span.contentFrom !== undefined && source.contentFrom !== undefined) previous.span.contentFrom = Math.min(previous.span.contentFrom, source.contentFrom);
      if (previous.span.contentTo !== undefined && source.contentTo !== undefined) previous.span.contentTo = Math.max(previous.span.contentTo, source.contentTo);
      if (previous.span.encoding !== source.encoding) previous.span.encoding = undefined;
      if (previous.offsets && source.offsets) source.offsets.forEach((value, index) => { previous.offsets![mapped.offset + index] = value; });
    }
  }
  return [...grouped.values()].map(({ span, offsets }) => { if (offsets?.length && offsets.every(value => value !== undefined)) span.offsets = offsets as number[]; return span; });
}
