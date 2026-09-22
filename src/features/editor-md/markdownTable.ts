import { Table, TableRow } from '@tiptap/extension-table';
import type { JSONContent } from '@tiptap/core';

const PREFIX = '<!-- noteboard-table ';
const tokenizer = Table.config.markdownTokenizer!;
const size = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(10000, Math.round(value)) : 0;
interface TableLayout {
  widths: number[]; heights: Record<string, number>; noHeader?: boolean;
  rows?: Record<string, { count: number; cells: Record<string, { colspan: number; rowspan: number; header: boolean }> }>;
}
function isTableLayout(value: unknown): value is TableLayout {
  if (!value || typeof value !== 'object') return false;
  const layout = value as TableLayout;
  const record = (item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item);
  const dimension = (item: unknown): item is number => typeof item === 'number' && Number.isInteger(item) && item >= 0 && item <= 10000;
  if (!Array.isArray(layout.widths) || !layout.widths.length || layout.widths.length > 10000 || !layout.widths.every(dimension)) return false;
  if (!record(layout.heights) || Object.entries(layout.heights).some(([key, height]) => !/^\d+$/.test(key) || !dimension(height))) return false;
  if (layout.noHeader !== undefined && typeof layout.noHeader !== 'boolean') return false;
  if (layout.rows !== undefined) {
    if (!record(layout.rows)) return false;
    for (const [key, row] of Object.entries(layout.rows)) {
      if (!/^\d+$/.test(key) || !record(row) || !dimension(row.count) || !record(row.cells)) return false;
      for (const [column, cell] of Object.entries(row.cells)) {
        if (!/^\d+$/.test(column) || Number(column) >= row.count || !record(cell)
          || !dimension(cell.colspan) || !cell.colspan || cell.colspan > layout.widths.length
          || !dimension(cell.rowspan) || !cell.rowspan || typeof cell.header !== 'boolean') return false;
      }
    }
  }
  return true;
}

export const SizedTableRow = TableRow.extend({
  addAttributes() {
    return { height: { default: null,
      parseHTML: element => size(parseFloat(element.style.height)) || null,
      renderHTML: attrs => size(attrs.height) ? { style: `height: ${size(attrs.height)}px` } : {},
    } };
  },
});

function dimensions(node: JSONContent) {
  const widths: number[] = [], heights: Record<number, number> = {};
  const rows: NonNullable<TableLayout['rows']> = {};
  const hasHeader = node.content?.[0]?.content?.some(cell => cell.type === 'tableHeader');
  const count = node.content?.reduce((max, row) => Math.max(max, row.content?.length ?? 0), 0) ?? 0;
  for (const cell of node.content?.[0]?.content ?? []) {
    for (let col = 0; col < (cell.attrs?.colspan ?? 1); col++) widths.push(size(cell.attrs?.colwidth?.[col]));
  }
  node.content?.forEach((row, index) => {
    if (size(row.attrs?.height)) heights[index] = size(row.attrs?.height);
    const cells: NonNullable<TableLayout['rows']>[string]['cells'] = {};
    row.content?.forEach((cell, col) => {
      const colspan = size(cell.attrs?.colspan) || 1, rowspan = size(cell.attrs?.rowspan) || 1;
      const header = cell.type === 'tableHeader';
      if (colspan > 1 || rowspan > 1 || header !== (index === 0 && !!hasHeader)) cells[col] = { colspan, rowspan, header };
    });
    if (Object.keys(cells).length || row.content?.length !== count) rows[index] = { count: row.content?.length ?? 0, cells };
  });
  return widths.some(Boolean) || Object.keys(heights).length || Object.keys(rows).length || !hasHeader
    ? { widths, heights, ...(Object.keys(rows).length ? { rows } : {}), ...(!hasHeader ? { noHeader: true } : {}) } : null;
}

/** Compact GFM output: source size follows content size, never rows × longest cell. */
export const MarkdownTable = Table.extend({
  markdownTokenizer: {
    ...tokenizer,
    start(src) {
      if (src.startsWith(PREFIX)) return 0;
      const first = src.indexOf('\n'); if (first < 0 || !src.slice(0, first).includes('|')) return -1;
      const second = src.indexOf('\n', first + 1), separator = src.slice(first + 1, second < 0 ? undefined : second);
      return /^[ \t|:]*-[ \t|:-]*$/.test(separator) && separator.includes('|') ? 0 : -1;
    },
    tokenize(src, tokens, helper) {
      if (!src.startsWith(PREFIX)) return tokenizer.tokenize(src, tokens, helper);
      const end = src.indexOf('-->');
      if (end < 0 || end > 1024 * 1024) return undefined;
      let layout: TableLayout;
      try { layout = JSON.parse(src.slice(PREFIX.length, end)); } catch { return undefined; }
      if (!isTableLayout(layout)) return undefined;
      const after = src.slice(end + 3), whitespace = /^\s*/.exec(after)![0];
      const body = after.slice(whitespace.length), blank = body.indexOf('\n\n');
      const parsed = helper.blockTokens(blank < 0 ? body : body.slice(0, blank));
      const table = parsed[0];
      if (table?.type !== 'table' || !table.raw) return undefined;
      return { ...table, raw: src.slice(0, end + 3 + whitespace.length) + table.raw, tableLayout: layout };
    },
  },
  parseMarkdown(token, helpers) {
    const result = Table.config.parseMarkdown!(token, helpers) as JSONContent;
    const layout = token.tableLayout as TableLayout | undefined;
    if (layout?.noHeader) result.content?.shift();
    const occupied: number[] = [];
    if (layout) result.content?.forEach((row, index) => {
      const height = size(layout.heights?.[index]);
      if (height) row.attrs = { ...row.attrs, height };
      const structure = layout.rows?.[index];
      if (structure && Number.isInteger(structure.count) && structure.count >= 0) row.content = row.content?.slice(0, structure.count);
      let column = 0;
      row.content?.forEach((cell, cellIndex) => {
        const original = structure?.cells?.[cellIndex];
        if (original) {
          cell.type = original.header ? 'tableHeader' : 'tableCell';
          cell.attrs = { ...cell.attrs, colspan: size(original.colspan) || 1, rowspan: size(original.rowspan) || 1 };
        }
        while ((occupied[column] ?? 0) > index) column++;
        const count = cell.attrs?.colspan ?? 1;
        const widths = Array.from({ length: count }, (_, offset) => size(layout.widths?.[column + offset]));
        if (widths.some(Boolean)) cell.attrs = { ...cell.attrs, colwidth: widths };
        const rowspan = cell.attrs?.rowspan ?? 1;
        if (rowspan > 1) for (let offset = 0; offset < count; offset++) occupied[column + offset] = index + rowspan;
        column += count;
      });
    });
    return result;
  },
  renderMarkdown(node, helpers) {
    const rows = node.content ?? [];
    const columns = rows.reduce((max, row) => Math.max(max, row.content?.length ?? 0), 0);
    if (!columns) return '';
    const alignment: Array<string | undefined> = Array(columns);
    const rendered = rows.map(row => (row.content ?? []).map((cell, index) => {
      alignment[index] ??= cell.attrs?.align ?? cell.attrs?.textAlign;
      const text = helpers.renderChildren(cell.content ?? []);
      return text.trim().replace(/[ \t]*\r?\n[ \t]*/g, '<br>');
    }));
    const line = (cells: string[]) => `| ${Array.from({ length: columns }, (_, i) => cells[i] ?? '').join(' | ')} |`;
    const hasHeader = rows[0].content?.some(cell => cell.type === 'tableHeader');
    const header = hasHeader ? rendered.shift()! : [];
    const separator = alignment.map(align => align === 'center' ? ':---:' : align === 'right' ? '---:' : align === 'left' ? ':---' : '---');
    const layout = dimensions(node);
    return '\n' + (layout ? PREFIX + JSON.stringify(layout) + ' -->\n' : '') + [line(header), line(separator), ...rendered.map(line)].join('\n') + '\n';
  },
});
