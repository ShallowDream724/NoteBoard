export type Delimiter = ',' | '\t';

/** Index storage is proportional to records, never to all decoded cells. */
export const DELIMITED_LIMITS = Object.freeze({
  sourceUnits: 8 * 1024 * 1024,
  rows: 200_000,
  columns: 10_000,
  fields: 4_000_000,
  windowRows: 128,
  windowColumns: 64,
  windowUnits: 256 * 1024,
  cellPreviewUnits: 256,
});

export class DelimitedParseError extends Error {
  constructor(message: string, readonly code: 'limit' | 'syntax', readonly sourceLine?: number) {
    super(message);
    this.name = 'DelimitedParseError';
  }
}

export interface DelimitedSummary {
  rows: number;
  columns: number;
  raggedRows: number;
  sourceUnits: number;
  indexBytes: number;
}

export interface DelimitedIndex extends DelimitedSummary {
  /** start, end, source line, field count for each record */
  records: Uint32Array;
}

export interface DelimitedWindowRequest {
  rowStart: number;
  rowEnd: number;
  columnStart: number;
  columnEnd: number;
}

export interface DelimitedCellPreview {
  column: number;
  value: string;
  truncated: boolean;
  missing: boolean;
}

export interface DelimitedWindowRow {
  row: number;
  sourceLine: number;
  cells: DelimitedCellPreview[];
}

export interface DelimitedCellValue {
  row: number;
  column: number;
  sourceLine: number;
  value: string;
  missing: boolean;
}

function limit(message: string): never {
  throw new DelimitedParseError(`${message}，无法打开表格视图。请查看源码。`, 'limit');
}

function syntax(line: number, message: string): never {
  throw new DelimitedParseError(`第 ${line} 行${message}。请查看源码。`, 'syntax', line);
}

/** Strict CSV quoting also applies to TSV. CR/LF inside quotes is preserved. */
export function indexDelimited(text: string, delimiter: Delimiter): DelimitedIndex {
  if (text.length > DELIMITED_LIMITS.sourceUnits) limit('文本过大');
  const first = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  if (first === text.length) return { rows: 0, columns: 0, raggedRows: 0, sourceUnits: text.length, indexBytes: 0, records: new Uint32Array(0) };
  let records = new Uint32Array(4 * 1024);
  let rowCount = 0, columns = 0, fieldTotal = 0;
  let start = first, rowLine = 1, line = 1, fieldCount = 1;
  let state: 'start' | 'plain' | 'quoted' | 'closed' = 'start';
  const finish = (end: number) => {
    if (rowCount >= DELIMITED_LIMITS.rows) limit('记录过多');
    fieldTotal += fieldCount;
    if (fieldTotal > DELIMITED_LIMITS.fields) limit('字段过多');
    if ((rowCount + 1) * 4 > records.length) {
      const grown = new Uint32Array(Math.min(records.length * 2, DELIMITED_LIMITS.rows * 4));
      grown.set(records); records = grown;
    }
    records.set([start, end, rowLine, fieldCount], rowCount * 4);
    rowCount++; columns = Math.max(columns, fieldCount);
  };
  for (let at = first; at < text.length; at++) {
    const char = text[at];
    if (state === 'quoted') {
      if (char === '"') {
        if (text[at + 1] === '"') at++;
        else state = 'closed';
      } else if (char === '\r' || char === '\n') {
        if (char === '\r' && text[at + 1] === '\n') at++;
        line++;
      }
      continue;
    }
    if (char === delimiter) {
      fieldCount++;
      if (fieldCount > DELIMITED_LIMITS.columns) limit('列数过多');
      state = 'start';
    } else if (char === '\r' || char === '\n') {
      finish(at);
      if (char === '\r' && text[at + 1] === '\n') at++;
      line++; start = at + 1; rowLine = line; fieldCount = 1; state = 'start';
    } else if (char === '"') {
      if (state !== 'start') syntax(line, '包含未转义的引号');
      state = 'quoted';
    } else {
      if (state === 'closed') syntax(line, '的引号后存在多余字符');
      state = 'plain';
    }
  }
  if (state === 'quoted') syntax(rowLine, '的引号未闭合');
  // A terminal line ending closes its record; it does not add a phantom row.
  if (start < text.length) finish(text.length);
  const compact = records.slice(0, rowCount * 4);
  let raggedRows = 0;
  for (let row = 0; row < rowCount; row++) if (compact[row * 4 + 3] !== columns) raggedRows++;
  return { rows: rowCount, columns, raggedRows, sourceUnits: text.length, indexBytes: compact.byteLength, records: compact };
}

function cellRanges(text: string, delimiter: Delimiter, start: number, end: number, first: number, last: number, visit: (column: number, from: number, to: number) => void) {
  if (first >= last) return;
  let fieldStart = start, column = 0, quoted = false;
  for (let at = start; at <= end; at++) {
    const char = text[at];
    if (at < end && char === '"') {
      if (quoted && text[at + 1] === '"') at++;
      else quoted = !quoted;
    } else if (at === end || (!quoted && char === delimiter)) {
      if (column >= first) visit(column, fieldStart, at);
      if (++column >= last) return;
      fieldStart = at + 1;
    }
  }
}

function decode(text: string, from: number, to: number, maxUnits: number): { value: string; truncated: boolean } {
  if (text[from] !== '"') {
    let end = Math.min(to, from + maxUnits);
    // Do not split a surrogate pair in the displayed excerpt.
    if (end < to && end > from && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) end--;
    return { value: text.slice(from, end), truncated: end < to };
  }
  const end = to - 1;
  if (maxUnits === Infinity) return { value: text.slice(from + 1, end).replace(/""/g, '"'), truncated: false };
  let value = '', at = from + 1;
  while (at < end && value.length < maxUnits) {
    const char = text[at++];
    value += char;
    if (char === '"' && text[at] === '"') at++;
  }
  if (at < end && value.length && value.charCodeAt(value.length - 1) >= 0xd800 && value.charCodeAt(value.length - 1) <= 0xdbff) value = value.slice(0, -1);
  return { value, truncated: at < end };
}

function bounds(start: number, end: number, count: number, maximum: number): [number, number] {
  const first = Math.min(count, Math.max(0, Number.isFinite(start) ? Math.floor(start) : 0));
  const last = Math.min(count, first + maximum, Math.max(first, Number.isFinite(end) ? Math.floor(end) : first));
  return [first, last];
}

export function readDelimitedWindow(text: string, delimiter: Delimiter, index: DelimitedIndex, request: DelimitedWindowRequest): DelimitedWindowRow[] {
  const [rowStart, rowEnd] = bounds(request.rowStart, request.rowEnd, index.rows, DELIMITED_LIMITS.windowRows);
  const [columnStart, columnEnd] = bounds(request.columnStart, request.columnEnd, index.columns, DELIMITED_LIMITS.windowColumns);
  const units = Math.min(DELIMITED_LIMITS.cellPreviewUnits, Math.floor(DELIMITED_LIMITS.windowUnits / Math.max(1, (rowEnd - rowStart) * (columnEnd - columnStart))));
  const result: DelimitedWindowRow[] = [];
  for (let row = rowStart; row < rowEnd; row++) {
    const offset = row * 4;
    const cells: DelimitedCellPreview[] = [];
    cellRanges(text, delimiter, index.records[offset], index.records[offset + 1], columnStart, columnEnd, (column, from, to) => {
      cells.push({ column, ...decode(text, from, to, units), missing: false });
    });
    for (let column = Math.max(columnStart, index.records[offset + 3]); column < columnEnd; column++) cells.push({ column, value: '', truncated: false, missing: true });
    result.push({ row, sourceLine: index.records[offset + 2], cells });
  }
  return result;
}

export function readDelimitedCell(text: string, delimiter: Delimiter, index: DelimitedIndex, row: number, column: number): DelimitedCellValue {
  if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || row >= index.rows || column < 0 || column >= index.columns) throw new RangeError('单元格超出范围');
  const offset = row * 4, missing = column >= index.records[offset + 3];
  let value = '';
  if (!missing) cellRanges(text, delimiter, index.records[offset], index.records[offset + 1], column, column + 1, (_column, from, to) => { value = decode(text, from, to, Infinity).value; });
  return { row, column, sourceLine: index.records[offset + 2], value, missing };
}

export function columnLabel(column: number): string {
  let label = '', at = column + 1;
  while (at > 0) { at--; label = String.fromCharCode(65 + at % 26) + label; at = Math.floor(at / 26); }
  return label;
}

export function parseCellAddress(address: string): { row: number; column: number } | null {
  const match = /^([a-z]+)([1-9]\d*)$/i.exec(address.trim());
  if (!match || match[1].length > 4 || match[2].length > 7) return null;
  let column = 0;
  for (const char of match[1].toUpperCase()) column = column * 26 + char.charCodeAt(0) - 64;
  return { row: Number(match[2]) - 1, column: column - 1 };
}
