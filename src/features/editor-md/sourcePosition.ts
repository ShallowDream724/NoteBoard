import type { Editor } from '@tiptap/core';
import type { Node as DocumentNode } from '@tiptap/pm/model';
import type { MarkdownManagerLike } from './serialize';
import { diagramLanguage } from './diagramSyntax';

interface Token { type: string; raw?: string; text?: string; lang?: string; ordered?: boolean; tokens?: Token[]; items?: Token[]; header?: Token[] | boolean; rows?: Token[][] }
interface Span { from: number; to: number; source: number }
interface Located { text: string; spans: Span[] }
interface Character { value: string; from: number; to: number }
const position = (text: Located, offset: number, affinity: 'left' | 'right' = 'right') => {
  let low = 0, high = text.spans.length - 1;
  while (low < high) { const middle = (low + high) >>> 1; if (text.spans[middle].to < offset || (affinity === 'right' && text.spans[middle].to === offset)) low = middle + 1; else high = middle; }
  const span = text.spans[low];
  return span ? span.source + Math.min(offset, span.to) - span.from : 0;
};

/** Child raw text may have quote/list prefixes stripped. Match lines in order within its parent. */
function locate(parent: Located, text: string, start: number): { located: Located; end: number } {
  if (start === 0 && text === parent.text) return { located: parent, end: text.length };
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
    for (const character of value.split('')) yield { value: /\s/.test(character) ? ' ' : character,
      from: position(text, i), to: position(text, i + length, 'left') };
    i += length;
  }
}

function* tableCells(token: Token): Generator<Token> {
  if (Array.isArray(token.header)) yield* token.header;
  for (const row of token.rows ?? []) yield* row;
}

function* sourceCharacters(tokens: Iterable<Token>, parent: Located): Generator<Character> {
  let cursor = 0;
  for (const token of tokens) {
    const raw = token.raw || token.text || '';
    const found = locate(parent, raw, cursor); cursor = found.end;
    const here = found.located;
    if (token.type === 'space' || token.type === 'documentPresentation') continue;
    if (/^(mathInline|mathBlock|image|hr|mermaid|plantuml|infographic)/i.test(token.type)
      || (token.type === 'code' && diagramLanguage(token.lang))) {
      const end = raw.replace(/[\r\n]+$/, '').length;
      yield { value: '\uFFFC', from: position(here, 0), to: position(here, end, 'left') }; continue;
    }
    if (token.items) { yield* sourceCharacters(token.items, here); continue; }
    if (Array.isArray(token.header)) {
      yield* sourceCharacters(tableCells(token), here); continue;
    }
    if (token.tokens) { yield* sourceCharacters(token.tokens, here); continue; }
    if (token.type === 'br') continue;
    const text = token.text ?? raw;
    yield* literal(locate(here, text, 0).located, !['code', 'codespan'].includes(token.type));
  }
}
function* documentCharacters(node: DocumentNode, offset = -1): Generator<Character> {
  if (node.type.name === 'documentPresentation') return;
  if (node.isText) {
    const text = node.text ?? '';
    for (let i = 0; i < text.length; i++) yield { value: /\s/.test(text[i]) ? ' ' : text[i], from: offset + i, to: offset + i + 1 };
  } else if (node.isAtom && node.type.name !== 'hardBreak' && node.type.name !== 'paragraph') {
    yield { value: '\uFFFC', from: offset, to: offset + node.nodeSize };
  } else {
    let childOffset = offset + 1;
    for (let i = 0; i < node.childCount; i++) { const child = node.child(i); yield* documentCharacters(child, childOffset); childOffset += child.nodeSize; }
  }
}

interface Block {
  token?: Token; located: Located; node: DocumentNode; visualStart: number;
  sourceStart: number; sourceEnd: number;
}

/** Marked normalizes newlines. Keep only line spans to recover original UTF-16
 * offsets, including CRLF; LF input reuses the supplied string without copying. */
function sourceLocation(markdown: string): Located {
  if (!markdown.includes('\r')) return { text: markdown, spans: [{ from: 0, to: markdown.length, source: 0 }] };
  const spans: Span[] = [], parts: string[] = [];
  let cursor = 0, local = 0;
  for (const match of markdown.matchAll(/\r\n?/g)) {
    const body = markdown.slice(cursor, match.index);
    parts.push(body, '\n');
    if (body.length) spans.push({ from: local, to: local + body.length, source: cursor });
    local += body.length;
    spans.push({ from: local, to: local + 1, source: match.index + match[0].length - 1 });
    local++;
    cursor = match.index + match[0].length;
  }
  const tail = markdown.slice(cursor); parts.push(tail);
  spans.push({ from: local, to: local + tail.length, source: cursor });
  return { text: parts.join(''), spans };
}

function nodeTypeForToken(token: Token): string | null {
  switch (token.type) {
    case 'paragraph': case 'text':
      return token.tokens?.length === 1 && token.tokens[0].type === 'image' ? 'image' : 'paragraph';
    case 'heading': return 'heading';
    case 'blockquote': return 'blockquote';
    case 'list': return token.ordered ? 'orderedList' : 'bulletList';
    case 'taskList': return 'taskList';
    case 'code': {
      const diagram = diagramLanguage(token.lang);
      return diagram ? `${diagram}Block` : 'codeBlock';
    }
    case 'hr': return 'horizontalRule';
    case 'table': return 'table';
    case 'githubAlert': return 'githubAlert';
    case 'mathBlock': return 'mathBlock';
    case 'image': return 'image';
    case 'documentPresentation': return 'documentPresentation';
    default: return null;
  }
}

/** Pair known grammar blocks structurally, without serializing preceding nodes.
 * Unknown HTML/extensions or paragraph splitting use the same token stream's
 * semantic fallback, never a second full-document lex/serialization pass. */
function locateBlocks(tokens: Token[], source: Located, doc: DocumentNode): Block[] | null {
  const blocks: Block[] = [];
  let cursor = 0, childIndex = 0, visualStart = 0;
  const emptyParagraph = (sourcePoint: number) => {
    const node = doc.child(childIndex++);
    blocks.push({ node, visualStart, located: { text: '', spans: [] }, sourceStart: sourcePoint, sourceEnd: sourcePoint });
    visualStart += node.nodeSize;
  };
  for (const token of tokens) {
    const raw = token.raw || token.text || '';
    const found = locate(source, raw, cursor); cursor = found.end;
    if (token.type === 'space' || token.type === 'def') continue;
    while (childIndex < doc.childCount && doc.child(childIndex).type.name === 'paragraph' && !doc.child(childIndex).content.size) {
      emptyParagraph(position(found.located, 0));
    }
    if (childIndex >= doc.childCount) return null;
    const node = doc.child(childIndex++);
    if (node.type.name !== nodeTypeForToken(token)) return null;
    blocks.push({ token, located: found.located, node, visualStart,
      sourceStart: position(found.located, 0),
      sourceEnd: position(found.located, raw.replace(/[\r\n]+$/, '').length, 'left') });
    visualStart += node.nodeSize;
  }
  while (childIndex < doc.childCount && doc.child(childIndex).type.name === 'paragraph' && !doc.child(childIndex).content.size) {
    emptyParagraph(position(source, source.text.length, 'left'));
  }
  return childIndex === doc.childCount ? blocks : null;
}

function mapBlock(block: Block, direction: 'source' | 'visual', selection: { anchor: number; head: number }) {
  const visualStart = block.visualStart + (block.node.isTextblock ? 1 : 0);
  if (!block.token) return direction === 'source'
    ? { anchor: block.sourceStart, head: block.sourceStart }
    : { anchor: visualStart, head: visualStart };
  return mapCharacters(sourceCharacters([block.token], block.located), documentCharacters(block.node, block.visualStart),
    direction, selection, { source: block.sourceStart, visual: visualStart });
}

/** One transient lexer result; only selected known blocks get a character walk.
 * No node JSON/serialization, retained full text, token cache or character arrays. */
export function mapModeSelection(editor: Editor, markdown: string, direction: 'source' | 'visual', selection: { anchor: number; head: number }) {
  const manager = editor.storage.markdown?.manager as unknown as (MarkdownManagerLike & { instance?: { lexer: (text: string) => Token[] } }) | undefined;
  if (!manager?.instance) return { anchor: 0, head: 0 };
  const located = sourceLocation(markdown);
  const tokens = manager.instance.lexer(located.text);
  const blocks = locateBlocks(tokens, located, editor.state.doc);
  const maximum = direction === 'source' ? markdown.length : editor.state.doc.content.size;
  if (blocks?.length) {
    const selectBlock = (point: number, affinity: 'left' | 'right') => {
      let previous: Block | undefined;
      for (const block of blocks) {
        const start = direction === 'source' ? block.visualStart : block.sourceStart;
        const end = direction === 'source' ? block.visualStart + block.node.nodeSize : block.sourceEnd;
        if (point < end || (point === end && (direction === 'visual' || affinity === 'left'))) {
          if (previous && point < start) {
            const previousEnd = direction === 'source' ? previous.visualStart + previous.node.nodeSize : previous.sourceEnd;
            return point - previousEnd <= start - point ? previous : block;
          }
          return block;
        }
        previous = block;
      }
      return blocks[blocks.length - 1];
    };
    const forward = selection.anchor <= selection.head;
    const anchorBlock = selectBlock(selection.anchor, forward ? 'right' : 'left');
    const headBlock = selectBlock(selection.head, forward && selection.anchor !== selection.head ? 'left' : 'right');
    if (anchorBlock === headBlock) return clampSelection(mapBlock(anchorBlock, direction, selection), maximum);
    return clampSelection({
      anchor: mapBlock(anchorBlock, direction, { anchor: selection.anchor, head: selection.anchor }).anchor,
      head: mapBlock(headBlock, direction, { anchor: selection.head, head: selection.head }).head,
    }, maximum);
  }
  return clampSelection(mapCharacters(sourceCharacters(tokens, located), documentCharacters(editor.state.doc), direction, selection), maximum);
}

function clampSelection(selection: { anchor: number; head: number }, max: number) {
  return { anchor: Math.max(0, Math.min(max, selection.anchor)), head: Math.max(0, Math.min(max, selection.head)) };
}

function mapCharacters(source: Generator<Character>, visual: Generator<Character>, direction: 'source' | 'visual', selection: { anchor: number; head: number }, start = { source: 0, visual: 0 }) {
  const input = direction === 'source' ? visual : source;
  const output = direction === 'source' ? source : visual;
  const values = [selection.anchor, selection.head]; const result: Array<number | undefined> = [undefined, undefined];
  const left: Character[] = [], right: Character[] = [];
  const fill = (buffer: Character[], stream: Generator<Character>, count: number) => {
    while (buffer.length < count) { const next = stream.next(); if (next.done) break; buffer.push(next.value); }
  };
  let previousInput = direction === 'source' ? start.visual : start.source;
  let previousOutput = direction === 'source' ? start.source : start.visual;
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
