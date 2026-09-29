/** Conservative TeX structure reader, used for presentation only. It never
 * expands macros or rewrites the stored formula. O(source length + output). */
export interface MatrixSource { environment: string; prefix: string; suffix: string; rows: string[][]; columns: number; rowGaps: string[] }
export const MAX_MATRIX_CELLS = 250_000;
/** TeX comments consume their terminating newline. Remove them before slicing
 * cells, so trimming a cell cannot make its comment swallow a new separator. */
function withoutComments(source: string): string {
  let result = '', start = 0;
  for (let at = 0; at < source.length; at++) {
    if (source[at] === '\\') { at++; continue; }
    if (source[at] !== '%') continue;
    result += source.slice(start, at);
    const newline = source.indexOf('\n', at);
    at = newline < 0 ? source.length : newline; start = at + 1;
  }
  return result + source.slice(start);
}
export function matrixSource(latex: string, options?: { retainBarred?: boolean }): MatrixSource | null {
  latex = withoutComments(latex);
  const begin = /\\begin\{(matrix|[bpvBV]matrix)\}/.exec(latex);
  if (!begin) return null;
  const prefix = latex.slice(0, begin.index), environment = begin[1], ending = `\\end{${environment}}`;
  // Bars may denote a determinant or norm: displaying separate barred tiles
  // would suggest independent determinants, which changes the expression.
  if (!options?.retainBarred && (environment === 'vmatrix' || environment === 'Vmatrix')) return null;
  const end = latex.lastIndexOf(ending), suffix = latex.slice(end + ending.length);
  // Tiling a matrix inside a larger product/fraction would change its meaning.
  if (end < 0 || !/^\s*(?:[A-Za-z](?:_[A-Za-z0-9]|_\{[^{}]+\})?\s*=\s*)?$/.test(prefix) || !/^\s*[.,;]?\s*$/.test(suffix)) return null;
  const body = latex.slice(begin.index + begin[0].length, end), rows: string[][] = [], rowGaps: string[] = [];
  // These commands can carry state or rules across cells. Independent-cell
  // rendering must leave them to the complete TeX renderer.
  if (/\\(?:def|gdef|global|newcommand|renewcommand|color|hline|hdashline|cline|multicolumn)\b/.test(body)) return null;
  let row: string[] = [], start = 0, braces = 0, nested = 0, count = 0;
  const cell = (end: number) => {
    if (++count > MAX_MATRIX_CELLS) throw new Error(`矩阵超过 ${MAX_MATRIX_CELLS.toLocaleString('en-US')} 个单元格，请拆分后导出。`);
    row.push(body.slice(start, end).trim());
  };
  for (let at = 0; at < body.length; at++) {
    if (body[at] === '%') { const line = body.indexOf('\n', at); at = line < 0 ? body.length : line; continue; }
    if (body[at] === '\\') {
      const command = /^\\(begin|end)\{[^{}]+\}/.exec(body.slice(at, at + 80));
      if (command) { nested += command[1] === 'begin' ? 1 : -1; if (nested < 0) return null; at += command[0].length - 1; continue; }
      if (body[at + 1] === '\\' && !braces && !nested) {
        cell(at); rows.push(row); row = []; at++;
        const gap = /^\*?(?:\s*\[-?\d+(?:\.\d+)?(?:pt|em|ex|mm|cm)\])?/.exec(body.slice(at + 1, at + 64))![0];
        rowGaps.push(gap);
        at += gap.length; start = at + 1;
      } else at++;
      continue;
    }
    if (body[at] === '{') braces++;
    else if (body[at] === '}') { if (--braces < 0) return null; }
    else if (body[at] === '&' && !braces && !nested) { cell(at); start = at + 1; }
  }
  if (braces || nested) return null;
  if (body.slice(start).trim() || row.length) { cell(body.length); rows.push(row); }
  const columns = rows.reduce((max, values) => Math.max(max, values.length), 0);
  if (!rows.length || !columns) return null;
  if (rows.length * columns > MAX_MATRIX_CELLS) throw new Error(`矩阵超过 ${MAX_MATRIX_CELLS.toLocaleString('en-US')} 个单元格，请拆分后导出。`);
  return { environment, prefix, suffix, rows, columns, rowGaps };
}
export function matrixPart(source: MatrixSource, rowFrom: number, rowTo: number, columnFrom: number, columnTo: number): string {
  return `\\begin{${source.environment}}` + source.rows.slice(rowFrom, rowTo).map((row, index) =>
    (index ? '\\\\' + (source.rowGaps[rowFrom + index - 1] ?? '') : '') +
    Array.from({ length: columnTo - columnFrom }, (_, i) => row[columnFrom + i] ?? '').join('&')).join('') + `\\end{${source.environment}}`;
}
