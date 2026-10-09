import { readMath, writeMath, type MathSource } from './mathSyntax';

const htmlAttribute = (text: string) => text.replace(/[&"<>\r\n]/g, char => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;', '\r': '&#13;', '\n': '&#10;' })[char]!);

/** Keep an existing formula inline in source edits and Markdown serialization.
 * Source edits prefer portable inline TeX. Saving also preserves the node's
 * delimiter, using the existing HTML carrier when it could imply a block. */
export function inlineMathCarrier(source: MathSource, preserveDelimiter = false): string {
  if (!preserveDelimiter) {
    const inline = writeMath({ ...source, delimiter: '\\(' }), roundtrip = readMath(inline);
    if (roundtrip?.end === inline.length && roundtrip.latex === source.latex) return inline;
  }
  return `<span data-math-inline latex="${htmlAttribute(source.latex)}" delimiter="${htmlAttribute(source.delimiter)}">${htmlAttribute(writeMath(source))}</span>`;
}
