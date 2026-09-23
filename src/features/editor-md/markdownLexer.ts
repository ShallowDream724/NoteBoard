import { Marked, type marked } from 'marked';

/** Tiptap defaults to the module-global marked function, whose tokenizer arrays
 * grow on every manager construction. Each grammar owner needs its own lexer.
 * Tiptap types this option as the callable default export but consumes only the
 * methods and constructors also provided by a Marked instance. */
export function createMarkdownLexer(): typeof marked {
  return new Marked() as unknown as typeof marked;
}

/** A block extension only needs to interrupt the current paragraph. Looking
 * beyond its blank-line boundary rescans the remaining document per paragraph. */
export function currentParagraph(source: string): string {
  const end = /\n[ \t]*\n/.exec(source)?.index;
  return end === undefined ? source : source.slice(0, end);
}
