import type { Token, marked } from 'marked';

export type FormattingMark = 'bold' | 'italic' | 'strike' | 'highlight' | 'underline';
export interface FormattingSpan { from: number; to: number; contentFrom: number; contentTo: number; mark: FormattingMark }
export interface FormattingMatch { from: number; to: number; raw: string; spans: FormattingSpan[] }
const marks: Record<string, FormattingMark> = { strong: 'bold', em: 'italic', del: 'strike', highlight: 'highlight', underline: 'underline' };

/** Use the document grammar's actual tokenizers, including opaque math/code
 * and extension marks. No document model, DOM or persistent source copy. */
export function inlineTokens(instance: typeof marked, source: string): Token[] {
  return new instance.Lexer(instance.defaults).inlineTokens(source);
}

export function formattingSpan(token: Token, from: number): FormattingSpan | null {
  const mark = marks[token.type];
  if (!mark || !token.raw || !/^[*_~+=]/.test(token.raw)) return null;
  const width = token.type === 'em' ? 1 : token.type === 'del' && !token.raw.startsWith('~~') ? 1 : 2;
  return { from, to: from + token.raw.length, contentFrom: from + width, contentTo: from + token.raw.length - width, mark };
}

export function formattingMatch(token: Token, from: number): FormattingMatch | null {
  const outer = formattingSpan(token, from);
  if (!outer) return null;
  const spans: FormattingSpan[] = [];
  const visit = (item: Token, start: number) => {
    const current = formattingSpan(item, start);
    if (!current) return; // Code, formulas and link destinations are opaque here.
    spans.push(current);
    let offset = current.contentFrom;
    if ('tokens' in item && item.tokens) for (const child of item.tokens) {
      visit(child, offset); offset += child.raw.length;
    }
  };
  visit(token, from);
  return { from, to: outer.to, raw: token.raw, spans };
}

export function formattingMatches(instance: typeof marked, source: string): FormattingMatch[] {
  const matches: FormattingMatch[] = [];
  let from = 0;
  for (const token of inlineTokens(instance, source)) {
    const match = formattingMatch(token, from);
    if (match) matches.push(match);
    from += token.raw.length;
  }
  return matches;
}
