/** Bounded, presentation-only line/fold metadata. Offsets always refer to the source. */
export interface CodeFold { line: number; endLine: number; from: number; to: number }
export interface CodeLine { number: number; from: number; to: number }
export interface CodeStructure { lines: CodeLine[]; folds: CodeFold[] }
export const MAX_CODE_CONTROL_CHARACTERS = 128_000;
export const MAX_CODE_CONTROL_LINES = 2_000;

const braceLanguages = new Set(['javascript', 'typescript', 'jsx', 'tsx', 'json', 'jsonc', 'css', 'scss', 'less', 'c', 'cpp', 'csharp', 'java', 'go', 'rust', 'php', 'swift', 'kotlin', 'scala']);

export function getCodeStructure(source: string, language: string): CodeStructure | null {
  if (source.length > MAX_CODE_CONTROL_CHARACTERS) return null;
  const lines: CodeLine[] = [];
  let from = 0;
  for (let i = 0; i <= source.length; i++) {
    if (i !== source.length && source[i] !== '\n') continue;
    lines.push({ number: lines.length + 1, from, to: i });
    if (lines.length > MAX_CODE_CONTROL_LINES) return null;
    from = i + 1;
  }
  const folds = language === 'python' ? pythonFolds(source, lines) : braceLanguages.has(language) ? braceFolds(source, lines) : [];
  return { lines, folds };
}

function makeFold(lines: CodeLine[], start: number, end: number): CodeFold | null {
  const from = lines[start].to, to = lines[end].to;
  return end > start && to > from ? { line: start + 1, endLine: end + 1, from, to } : null;
}

function braceFolds(source: string, lines: CodeLine[]): CodeFold[] {
  const stack: Array<{ character: string; line: number }> = [];
  const folds = new Map<number, CodeFold>();
  let line = 0, quote = '', blockComment = false, lineComment = false, regex = false, regexClass = false;
  let previous = '', word = '';
  for (let i = 0; i < source.length; i++) {
    const c = source[i], next = source[i + 1];
    if (c === '\n') { line++; lineComment = false; if (regex) regex = false; continue; }
    if (lineComment) continue;
    if (blockComment) { if (c === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) { if (c === '\\') { if (next === '\n') line++; i++; } else if (c === quote) quote = ''; continue; }
    if (regex) {
      if (c === '\\') { if (next === '\n') line++; i++; }
      else if (c === '[') regexClass = true;
      else if (c === ']') regexClass = false;
      else if (c === '/' && !regexClass) regex = false;
      continue;
    }
    if (c === '/' && next === '/') { lineComment = true; i++; continue; }
    if (c === '/' && next === '*') { blockComment = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; word = ''; previous = 'value'; continue; }
    if (c === '/' && (!previous || /[=(:,!&|?;{[]/.test(previous) || /^(return|throw|case|yield)$/.test(word))) { regex = true; regexClass = false; continue; }
    if (/\s/.test(c)) continue;
    if (/[\w$]/.test(c)) { word += c; previous = 'value'; continue; }
    word = '';
    if (c === '{' || c === '[') stack.push({ character: c, line });
    else if (c === '}' || c === ']') {
      const opening = stack.pop();
      if (opening && opening.character === (c === '}' ? '{' : '[') && line > opening.line + 1) {
        const fold = makeFold(lines, opening.line, line - 1);
        if (fold && (!folds.has(fold.line) || folds.get(fold.line)!.to < fold.to)) folds.set(fold.line, fold);
      }
    }
    previous = c;
  }
  return [...folds.values()].sort((a, b) => a.from - b.from);
}

function pythonFolds(source: string, lines: CodeLine[]): CodeFold[] {
  let triple = '', quote = '', depth = 0;
  const statements = lines.map(line => {
    const text = source.slice(line.from, line.to), continuation = !!triple || depth > 0;
    let code = '';
    for (let i = 0; i < text.length; i++) {
      const c = text[i], three = text.slice(i, i + 3);
      if (triple) { if (three === triple) { triple = ''; i += 2; } else if (c === '\\') i++; continue; }
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
      if (c === '#') break;
      if (three === '"""' || three === "'''") { triple = three; code += 'value'; i += 2; continue; }
      if (c === '"' || c === "'") { quote = c; code += 'value'; continue; }
      if ('([{'.includes(c)) depth++;
      if (')]}'.includes(c)) depth = Math.max(0, depth - 1);
      code += c;
    }
    quote = '';
    const whitespace = text.match(/^[\t ]*/)?.[0] ?? '';
    const indent = [...whitespace].reduce((column, c) => c === '\t' ? column + 8 - column % 8 : column + 1, 0);
    return { indent, meaningful: !!code.trim(), header: !continuation && depth === 0 && code.trimEnd().endsWith(':'), continuation };
  });
  const active: number[] = [], folds: CodeFold[] = [];
  const finish = (start: number, end: number) => {
    while (end > start && !source.slice(lines[end].from, lines[end].to).trim()) end--;
    const fold = makeFold(lines, start, end);
    if (fold) folds.push(fold);
  };
  statements.forEach((statement, i) => {
    if (!statement.meaningful || statement.continuation) return;
    while (active.length && statement.indent <= statements[active[active.length - 1]].indent) finish(active.pop()!, i - 1);
    if (statement.header) active.push(i);
  });
  while (active.length) finish(active.pop()!, lines.length - 1);
  return folds.sort((a, b) => a.from - b.from);
}
