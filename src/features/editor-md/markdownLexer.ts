import { Marked, Tokenizer, type marked } from 'marked';
import { isCjkBoundary, withCjkBoundaries } from './markdownBoundary';
import { formattingMask } from './inlineFormattingMask';

type Rules = Tokenizer['rules'];
const boundaryRules = new WeakMap<Rules, Rules>();
function cjkRules(rules: Rules): Rules {
  let adapted = boundaryRules.get(rules);
  if (!adapted) {
    const inline = { ...rules.inline };
    for (const name of ['emStrongLDelim', 'emStrongRDelimAst', 'emStrongRDelimUnd', 'delLDelim', 'delRDelim', 'punctuation'] as const) inline[name] = withCjkBoundaries(inline[name]);
    adapted = { ...rules, inline };
    boundaryRules.set(rules, adapted); boundaryRules.set(adapted, adapted);
  }
  return adapted;
}

class CjkTokenizer extends Tokenizer {
  private boundary(masked: string, source: string, previous = '') {
    this.rules = cjkRules(this.rules);
    // Marked's previous character may be one UTF-16 code unit. The mask keeps
    // original offsets, so retrieve a full code point for supplementary Han.
    const at = masked.length - source.length;
    const before = [...masked.slice(Math.max(0, at - 2), at)].at(-1) ?? previous;
    return isCjkBoundary(before) ? '。' : previous;
  }
  override emStrong(source: string, masked: string, previous = '') {
    return super.emStrong(source, masked, this.boundary(masked, source, previous));
  }
  override del(source: string, masked: string, previous = '') {
    return super.del(source, masked, this.boundary(masked, source, previous));
  }
}

/** Tiptap defaults to the module-global marked function, whose tokenizer arrays
 * grow on every manager construction. Each grammar owner needs its own lexer.
 * Tiptap types this option as the callable default export but consumes only the
 * methods and constructors also provided by a Marked instance. */
export function createMarkdownLexer(): typeof marked {
  return new Marked().setOptions({ tokenizer: new CjkTokenizer() })
    .use({ hooks: { emStrongMask: source => formattingMask(source) }, extensions: [{
      name: 'noteboardListBoundary', level: 'block', start: () => -1,
      tokenizer(source) {
        // Our exact HTML comment separates adjacent Markdown lists. Keep it as a
        // lexer boundary, but do not let the HTML fallback invent a paragraph.
        const match = /^<!-- noteboard-list-boundary -->[ \t]*(?:\r?\n|$)/.exec(source);
        return match ? { type: 'noteboardListBoundary', raw: match[0] } : undefined;
      },
    }] }) as unknown as typeof marked;
}

/** A block extension only needs to interrupt the current paragraph. Looking
 * beyond its blank-line boundary rescans the remaining document per paragraph. */
export function currentParagraph(source: string): string {
  const end = /\n[ \t]*\n/.exec(source)?.index;
  return end === undefined ? source : source.slice(0, end);
}

/** Marked probes startBlock on source.slice(1). The first partial line cannot
 * establish an own-line block: an escaped opener would lose its leading slash.
 * A genuine opener at the current position is handled by tokenize() itself. */
export function followingBlockStart(source: string, opener: RegExp): number {
  const paragraph = currentParagraph(source), newline = paragraph.indexOf('\n');
  if (newline < 0) return -1;
  const match = opener.exec(paragraph.slice(newline + 1));
  return match ? newline + 1 + match.index : -1;
}
