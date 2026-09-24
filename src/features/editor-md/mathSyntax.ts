/** Markdown math boundaries. TeX payloads are opaque; never rewrite their escapes. */
export type MathDelimiter = '$' | '$$' | '\\(' | '\\[';
export interface MathSource { latex: string; delimiter: MathDelimiter }
export interface MathMatch extends MathSource { start: number; end: number; raw: string }

export const mathClosingDelimiter = (delimiter: MathDelimiter): string => (
  delimiter === '\\(' ? '\\)' : delimiter === '\\[' ? '\\]' : delimiter
);
export const isDisplayMath = (delimiter: MathDelimiter): boolean => (
  delimiter === '$$' || delimiter === '\\['
);

export function isMathEscaped(source: string, offset: number): boolean {
  let count = 0;
  while (offset > 0 && source[--offset] === '\\') count++;
  return count % 2 === 1;
}

/** An opener never starts at the second slash of a TeX row break. */
export function readMath(source: string, start = 0, blockContext = false): MathMatch | null {
  let delimiter: MathDelimiter;
  if (source.startsWith('$$', start)) delimiter = '$$';
  else if (source.startsWith('\\(', start)) delimiter = '\\(';
  else if (source.startsWith('\\[', start)) delimiter = '\\[';
  else if (source[start] === '$' && source[start - 1] !== '$') delimiter = '$';
  else return null;
  if (isMathEscaped(source, start)) return null;
  const closing = mathClosingDelimiter(delimiter);
  const display = isDisplayMath(delimiter);
  const payloadStart = start + delimiter.length;
  let comment = false;
  let braces = 0;
  for (let cursor = payloadStart; cursor < source.length; cursor++) {
    const char = source[cursor];
    if (char === '\n' || char === '\r') {
      if (!display) return null;
      comment = false;
      continue;
    }
    if (comment) continue;
    if (char === '%' && !isMathEscaped(source, cursor)) { comment = true; continue; }
    // A Markdown code span cannot supply a missing closing delimiter.
    if (!blockContext && char === '`' && !isMathEscaped(source, cursor)) return null;
    if (char === '{' && !isMathEscaped(source, cursor)) braces++;
    if (char === '}' && !isMathEscaped(source, cursor)) braces = Math.max(0, braces - 1);
    if (braces) continue;
    if (delimiter === '\\[' && source.startsWith('\\[', cursor) && !isMathEscaped(source, cursor)) return null;
    if (!source.startsWith(closing, cursor) || isMathEscaped(source, cursor)) continue;
    if (delimiter === '$' && (source[cursor - 1] === '$' || source[cursor + 1] === '$')) continue;
    // "$100 and $200" is money; "$ 100 $" is an explicit paired expression.
    const latex = source.slice(payloadStart, cursor);
    // Bare monetary amounts must not borrow a later formula's opener.
    const amount = latex.trimStart();
    if (delimiter === '$' && /^[+-]?(?:\d|\.\d)/.test(amount)) {
      const prose = /[，；。！？]/.test(amount)
        || /\b(?:and|or|each|per|plus|costs?|costing|for|then)\b/i.test(amount);
      const currencyUnit = /^[+-]?[\d.,]+\s*(?:USD|EUR|CAD|AUD|CNY|RMB|JPY|GBP|HKD|SGD|美元|美金|人民币|元|欧元|英镑|日元)/i.test(amount);
      if (!/[\\{}_^]/.test(amount) && (prose || currencyUnit)) return null;
      if (/^\s*[+-]?(?:\d|\.\d)/.test(source.slice(cursor + 1))
        && /^[+-]?[\d.,\s\p{L}]+$/u.test(amount)) return null;
    }
    if (!display && !latex.trim()) return null;
    const end = cursor + closing.length;
    return { start, end, raw: source.slice(start, end), latex, delimiter };
  }
  return null;
}

/** Called only in the Markdown parser's ordinary-text context. */
export function findMathStart(source: string): number {
  let escaped = false;
  for (let cursor = 0; cursor < source.length; cursor++) {
    const char = source[cursor];
    if (char === '\\') {
      if (!escaped && (source[cursor + 1] === '(' || source[cursor + 1] === '[')) return cursor;
      escaped = !escaped;
    } else {
      if (!escaped && char === '$') return cursor;
      escaped = false;
    }
  }
  return -1;
}

/** Own-line fences delimit an opaque TeX block, even when that TeX is invalid.
 * Do not make Markdown ownership depend on balanced TeX braces or inner \[ tokens.
 * One forward scan; no TeX parser, line array or per-character source copies. */
function readFencedMathBlock(source: string): MathMatch | null {
  const opening = /^ {0,3}(\$\$|\\\[)[ \t]*\r?\n/.exec(source);
  if (!opening) return null;
  const delimiter = opening[1] as MathDelimiter;
  const closing = mathClosingDelimiter(delimiter);
  const boundaries = /^ {0,3}(\$\$|\\\[|\\\])[ \t]*(?:\r?\n|$)/gm;
  boundaries.lastIndex = opening[0].length;
  let boundary: RegExpExecArray | null;
  while ((boundary = boundaries.exec(source))) {
    if (boundary[1] === closing) {
      const end = boundaries.lastIndex;
      const latex = source.slice(opening[0].length, boundary.index).replace(/\r?\n$/, '');
      return { start: 0, end, raw: source.slice(0, end), latex, delimiter };
    }
    // An unclosed bracket block must not consume the following bracket block.
    if (boundary[1] === delimiter) return null;
  }
  return null;
}

export function readMathBlock(source: string): MathMatch | null {
  const fenced = readFencedMathBlock(source);
  if (fenced) return fenced;
  // Retain compact and mixed-line syntax when there is no own-line fence pair.
  const indent = /^ {0,3}(?=\$\$|\\\[)/.exec(source)?.[0].length;
  if (indent === undefined) return null;
  const match = readMath(source, indent, true);
  if (!match || !isDisplayMath(match.delimiter)) return null;
  const suffix = /^[ \t]*(?:\r?\n|$)/.exec(source.slice(match.end));
  if (!suffix) return null;
  let latex = match.latex;
  if (/^[ \t]*\r?\n/.test(latex)) {
    latex = latex.replace(/^[ \t]*\r?\n/, '').replace(/\r?\n {0,3}$/, '');
  } else {
    latex = latex.trim();
  }
  return { ...match, start: 0, end: match.end + suffix[0].length,
    raw: source.slice(0, match.end + suffix[0].length), latex };
}

export function writeMath(source: MathSource, block = false): string {
  const close = mathClosingDelimiter(source.delimiter);
  return block
    ? source.delimiter + '\n' + source.latex + '\n' + close
    : source.delimiter + source.latex + close;
}

/** A bounded input rule; never reparse the document on each keystroke. */
export function mathAtTextEnd(text: string): MathMatch | null {
  let codeRun = 0;
  for (let cursor = 0; cursor < text.length; cursor++) {
    if (text[cursor] === '`' && !isMathEscaped(text, cursor)) {
      let end = cursor;
      while (text[end] === '`') end++;
      const length = end - cursor;
      if (codeRun === 0) codeRun = length;
      else if (codeRun === length) codeRun = 0;
      cursor = end - 1;
      continue;
    }
    if (codeRun) continue;
    const match = readMath(text, cursor);
    if (!match) continue;
    if (match.end === text.length) return match;
    cursor = match.end - 1;
  }
  return null;
}
