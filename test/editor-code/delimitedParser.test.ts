import { describe, expect, it } from 'vitest';
import { DELIMITED_LIMITS, DelimitedParseError, columnLabel, indexDelimited, parseCellAddress, readDelimitedCell, readDelimitedWindow } from '../../src/features/editor-code/delimited/parser';

describe('delimited source indexing', () => {
  it('preserves BOM, CRLF, escaped quotes, multiline fields and terminal empty fields', () => {
    const source = '\ufeff"two\r\nlines","a""b",\r\n001,=SUM(A1),last';
    const index = indexDelimited(source, ',');
    expect(index).toMatchObject({ rows: 2, columns: 3, raggedRows: 0, indexBytes: 32 });
    expect(readDelimitedCell(source, ',', index, 0, 0)).toMatchObject({ value: 'two\r\nlines', sourceLine: 1, missing: false });
    expect(readDelimitedCell(source, ',', index, 0, 1).value).toBe('a"b');
    expect(readDelimitedCell(source, ',', index, 0, 2).value).toBe('');
    expect(readDelimitedCell(source, ',', index, 1, 0)).toMatchObject({ value: '001', sourceLine: 3 });
    expect(readDelimitedCell(source, ',', index, 1, 1).value).toBe('=SUM(A1)');
  });

  it('keeps the first record as data and distinguishes missing columns from empty fields', () => {
    const source = 'Name,Value,Other\na,b,\nx\n';
    const index = indexDelimited(source, ',');
    expect(index).toMatchObject({ rows: 3, columns: 3, raggedRows: 1 });
    const rows = readDelimitedWindow(source, ',', index, { rowStart: 0, rowEnd: 3, columnStart: 0, columnEnd: 3 });
    expect(rows[0].cells.map(cell => cell.value)).toEqual(['Name', 'Value', 'Other']);
    expect(rows[1].cells[2]).toMatchObject({ value: '', missing: false });
    expect(rows[2].cells[2]).toMatchObject({ value: '', missing: true });
  });

  it('handles TSV quoting, lone CR/LF, empty records, no final newline and blank files', () => {
    const source = 'a\t"b\tc"\r\n\r"d\ne"\t';
    const index = indexDelimited(source, '\t');
    expect(index.rows).toBe(3);
    expect(readDelimitedCell(source, '\t', index, 0, 1).value).toBe('b\tc');
    expect(readDelimitedCell(source, '\t', index, 1, 0)).toMatchObject({ value: '', sourceLine: 2 });
    expect(readDelimitedCell(source, '\t', index, 2, 0)).toMatchObject({ value: 'd\ne', sourceLine: 3 });
    expect(readDelimitedCell(source, '\t', index, 2, 1).value).toBe('');
    expect(indexDelimited('', ',').rows).toBe(0);
    expect(indexDelimited('\ufeff', ',').rows).toBe(0);
    expect(indexDelimited('\n', ',').rows).toBe(1);
    expect(indexDelimited(',,', ',').columns).toBe(3);
  });

  it.each(['a,b"c', 'a,"b" c', 'a,"unterminated', '"""'])('reports invalid quoting without silently changing %s', source => {
    expect(() => indexDelimited(source, ',')).toThrow(DelimitedParseError);
    expect(() => indexDelimited(source, ',')).toThrow(/第 1 行.*请查看源码/);
  });

  it('bounds returned excerpts while making the complete field available unchanged', () => {
    const value = '"' + '长字段😀\r\n'.repeat(10_000) + '"';
    const index = indexDelimited(value, ',');
    const preview = readDelimitedWindow(value, ',', index, { rowStart: 0, rowEnd: 1, columnStart: 0, columnEnd: 1 })[0].cells[0];
    expect(preview.truncated).toBe(true);
    expect(preview.value.length).toBeLessThanOrEqual(DELIMITED_LIMITS.cellPreviewUnits);
    expect(readDelimitedCell(value, ',', index, 0, 0).value).toBe(value.slice(1, -1));
    const data = Array.from({ length: 200 }, () => Array(100).fill('x'.repeat(400)).join(',')).join('\n');
    const large = indexDelimited(data, ',');
    const window = readDelimitedWindow(data, ',', large, { rowStart: 0, rowEnd: 200, columnStart: 0, columnEnd: 100 });
    expect(window).toHaveLength(DELIMITED_LIMITS.windowRows);
    expect(window[0].cells).toHaveLength(DELIMITED_LIMITS.windowColumns);
    expect(window.reduce((total, row) => total + row.cells.reduce((count, field) => count + field.value.length, 0), 0)).toBeLessThanOrEqual(DELIMITED_LIMITS.windowUnits);
  });

  it('indexes all 100,000 by 30 records with 16 bytes of index per record', () => {
    const source = Array(100_000).fill(Array(30).fill('x').join(',')).join('\n');
    const start = performance.now();
    const index = indexDelimited(source, ',');
    const elapsed = performance.now() - start;
    expect(index).toMatchObject({ rows: 100_000, columns: 30, indexBytes: 1_600_000 });
    expect(readDelimitedCell(source, ',', index, 99_999, 29).value).toBe('x');
    console.info(`Delimited benchmark: ${source.length} UTF-16 units, 100000×30, ${elapsed.toFixed(1)} ms, ${index.indexBytes} index bytes`);
  });

  it('rejects oversized sources, excessive columns, records and fields explicitly', () => {
    expect(() => indexDelimited('x'.repeat(DELIMITED_LIMITS.sourceUnits + 1), ',')).toThrow(/文本过大/);
    expect(() => indexDelimited(','.repeat(DELIMITED_LIMITS.columns), ',')).toThrow(/列数过多/);
    expect(() => indexDelimited('\n'.repeat(DELIMITED_LIMITS.rows + 1), ',')).toThrow(/记录过多/);
    const row = ','.repeat(9999);
    expect(() => indexDelimited(Array(401).fill(row).join('\n'), ',')).toThrow(/字段过多/);
  });

  it('maps every column and validates cell addresses without numeric conversion', () => {
    expect([0, 25, 26, 29, 701, 702].map(columnLabel)).toEqual(['A', 'Z', 'AA', 'AD', 'ZZ', 'AAA']);
    expect(parseCellAddress(' ad100000 ')).toEqual({ row: 99999, column: 29 });
    expect(parseCellAddress('A0')).toBeNull();
    expect(parseCellAddress('<b>1')).toBeNull();
    expect(parseCellAddress('A999999999999')).toBeNull();
  });

  it('clamps viewport bounds and returns no phantom fields for an empty column range', () => {
    const source = 'a,b\nc,d', index = indexDelimited(source, ',');
    expect(readDelimitedWindow(source, ',', index, { rowStart: -10, rowEnd: 20, columnStart: 0, columnEnd: 0 }).map(row => row.cells)).toEqual([[], []]);
    expect(readDelimitedWindow(source, ',', index, { rowStart: 20, rowEnd: 30, columnStart: 0, columnEnd: 2 })).toEqual([]);
    expect(() => readDelimitedCell(source, ',', index, 2, 0)).toThrow(RangeError);
  });
});
