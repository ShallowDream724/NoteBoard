import { Lexer } from 'marked';
import type { MarkdownTokenizer } from '@tiptap/core';
import { readMath } from './mathSyntax';

/** Equal-length, temporary matching mask. Original token/source text is never
 * replaced. Failed math/code openers have a shared scan budget. */
export function formattingMask(source: string, code = false): string {
  const parts: string[] = [];
  const budget = { remaining: source.length * 3 };
  let copied = 0;
  for (let at = 0; at < source.length && budget.remaining > 0; at++) {
    let length = 0;
    if (code && source[at] === '`') {
      const match = Lexer.rules.inline.normal.code.exec(source.slice(at));
      length = match?.[0].length ?? 0;
      budget.remaining -= length || source.length - at;
    } else if (source[at] === '$' || source[at] === '\\' && (source[at + 1] === '(' || source[at + 1] === '[')) {
      length = readMath(source, at, false, budget)?.raw.length ?? 0;
    }
    if (length) {
      parts.push(source.slice(copied, at), '[' + 'a'.repeat(length - 2) + ']');
      at += length - 1; copied = at + 1;
    } else if (source[at] === '\\') at++;
  }
  return parts.length ? parts.join('') + source.slice(copied) : source;
}

export function pairedFormattingTokenizer(name: 'highlight' | 'underline', delimiter: '==' | '++'): MarkdownTokenizer {
  return {
    name, level: 'inline', start: source => source.indexOf(delimiter),
    tokenize(source, _tokens, lexer) {
      if (!source.startsWith(delimiter) || source.indexOf(delimiter, 2) < 0) return undefined;
      const masked = formattingMask(source, true);
      for (let at = 2; at < masked.length; at++) {
        if (masked[at] === '\\') { at++; continue; }
        if (!masked.startsWith(delimiter, at)) continue;
        const text = source.slice(2, at);
        if (!text.trim() || name === 'highlight' && (/^\s/.test(text) || /\s$/.test(text))) return undefined;
        return { type: name, raw: source.slice(0, at + 2), text, tokens: lexer.inlineTokens(text) };
      }
      return undefined;
    },
  };
}
