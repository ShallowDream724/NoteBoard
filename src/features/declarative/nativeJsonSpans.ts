import type { JSONContent } from '@tiptap/core';
import type { AuthoringSpan } from './types';

interface StringLocation { from: number; to: number; value: string; offsets: number[] }
interface NodeLocation { from: number; to: number; type?: string; text?: StringLocation; latex?: StringLocation; children: NodeLocation[] }
/** Location-only JSON reader, following the nativeSourcePosition Locations
 * reader's structural approach. Only text and LaTeX strings retain offsets. */
class JsonLocations {
  private at = 0;
  constructor(private source: string) {}
  private whitespace() { while (/\s/.test(this.source[this.at] ?? '') && this.at < this.source.length) this.at++; }
  private take(character: string) { this.whitespace(); if (this.source[this.at++] !== character) throw new Error('JSON boundary'); }
  private string(keepOffsets = false, decode = true): StringLocation {
    this.take('"'); const from = this.at, offsets: number[] = [];
    while (this.at < this.source.length) {
      const start = this.at, character = this.source[this.at++];
      if (character === '"') { if (keepOffsets) offsets.push(this.at - 1); return { from, to: this.at - 1, value: decode ? JSON.parse(this.source.slice(from - 1, this.at)) : '', offsets }; }
      if (character.charCodeAt(0) < 32) throw new Error('JSON string');
      if (keepOffsets) offsets.push(start);
      if (character === '\\') { const escape = this.source[this.at++]; if (escape === 'u') { if (!/^[\da-f]{4}$/i.test(this.source.slice(this.at, this.at + 4))) throw new Error('JSON escape'); this.at += 4; } else if (!escape || !'"\\/bfnrt'.includes(escape)) throw new Error('JSON escape'); }
    }
    throw new Error('JSON string');
  }
  private value(depth: number) {
    if (depth > 512) throw new Error('JSON depth'); this.whitespace(); const character = this.source[this.at];
    if (character === '"') { this.string(false, false); return; }
    if (character === '{' || character === '[') {
      this.at++; this.whitespace(); const end = character === '{' ? '}' : ']'; if (this.source[this.at] === end) { this.at++; return; }
      while (this.at < this.source.length) { if (character === '{') { this.string(); this.take(':'); } this.value(depth + 1); this.whitespace(); if (this.source[this.at] === end) { this.at++; return; } this.take(','); }
      throw new Error('JSON boundary');
    }
    const start = this.at; while (this.at < this.source.length && !/[\s,\]}]/.test(this.source[this.at])) this.at++;
    if (!/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.test(this.source.slice(start, this.at))) throw new Error('JSON value');
  }
  private attrs(result: NodeLocation, depth: number) {
    this.take('{'); this.whitespace();
    if (this.source[this.at] !== '}') while (this.at < this.source.length) {
      const key = this.string().value; this.take(':'); this.whitespace();
      if (key === 'latex' && this.source[this.at] === '"') result.latex = this.string(true); else this.value(depth + 1);
      this.whitespace(); if (this.source[this.at] === '}') break; this.take(',');
    }
    this.take('}');
  }
  private node(depth = 0): NodeLocation {
    if (depth > 512) throw new Error('JSON depth'); this.whitespace(); const from = this.at; this.take('{'); const result: NodeLocation = { from, to: from, children: [] };
    this.whitespace();
    if (this.source[this.at] !== '}') while (this.at < this.source.length) {
      const key = this.string().value; this.take(':'); this.whitespace();
      if (key === 'type') result.type = this.string().value;
      else if (key === 'text') result.text = this.string(true);
      else if (key === 'attrs' && this.source[this.at] === '{') this.attrs(result, depth);
      else if (key === 'content') { this.take('['); this.whitespace(); if (this.source[this.at] !== ']') while (this.at < this.source.length) { result.children.push(this.node(depth + 1)); this.whitespace(); if (this.source[this.at] === ']') break; this.take(','); } this.take(']'); }
      else this.value(depth + 1);
      this.whitespace(); if (this.source[this.at] === '}') break; this.take(',');
    }
    this.take('}'); result.to = this.at; return result;
  }
  read() { const result = this.node(); this.whitespace(); if (this.at !== this.source.length) throw new Error('JSON record'); return result; }
}

/** The location tree follows child indices, including merged adjacent PM text
 * runs; repeated words never participate in choosing a source location. */
export function nativeJsonSpans(json: string, document: JSONContent, path: number[], map: (offset: number) => number = offset => offset, encoding: AuthoringSpan['encoding'] = 'json'): AuthoringSpan[] {
  const result: AuthoringSpan[] = [];
  function add(location: StringLocation, ownPath: number[], kind: 'text' | 'attribute', append = false) {
    const offsets = location.offsets.map(map), previous = append ? result.find(span => span.kind === kind && span.path.length === ownPath.length && span.path.every((part, index) => part === ownPath[index])) : undefined;
    if (previous) { previous.offsets = [...previous.offsets!.slice(0, -1), ...offsets]; previous.to = map(location.to); previous.contentTo = map(location.to); }
    else result.push({ path: ownPath, kind, encoding, from: map(location.from), to: map(location.to), contentFrom: map(location.from), contentTo: map(location.to), offsets });
  }
  function walk(location: NodeLocation, actual: JSONContent, ownPath: number[], appendText = false) {
    if (location.type !== actual.type) return;
    result.push({ path: ownPath, kind: 'node', encoding, from: map(location.from), to: map(location.to) });
    if (actual.type === 'text' && location.text) add(location.text, ownPath, 'text', appendText);
    if (['mathInline', 'mathBlock'].includes(actual.type ?? '') && location.latex) add(location.latex, ownPath, 'attribute');
    let index = 0, consumed = 0;
    for (const child of location.children) {
      const actualChild = actual.content?.[index]; if (!actualChild) break;
      if (child.type === 'text' && actualChild.type === 'text' && child.text) {
        walk(child, actualChild, [...ownPath, index], consumed > 0); consumed += child.text.value.length;
        if (consumed >= (actualChild.text?.length ?? 0)) { index++; consumed = 0; }
      } else { if (consumed) break; walk(child, actualChild, [...ownPath, index]); index++; }
    }
  }
  try { walk(new JsonLocations(json).read(), document, path); } catch { /* Invalid carriers already produce authoring diagnostics; never invent positions. */ }
  return result;
}

/** JSON UTF-16 positions to canonical base64url positions. Interior surrogate
 * positions share their code point's first encoded byte, preserving affinity. */
export function nativeInlineEncoding(json: string): { encoded: string; offsets: number[] } {
  const bytes = new TextEncoder().encode(json); let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), offsets: number[] = []; let byte = 0;
  for (let index = 0; index < json.length;) { const point = json.codePointAt(index)!, count = point > 0xffff ? 2 : 1; for (let part = 0; part < count; part++) offsets.push(Math.floor(byte * 4 / 3)); byte += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4; index += count; }
  offsets.push(encoded.length); return { encoded, offsets };
}
