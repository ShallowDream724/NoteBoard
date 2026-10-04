import { markdown } from '@codemirror/lang-markdown';
import { tags } from '@lezer/highlight';
import { documentParser } from './documentExtensions';
import { formattingSpan, inlineTokens, type FormattingSpan } from './inlineFormatting';

type Configuration = NonNullable<NonNullable<Parameters<typeof markdown>[0]>['extensions']>;
const nodes = { bold: 'StrongEmphasis', italic: 'Emphasis', strike: 'NBStrikethrough', highlight: 'NBHighlight', underline: 'NBUnderline' };
const starts = new Set([42, 95, 126, 61, 43, 36, 92]);

/** The source parser keeps its incremental block/code/link machinery. Its
 * inline formatting comes from the same grammar as visual mode. One temporary
 * token index per inline context; weak ownership releases it after the parse. */
export const sourceFormattingGrammar: Configuration = {
  defineNodes: [
    { name: 'NBStrikethrough', style: { 'NBStrikethrough/...': tags.strikethrough } },
    { name: 'NBHighlight', style: { 'NBHighlight/...': tags.special(tags.string) } },
    { name: 'NBUnderline', style: { 'NBUnderline/...': tags.link } },
    { name: 'NBFormatMark', style: tags.processingInstruction },
    { name: 'NBMath', style: tags.special(tags.string) },
  ],
  parseInline: (() => {
    const cache = new WeakMap<object, Map<number, FormattingSpan | { from: number; to: number }>>();
    return [{
      name: 'NoteBoardFormatting', before: 'Emphasis',
      parse(context, next, pos) {
        if (!starts.has(next)) return -1;
        let tokens = cache.get(context);
        if (!tokens) {
          tokens = new Map();
          let at = context.offset;
          for (const token of inlineTokens(documentParser().manager.instance, context.text)) {
            const span = formattingSpan(token, at);
            if (span) tokens.set(at, span);
            else if (token.type === 'mathInline') tokens.set(at, { from: at, to: at + token.raw.length });
            at += token.raw.length;
          }
          cache.set(context, tokens);
        }
        const outer = tokens.get(pos); if (!outer) return -1;
        if (!('mark' in outer)) return context.addElement(context.elt('NBMath', pos, outer.to));
        return context.addElement(context.elt(nodes[outer.mark], pos, outer.to, [
          context.elt('NBFormatMark', pos, outer.contentFrom),
          ...context.parser.parseInline(context.slice(outer.contentFrom, outer.contentTo), outer.contentFrom),
          context.elt('NBFormatMark', outer.contentTo, outer.to),
        ]));
      },
    }];
  })(),
};
