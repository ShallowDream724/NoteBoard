import Highlight from '@tiptap/extension-highlight';
import { pairedFormattingTokenizer } from './inlineFormattingMask';

// Fixed markup and a restricted CSS color value keep Markdown roundtrips independent
// of browser HTML parsing without accepting arbitrary attributes, styles or URLs.
const safeColor = (value: unknown): value is string => typeof value === 'string'
  && /^(?:#[\da-f]{3,8}|[a-z]+|(?:rgb|hsl|hwb|lab|lch|oklab|oklch|color)a?\([a-z\d.,%+\-/\s]+\))$/i.test(value);
export { safeColor as isSafeHighlightColor };
const tokenizer = Highlight.config.markdownTokenizer!;
const paired = pairedFormattingTokenizer('highlight', '==');

function closingMark(source: string, start: number): number {
  for (let cursor = start; cursor < source.length; cursor++) {
    if (source.startsWith('</mark>', cursor)) return cursor;
    if (source[cursor] === '\\') { cursor++; continue; }
    if (source[cursor] !== '`') continue;
    let end = cursor + 1;
    while (source[end] === '`') end++;
    const delimiter = source.slice(cursor, end);
    let closing = source.indexOf(delimiter, end);
    while (closing >= 0 && (source[closing - 1] === '`' || source[closing + delimiter.length] === '`')) {
      closing = source.indexOf(delimiter, closing + delimiter.length);
    }
    if (closing >= 0) cursor = closing + delimiter.length - 1;
  }
  return -1;
}

export const MarkdownHighlight = Highlight.extend({
  markdownTokenizer: {
    ...tokenizer,
    start(source) {
      const plain = source.indexOf('=='), colored = source.indexOf('<mark data-color="');
      return plain < 0 ? colored : colored < 0 ? plain : Math.min(plain, colored);
    },
    tokenize(source, tokens, helpers) {
      const opening = /^<mark data-color="([^"]+)">/.exec(source);
      if (opening && safeColor(opening[1])) {
        const closing = closingMark(source, opening[0].length);
        if (closing >= 0) return {
          type: 'highlight', raw: source.slice(0, closing + '</mark>'.length), color: opening[1],
          tokens: helpers.inlineTokens(source.slice(opening[0].length, closing)),
        };
      }
      return paired.tokenize(source, tokens, helpers);
    },
  },
  parseMarkdown(token, helpers) {
    return helpers.applyMark('highlight', helpers.parseInline(token.tokens ?? []), { color: safeColor(token.color) ? token.color : null });
  },
  renderMarkdown(node, helpers) {
    const content = helpers.renderChildren(node), color = node.attrs?.color;
    if (color == null || color === '') return `==${content}==`;
    if (!safeColor(color)) throw new Error('Cannot serialize an invalid highlight color');
    return `<mark data-color="${color}">${content}</mark>`;
  },
});
