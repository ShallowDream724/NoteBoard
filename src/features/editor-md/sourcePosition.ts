import type { Editor } from '@tiptap/core';
import type { Node as DocumentNode } from '@tiptap/pm/model';
import { serializeMarkdownFragment, type MarkdownManagerLike } from './serialize';

interface Token { type: string; raw?: string; text?: string; tokens?: Token[]; items?: Token[]; header?: Token[]; rows?: Token[][] }
interface Span { from: number; to: number; source: number }
interface Located { text: string; spans: Span[] }
interface Character { value: string; from: number; to: number }
const position = (text: Located, offset: number) => {
  let low = 0, high = text.spans.length - 1;
  while (low < high) { const middle = (low + high) >>> 1; if (text.spans[middle].to < offset) low = middle + 1; else high = middle; }
  const span = text.spans[low];
  return span ? span.source + Math.min(offset, span.to) - span.from : 0;
};

/** Child raw text may have quote/list prefixes stripped. Match lines in order within its parent. */
function locate(parent: Located, text: string, start: number): { located: Located; end: number } {
  const exact = parent.text.indexOf(text, start);
  if (exact >= 0) {
    let low = 0, high = parent.spans.length;
    while (low < high) { const middle = (low + high) >>> 1; if (parent.spans[middle].to < exact) low = middle + 1; else high = middle; }
    const spans: Span[] = [];
    for (let i = low; i < parent.spans.length && parent.spans[i].from <= exact + text.length; i++) {
      const s = parent.spans[i];
      const from = Math.max(s.from, exact), to = Math.min(s.to, exact + text.length);
      spans.push({ from: from - exact, to: to - exact, source: s.source + from - s.from });
    }
    return { located: { text, spans }, end: exact + text.length };
  }
  const spans: Span[] = []; let local = 0; let cursor = start;
  for (const part of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const body = part.replace(/\n$/, '');
    let at = parent.text.indexOf(body, cursor);
    if (at < 0) at = cursor;
    spans.push({ from: local, to: local + body.length, source: position(parent, at) });
    cursor = Math.min(parent.text.length, at + body.length);
    if (part.endsWith('\n')) {
      const newline = parent.text.indexOf('\n', cursor);
      spans.push({ from: local + body.length, to: local + part.length, source: position(parent, newline < 0 ? cursor : newline) });
      cursor = newline < 0 ? cursor : newline + 1;
    }
    local += part.length;
  }
  return { located: { text, spans }, end: cursor };
}

function* literal(text: Located, decode: boolean): Generator<Character> {
  const decoder = decode ? document.createElement('textarea') : null;
  for (let i = 0; i < text.text.length;) {
    let value = text.text[i]; let length = 1;
    if (decode && value === '\\' && /[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/.test(text.text[i + 1] ?? '')) { value = text.text[i + 1]; length = 2; }
    else if (decode && value === '&') {
      const entity = /^&(?:#\d+|#x[\da-f]+|[a-z]+);/i.exec(text.text.slice(i, i + 35));
      if (entity) { decoder!.innerHTML = entity[0]; value = decoder!.value; length = entity[0].length; }
    }
    for (const character of value.split('')) if (!/\s/.test(character)) yield { value: character, from: position(text, i), to: position(text, i + length) };
    i += length;
  }
}

function* sourceCharacters(tokens: Token[], parent: Located): Generator<Character> {
  let cursor = 0;
  for (const token of tokens) {
    const raw = token.raw ?? token.text ?? '';
    const found = locate(parent, raw, cursor); cursor = found.end;
    const here = found.located;
    if (token.type === 'space') continue;
    if (/^(mathInline|mathBlock|image|hr|mermaid|plantuml|infographic)/i.test(token.type)) {
      yield { value: '\uFFFC', from: position(here, 0), to: position(here, raw.length) }; continue;
    }
    if (token.items) { yield* sourceCharacters(token.items, here); continue; }
    if (token.header) {
      yield* sourceCharacters([...token.header, ...(token.rows ?? []).flat()], here); continue;
    }
    if (token.tokens) { yield* sourceCharacters(token.tokens, here); continue; }
    if (token.type === 'br') continue;
    const text = token.text ?? raw;
    yield* literal(locate(here, text, 0).located, !['code', 'codespan'].includes(token.type));
  }
}
function* documentCharacters(node: DocumentNode, offset = -1): Generator<Character> {
  if (node.isText) {
    const text = node.text ?? '';
    for (let i = 0; i < text.length; i++) if (!/\s/.test(text[i])) yield { value: text[i], from: offset + i, to: offset + i + 1 };
  } else if (node.isAtom && node.type.name !== 'hardBreak' && node.type.name !== 'paragraph') {
    yield { value: '\uFFFC', from: offset, to: offset + node.nodeSize };
  } else {
    let childOffset = offset + 1;
    for (let i = 0; i < node.childCount; i++) { const child = node.child(i); yield* documentCharacters(child, childOffset); childOffset += child.nodeSize; }
  }
}

/** Transient semantic walk. No retained text copies, per-character arrays, or editor instances. */
export function mapModeSelection(editor: Editor, markdown: string, direction: 'source' | 'visual', selection: { anchor: number; head: number }) {
  const manager = editor.storage.markdown?.manager as unknown as (MarkdownManagerLike & { instance?: { lexer: (text: string) => Token[] } }) | undefined;
  if (!manager?.instance) return { anchor: 0, head: 0 };
  // Canonical source matches independently serialized top-level blocks. Locate
  // blocks sequentially (including duplicates), then lex only the selected ones.
  // Non-canonical source edits fall back to the full semantic mapping below.
  if (manager.serialize) {
    const points = [selection.anchor, selection.head];
    const mapped: Array<number | undefined> = [undefined, undefined];
    let cursor = 0, visualStart = 0;
    for (let index = 0; index < editor.state.doc.childCount; index++) {
      const child = editor.state.doc.child(index);
      const raw = serializeMarkdownFragment(manager, { type: 'doc', attrs: undefined, content: [child.toJSON()] }).trim();
      if (!raw && child.isTextblock && !child.content.size) {
        const sourcePoint = index === editor.state.doc.childCount - 1 ? markdown.length : cursor;
        for (let point = 0; point < points.length; point++) {
          if (mapped[point] === undefined && points[point] <= (direction === 'source' ? visualStart + child.nodeSize : sourcePoint)) {
            mapped[point] = direction === 'source' ? sourcePoint : visualStart + 1;
          }
        }
        if (mapped.every(value => value !== undefined)) return { anchor: mapped[0]!, head: mapped[1]! };
        visualStart += child.nodeSize;
        continue;
      }
      const at = markdown.indexOf(raw, cursor);
      if (!raw || at < 0) break;
      const end = direction === 'source' ? visualStart + child.nodeSize : at + raw.length;
      for (let point = 0; point < points.length; point++) {
        if (mapped[point] !== undefined || points[point] > end) continue;
        const source = sourceCharacters(manager.instance.lexer(raw), { text: raw, spans: [{ from: 0, to: raw.length, source: at }] });
        mapped[point] = mapCharacters(source, documentCharacters(child, visualStart), direction, { anchor: points[point], head: points[point] }).head;
      }
      if (mapped.every(value => value !== undefined)) return clampSelection({ anchor: mapped[0]!, head: mapped[1]! }, direction === 'source' ? markdown.length : editor.state.doc.content.size);
      cursor = at + raw.length; visualStart += child.nodeSize;
    }
  }
  const source = sourceCharacters(manager.instance.lexer(markdown), { text: markdown, spans: [{ from: 0, to: markdown.length, source: 0 }] });
  const visual = documentCharacters(editor.state.doc);
  return clampSelection(mapCharacters(source, visual, direction, selection), direction === 'source' ? markdown.length : editor.state.doc.content.size);
}

function clampSelection(selection: { anchor: number; head: number }, max: number) {
  return { anchor: Math.max(0, Math.min(max, selection.anchor)), head: Math.max(0, Math.min(max, selection.head)) };
}

function mapCharacters(source: Generator<Character>, visual: Generator<Character>, direction: 'source' | 'visual', selection: { anchor: number; head: number }) {
  const input = direction === 'source' ? visual : source;
  const output = direction === 'source' ? source : visual;
  const values = [selection.anchor, selection.head]; const result: Array<number | undefined> = [undefined, undefined];
  const left: Character[] = [], right: Character[] = [];
  const fill = (buffer: Character[], stream: Generator<Character>, count: number) => {
    while (buffer.length < count) { const next = stream.next(); if (next.done) break; buffer.push(next.value); }
  };
  let previousInput = 0, previousOutput = 0;
  for (;;) {
    fill(left, input, 1); fill(right, output, 1);
    if (!left.length || !right.length) break;
    if (left[0].value !== right[0].value) {
      // Bound recovery for extension-specific syntax. Match a short context, not an arbitrary repeated word.
      fill(left, input, 32); fill(right, output, 32);
      let skipLeft = 1, skipRight = 1, score = Infinity;
      for (let x = 0; x < left.length - 2; x++) for (let y = 0; y < right.length - 2; y++) {
        if (x + y < score && [0, 1, 2].every(i => left[x + i].value === right[y + i].value)) { skipLeft = x; skipRight = y; score = x + y; }
      }
      const end = skipLeft ? left[skipLeft - 1].to : left[0].from;
      for (let i = 0; i < values.length; i++) if (result[i] === undefined && values[i] <= end) result[i] = right[Math.min(skipRight, right.length - 1)].from;
      if (skipLeft) previousInput = left[skipLeft - 1].to;
      if (skipRight) previousOutput = right[skipRight - 1].to;
      left.splice(0, skipLeft); right.splice(0, skipRight); continue;
    }
    const a = left[0], b = right[0];
    for (let i = 0; i < values.length; i++) if (result[i] === undefined && values[i] <= a.to) {
      if (values[i] < a.from) result[i] = values[i] - previousInput <= a.from - values[i] ? previousOutput : b.from;
      else result[i] = values[i] <= a.from ? b.from : b.to;
    }
    if (result.every(value => value !== undefined)) break;
    previousInput = a.to; previousOutput = b.to;
    left.shift(); right.shift();
  }
  return { anchor: result[0] ?? previousOutput, head: result[1] ?? previousOutput };
}
