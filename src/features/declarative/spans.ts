import type { JSONContent } from '@tiptap/core';
import type { marked } from 'marked';
import { nodeSource, readInlineCommand, readBlockCommand, type SourceRecord } from './syntax';
import type { ResolvedDocument } from './resolve';
import type { AuthoringSpan } from './types';
import { nativeInlineEncoding, nativeJsonSpans } from './nativeJsonSpans';
import { diagramLanguage } from '../editor-md/diagramSyntax';

interface Segment { text: string; offsets: number[]; kind: 'text' | 'attribute' }
interface Token { type?: string; raw?: string; text?: string; latex?: string; tokens?: Token[]; items?: Token[]; header?: { tokens?: Token[]; text?: string }[]; rows?: { tokens?: Token[]; text?: string }[][]; groupTokens?: Token[][]; command?: { name: string; raw: string; error?: string }; [key: string]: unknown }
type Commands = Map<string, number[][]>;
const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
function decoded(raw: string, base: number, kind: Segment['kind'] = 'text'): Segment {
  let text = ''; const offsets: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entity = raw[i] === '&' ? /^&(#x[\da-f]+|#\d+|[a-z]+);/i.exec(raw.slice(i)) : null;
    if (entity) {
      const hex = entity[1][1]?.toLowerCase() === 'x', point = parseInt(entity[1].slice(hex ? 2 : 1), hex ? 16 : 10);
      const value = entity[1][0] === '#' ? (point <= 0x10ffff ? String.fromCodePoint(point) : undefined) : entities[entity[1]];
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
  for (let i = 0; i < raw.length; i++) { const next = region.indexOf(raw[i], cursor); if (next < 0) return { offsets: [], end: from }; mapped.push(offsets[next]); cursor = next + 1; }
  mapped.push(offsets[Math.min(cursor, offsets.length - 1)]); return { offsets: mapped, end: cursor };
}
function collect(tokens: Token[], region: string, offsets: number[], output: Segment[], lexer: typeof marked, commands: Commands, includeDefinitions = false) {
  let cursor = 0;
  for (const token of tokens) {
    const raw = token.raw ?? token.text ?? '', location = childLocation(raw, region, offsets, cursor); cursor = location.end;
    if (!location.offsets.length) continue;
    const own = location.offsets, base = own[0] ?? offsets[0] ?? 0;
    if (token.command) {
      const key = token.command.raw, occurrences = commands.get(key) ?? [];
      occurrences.push(own.slice(0, key.length + 1));
      commands.set(key, occurrences);
    }
    const push = (segment: Segment, relative = 0) => { segment.offsets = segment.offsets.map(offset => own[Math.min(raw.length, Math.max(0, offset - base + relative))] ?? base); output.push(segment); };
    if (token.type === 'authoringInlineSyntax') {
      const command = readInlineCommand(raw);
      if (!command || command.error) { output.push({ text: raw, offsets: own, kind: 'text' }); continue; }
      const groups = command.name === 'note' ? command.groups.slice(0, 1) : command.groups;
      groups.forEach((group, index) => collect(token.groupTokens?.[index] ?? lexer.Lexer.lexInline(group.text, lexer.defaults) as unknown as Token[], group.text, own.slice(group.from, group.to + 1), output, lexer, commands));
    } else if (token.type === 'authoringBlockSyntax') {
      const command = readBlockCommand(raw);
      if (!command || !command.closed || !token.tokens?.length) { if (command?.name !== 'native' && !['annotation', 'explain'].includes(command?.name ?? '')) output.push({ text: raw, offsets: own, kind: 'text' }); continue; }
      if (includeDefinitions || !['annotation', 'explain'].includes(command.name)) collect(token.tokens, command.body, own.slice(command.bodyFrom, command.bodyFrom + command.body.length + 1), output, lexer, commands, includeDefinitions);
    } else if (token.type === 'mathInline' || token.type === 'mathBlock') {
      const value = String(token.latex ?? ''), at = raw.indexOf(value); if (at >= 0) output.push({ text: value, offsets: own.slice(at, at + value.length + 1), kind: 'attribute' });
    } else if (token.type === 'code' || token.type === 'codespan') {
      const value = String(token.text ?? ''), at = raw.indexOf(value); if (at >= 0) output.push({ text: value, offsets: own.slice(at, at + value.length + 1), kind: 'text' });
    } else if (token.type === 'escape') output.push({ text: String(token.text ?? ''), offsets: [own[1] ?? base, own[raw.length] ?? base + raw.length], kind: 'text' });
    else if (token.tokens?.length) collect(token.tokens, raw, own, output, lexer, commands, includeDefinitions);
    else if (token.items?.length) collect(token.items, raw, own, output, lexer, commands, includeDefinitions);
    else if (token.header || token.rows) {
      const cells = [...(token.header ?? []), ...(token.rows ?? []).flat()]; let cellCursor = 0;
      for (const cell of cells) { const value = cell.text ?? '', where = childLocation(value, raw, own, cellCursor); cellCursor = where.end; if (where.offsets.length) collect(cell.tokens ?? [], value, where.offsets, output, lexer, commands, includeDefinitions); }
    } else if (token.type === 'text') push(decoded(String(token.text ?? raw), base));
  }
}
interface BlockSource { from: number; to: number; token?: Token; htmlNodes?: JSONContent[]; exclusive: boolean }
type HostParser = (markdown: string) => JSONContent;

/** HTML import may unwrap several nested blocks or keep unknown markup as
 * literal text. Offer editable text locations only when all visible text runs
 * match the host's actual DOM conversion, including entity decoding. */
function htmlTextSegments(raw: string, offsets: number[], nodes: JSONContent[]): Segment[] {
  const values: string[] = [];
  const visit = (node: JSONContent) => {
    if (node.type === 'text') values.push(node.text ?? '');
    node.content?.forEach(visit);
  };
  nodes.forEach(visit);
  if (!values.length) return [];
  if (values.length === 1 && values[0] === raw.trimEnd()) {
    return [{ text: values[0], kind: 'text', offsets: offsets.slice(0, values[0].length + 1) }];
  }
  const segments: Segment[] = [];
  const add = (start: number, end: number) => {
    if (start >= end) return;
    const part = decoded(raw.slice(start, end), start);
    part.offsets = part.offsets.map(at => offsets[at]);
    segments.push(part);
  };
  let cursor = 0;
  for (const tag of raw.matchAll(/<!--[\s\S]*?-->|<\/?[a-z][\w:-]*(?=[\s/>])(?:[^<>"']|"[^"]*"|'[^']*')*>/gi)) {
    if (raw.slice(cursor, tag.index).includes('<') || /^<(?:script|style|textarea|title)\b/i.test(tag[0])) return [];
    add(cursor, tag.index);
    cursor = tag.index + tag[0].length;
  }
  if (raw.slice(cursor).includes('<')) return [];
  add(cursor, raw.length);
  const matches = (parts: Segment[]) => parts.length === values.length && parts.every((part, index) => part.text === values[index]);
  if (matches(segments)) return segments;
  const visible = segments.filter(part => part.text.trim());
  return matches(visible) ? visible : [];
}

/** Match against the host tree before declarations move or expand nodes. The
 * host decides the shape of HTML and extension tokens. Ordinary Markdown
 * has a fixed block shape and does not need a second parse. */
function hostBlockSources(tokens: Token[], markdown: string, host: JSONContent, parse: HostParser) {
  const blocks = new WeakMap<JSONContent, BlockSource>(), nodes = host.content ?? [];
  let cursor = 0, index = 0;
  const matches = (types: (string | undefined)[], source: BlockSource, expectedRaw?: string) => {
    if (types.some((type, i) => {
      const node = nodes[index + i];
      return !node || (expectedRaw ? nodeSource(node)?.raw !== expectedRaw : node.type !== type);
    })) return false;
    for (let i = 0; i < types.length; i++) blocks.set(nodes[index++], source);
    return true;
  };
  function spaces(raw: string, start: number, before: boolean, after: boolean) {
    // Tiptap restores one paragraph per LF pair and consumes one pair between
    // blocks. An empty block's insertion point preserves both adjacent gaps.
    const pairs = raw.matchAll(/\n\n/g);
    let first = true;
    for (const pair of pairs) {
      if (!(first && before && after)) {
        const at = start + pair.index + (before && !after ? 2 : 0);
        if (nodes[index]?.content?.length || !matches(['paragraph'], { from: at, to: at, exclusive: before || after })) return false;
      }
      first = false;
    }
    return true;
  }
  for (let t = 0; t < tokens.length; t++) {
    const token = tokens[t], raw = token.raw ?? '', start = cursor;
    // Never skip ahead to a repeated lexeme after a tokenizer mismatch.
    if (!markdown.startsWith(raw, start)) break;
    cursor += raw.length;
    if (token.type === 'space') {
      if (!spaces(raw, start, t > 0, t < tokens.length - 1)) break;
      continue;
    }
    const gap = tokens[t + 1]?.type === 'space' ? undefined : /\n[^\S\n]*(?:\n[^\S\n]*)+$/.exec(raw);
    const body = raw.slice(0, gap?.index ?? raw.length).replace(/\n$/, '');
    const range: BlockSource = { from: start, to: start + body.length, token, exclusive: true };
    let types: (string | undefined)[];
    let expectedRaw: string | undefined;
    switch (token.type) {
      case 'def': case 'noteboardListBoundary': types = []; break;
      case 'paragraph': types = [token.tokens?.length === 1 && token.tokens[0].type === 'image' ? 'image' : 'paragraph']; break;
      case 'hr': types = ['horizontalRule']; break;
      case 'code': { const diagram = diagramLanguage(token.lang); types = [diagram ? diagram + 'Block' : 'codeBlock']; break; }
      case 'heading': case 'blockquote': case 'table': case 'mathBlock': case 'githubAlert': case 'documentPresentation': case 'taskList':
        types = [token.type]; break;
      case 'authoringBlockSyntax': {
        expectedRaw = token.command?.raw;
        const expands = ['left', 'center', 'right', 'bg'].includes(token.command?.name ?? '');
        types = expands ? (parse(body).content ?? []).map(node => node.type) : [undefined];
        break;
      }
      case 'list':
        if (!token.items?.some(item => item.task) && !raw.includes('<!-- noteboard-list-boundary -->')) {
          types = [token.ordered ? 'orderedList' : 'bulletList']; break;
        }
        // Mixed task and bullet items can produce several lists.
        types = (parse(body).content ?? []).map(node => node.type); break;
      default:
        // The same HTML token can yield zero, one or several schema blocks.
        types = (parse(body).content ?? []).map(node => node.type);
    }
    range.exclusive = types.length === 1;
    if (!matches(types, range, expectedRaw)) break;
    if (token.type === 'html') range.htmlNodes = nodes.slice(index - types.length, index);
    if (gap && !spaces(gap[0], start + gap.index, true, t < tokens.length - 1)) break;
  }
  return blocks;
}

export function authoringSpans(resolved: ResolvedDocument, host: JSONContent, source: string, lexer: typeof marked, parse: HostParser): AuthoringSpan[] {
  const { document, records, blockOrigins } = resolved;
  // Marked normalizes CRLF and lone CR before tokenizing. All public spans
  // use original UTF-16 offsets, including native JSON and command bodies.
  const markdown = source.replace(/\r\n?/g, '\n'), indices: number[] = [];
  for (let i = 0; i < source.length; i++) { indices.push(i); if (source[i] === '\r' && source[i + 1] === '\n') i++; }
  indices.push(source.length);
  const tokens = lexer.lexer(markdown) as unknown as Token[];
  const blocks = hostBlockSources(tokens, markdown, host, parse), spans: AuthoringSpan[] = [];
  const recordMap = new WeakMap<JSONContent, SourceRecord>(); for (const entry of records) recordMap.set(entry.node, entry.source);
  interface Pool { segments: Segment[]; index: number; offset: number; commands: Commands; used: Map<string, number> }
  const makePool = (segments: Segment[] = []): Pool => ({ segments, index: 0, offset: 0, commands: new Map(), used: new Map() });
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
        for (let i = local; i < local + length; i++) mapped.push(segment.offsets[i]);
        remaining = remaining.slice(length); local += length;
        if (local === segment.text.length) { index++; local = 0; }
      }
      if (remaining || mapped.some(offset => offset === undefined)) continue;
      const last = (local ? pool.segments[index]?.offsets[local] : pool.segments[index - 1]?.offsets.at(-1)) ?? mapped.at(-1)! + 1; mapped.push(last);
      pool.index = index; pool.offset = local;
      spans.push({ path, kind, from: mapped[0], to: mapped.at(-1)!, contentFrom: mapped[0], contentTo: mapped.at(-1)!, offsets: mapped }); return;
    }
  }
  function walk(node: JSONContent, path: number[], pool: Pool) {
    const info = recordMap.get(node); let range: { from: number; to: number } | undefined, active = pool;
    if (info) {
      const occurrence = pool.used.get(info.raw) ?? 0, own = pool.commands.get(info.raw)?.[occurrence];
      if (own?.length === info.raw.length + 1) {
        pool.used.set(info.raw, occurrence + 1); range = { from: own[0], to: own[info.raw.length] };
        if (info.kind === 'native') {
          const block = readBlockCommand(info.raw);
          if (block) for (const span of nativeJsonSpans(block.body, node, path, offset => own[block.bodyFrom + offset])) {
            if (span.kind !== 'node' || span.path.length > 1) spans.push(span);
          }
          if (path.length > 1) spans.push({ path, kind: 'node', ...range }); return;
        }
        if (info.kind === 'native-inline') {
          const command = readInlineCommand(info.raw), group = command?.groups[0];
          if (group) try { const bytes = Uint8Array.from(atob(group.text.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0)), json = new TextDecoder('utf-8', { fatal: true }).decode(bytes), { offsets } = nativeInlineEncoding(json); for (const span of nativeJsonSpans(json, node, path, offset => own[group.from + offsets[offset]], 'base64json')) spans.push(span); } catch { /* Invalid carrier recovered separately. */ }
          spans.push({ path, kind: 'node', ...range }); return;
        }
        if (node.type === 'annotationBody') {
          const command = info.raw.startsWith('\\') ? readInlineCommand(info.raw) : null, block = command ? null : readBlockCommand(info.raw);
          const raw = command?.groups[1]?.text ?? block?.body ?? '', relative = command?.groups[1]?.from ?? block?.bodyFrom ?? 0;
          active = makePool();
          const bodyTokens = command ? lexer.Lexer.lexInline(raw, lexer.defaults) : lexer.lexer(raw);
          collect(bodyTokens as unknown as Token[], raw, own.slice(relative, relative + raw.length + 1), active.segments, lexer, active.commands, true);
        } else if (node.type === 'authoringRaw') active = makePool([{ text: info.raw, offsets: own, kind: 'text' }]);
      }
    }
    const before = spans.length;
    if (node.type === 'text') match(node.text ?? '', 'text', active, path);
    else if (node.type === 'mathInline' || node.type === 'mathBlock') match(String(node.attrs?.latex ?? ''), 'attribute', active, path);
    node.content?.forEach((child, index) => walk(child, [...path, index], active));
    if (path.length > 1 && (node.type !== 'text' || range)) {
      if (!range && before < spans.length) {
        const first = spans[before]; range = { from: first.from, to: first.to };
        for (let i = before + 1; i < spans.length; i++) { range.from = Math.min(range.from, spans[i].from); range.to = Math.max(range.to, spans[i].to); }
      }
      if (range) spans.push({ path, kind: 'node', ...range });
    }
  }
  const pools = new Map<BlockSource, Pool>();
  function poolFor(block: BlockSource) {
    let pool = pools.get(block);
    if (pool) return pool;
    pool = makePool();
    const raw = block.token?.raw ?? '';
    if (block.htmlNodes) pool.segments = htmlTextSegments(markdown.slice(block.from, block.to), indices.slice(block.from, block.to + 1), block.htmlNodes);
    else if (block.token) collect([block.token], raw, indices.slice(block.from, block.from + raw.length + 1), pool.segments, lexer, pool.commands);
    pools.set(block, pool); return pool;
  }
  document.content?.forEach((node, index) => {
    const original = blockOrigins.get(node), block = original && blocks.get(original);
    if (!block) {
      if (node.type === 'annotationStore') {
        const detached = makePool(), seen = new Set<BlockSource>();
        for (const child of host.content ?? []) {
          const owner = blocks.get(child);
          if (!owner || seen.has(owner)) continue;
          seen.add(owner);
          for (const [raw, occurrences] of poolFor(owner).commands) {
            const group = detached.commands.get(raw) ?? [];
            for (const location of occurrences) group.push(location);
            detached.commands.set(raw, group);
          }
        }
        walk(node, [index], detached);
      }
      return;
    }
    walk(node, [index], poolFor(block));
    if (block.exclusive) spans.push({ kind: 'node', path: [index], from: indices[block.from], to: indices[block.to] });
  });
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
