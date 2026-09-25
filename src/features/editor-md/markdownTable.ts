import { Table, TableRow } from '@tiptap/extension-table';
import type { JSONContent, MarkdownToken } from '@tiptap/core';
import { buildLogicalTableGrid, type TableCellPlacement } from './tableGrid';
import { tableFill } from './tableCellPresentation';
import { tableAlignment, tableAlignmentStyle } from './tableAlignment';
import { markdownFigureCaption, normalizeFigureCaption, validateFigureCaption } from './figureCaption';

const PREFIX = '<!-- noteboard-table ';
const tokenizer = Table.config.markdownTokenizer!;
const size = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(10000, Math.round(value)) : 0;
interface TableLayout {
  widths: number[]; heights: Record<string, number>; noHeader?: boolean; grid?: true; rowCount?: number;
  rows?: Record<string, { count: number; cells: Record<string, { colspan: number; rowspan: number; header: boolean; column?: number }> }>;
  blocks?: Record<string, Record<string, { markdown: string; preview: string }>>;
  fills?: Record<string, Record<string, string>>;
}
function isTableLayout(value: unknown): value is TableLayout {
  if (!value || typeof value !== 'object') return false;
  const layout = value as TableLayout;
  const record = (item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item);
  const dimension = (item: unknown): item is number => typeof item === 'number' && Number.isInteger(item) && item >= 0 && item <= 10000;
  if (!Array.isArray(layout.widths) || !layout.widths.length || layout.widths.length > 10000 || !layout.widths.every(dimension)) return false;
  if (!record(layout.heights) || Object.entries(layout.heights).some(([key, height]) => !/^\d+$/.test(key) || !dimension(height))) return false;
  if (layout.noHeader !== undefined && typeof layout.noHeader !== 'boolean') return false;
  if (layout.grid !== undefined && layout.grid !== true) return false;
  if (layout.rowCount !== undefined && (!Number.isSafeInteger(layout.rowCount) || layout.rowCount < 0)) return false;
  if (layout.rows !== undefined) {
    if (!record(layout.rows)) return false;
    for (const [key, row] of Object.entries(layout.rows)) {
      if (!/^\d+$/.test(key) || !record(row) || !dimension(row.count) || !record(row.cells)) return false;
      for (const [column, cell] of Object.entries(row.cells)) {
        if (!/^\d+$/.test(column) || Number(column) >= row.count || !record(cell)
          || !dimension(cell.colspan) || !cell.colspan || cell.colspan > layout.widths.length
          || !dimension(cell.rowspan) || !cell.rowspan || typeof cell.header !== 'boolean'
          || (cell.column !== undefined && (!dimension(cell.column) || cell.column >= layout.widths.length))) return false;
      }
    }
  }
  if (layout.blocks !== undefined) {
    if (!record(layout.blocks)) return false;
    for (const [row, cells] of Object.entries(layout.blocks)) {
      if (!/^\d+$/.test(row) || !record(cells)) return false;
      for (const [column, content] of Object.entries(cells)) {
        if (!/^\d+$/.test(column) || !record(content) || typeof content.markdown !== 'string' || typeof content.preview !== 'string') return false;
      }
    }
  }
  if (layout.fills !== undefined) {
    if (!record(layout.fills)) return false;
    for (const [row, cells] of Object.entries(layout.fills)) {
      if (!/^\d+$/.test(row) || !record(cells)) return false;
      if (Object.entries(cells).some(([column, color]) => !/^\d+$/.test(column) || !tableFill(color))) return false;
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

function dimensions(node: JSONContent, grid: { width: number; rows: TableCellPlacement<JSONContent>[][] }): TableLayout | null {
  const widths: number[] = Array(grid.width).fill(0), heights: Record<number, number> = {};
  const rows: NonNullable<TableLayout['rows']> = {};
  const fills: NonNullable<TableLayout['fills']> = {};
  const hasHeader = node.content?.[0]?.content?.some(cell => cell.type === 'tableHeader');
  node.content?.forEach((row, index) => {
    if (size(row.attrs?.height)) heights[index] = size(row.attrs?.height);
    const cells: NonNullable<TableLayout['rows']>[string]['cells'] = {};
    const placements = grid.rows[index];
    const structured = placements.length !== grid.width || placements.some(({ colspan, rowspan, cell }) => colspan > 1 || rowspan > 1 || (cell.type === 'tableHeader') !== (index === 0 && !!hasHeader));
    placements.forEach(({ cell, cellIndex, column, colspan, rowspan }) => {
      const header = cell.type === 'tableHeader';
      for (let col = 0; col < colspan; col++) widths[column + col] ||= size(cell.attrs?.colwidth?.[col]);
      if (structured) cells[cellIndex] = { colspan, rowspan, header, column };
      const color = tableFill(cell.attrs?.background);
      if (color) (fills[index] ??= {})[cellIndex] = color;
    });
    if (structured) rows[index] = { count: placements.length, cells };
  });
  return widths.some(Boolean) || Object.keys(heights).length || Object.keys(rows).length || Object.keys(fills).length || !hasHeader
    ? { widths, heights, grid: true, rowCount: node.content?.length ?? 0, ...(Object.keys(rows).length ? { rows } : {}), ...(Object.keys(fills).length ? { fills } : {}), ...(!hasHeader ? { noHeader: true } : {}) } : null;
}

/** Covered GFM slots are empty placeholders, never a second source of content.
 * If source edits populate them or change the grid shape, use ordinary GFM and
 * drop old span metadata instead of discarding the user's new cells. */
function matchesVisibleGrid(layout: TableLayout, rows: Array<Array<{ text?: string }> | undefined>): boolean {
  if (layout.noHeader && rows[0]?.some(cell => cell.text?.trim())) return false;
  const body = layout.noHeader ? rows.slice(1) : rows;
  if (layout.rowCount !== undefined && body.length !== layout.rowCount) return false;
  if (body.some(row => row?.length !== layout.widths.length)) return false;
  for (const [index, structure] of Object.entries(layout.rows ?? {})) {
    const row = body[Number(index)];
    if (!row) return false;
    const origins = new Set<number>();
    for (let i = 0; i < structure.count; i++) origins.add(layout.grid ? structure.cells[i]?.column ?? i : i);
    if (row.some((cell, column) => !origins.has(column) && !!cell.text?.trim())) return false;
  }
  return true;
}

/** GFM splits only pipes preceded by an even number of backslashes. */
function escapeCellPipes(source: string): string {
  let slashes = 0;
  const fragments: string[] = [];
  for (const character of source) {
    if (character === '|' && slashes % 2 === 0) fragments.push('\\');
    fragments.push(character);
    slashes = character === '\\' ? slashes + 1 : 0;
  }
  return fragments.join('');
}

const commentJSON = (value: unknown) => JSON.stringify(value).replace(/[<>]/g, character => character === '<' ? '\\u003c' : '\\u003e');

/** Compact GFM output: source size follows content size, never rows × longest cell. */
export const MarkdownTable = Table.extend({
  addAttributes() {
    return { ...this.parent?.(), tableAlign: {
      default: null,
      validate: value => { if (value !== null && !tableAlignment(value)) throw new RangeError('Invalid table alignment'); },
      parseHTML: element => tableAlignment(element.getAttribute('data-table-align')),
      renderHTML: attrs => tableAlignment(attrs.tableAlign) ? { 'data-table-align': attrs.tableAlign } : {},
    }, caption: { default: null, validate: validateFigureCaption,
      parseHTML: element => normalizeFigureCaption(element.querySelector(':scope > caption')?.textContent),
      renderHTML: () => ({}),
    } };
  },
  renderHTML(props) {
    // Let the upstream renderer derive widths from the cells before adding the
    // position. A style attribute on tableAlign would suppress those widths.
    const output = this.parent!(props), alignment = tableAlignmentStyle(props.node.attrs.tableAlign);
    if (Array.isArray(output)) {
      const table = this.options.renderWrapper ? output[2] : output;
      if (Array.isArray(table)) {
        const attrs = table[1] as Record<string, unknown>;
        if (alignment) attrs.style = [attrs.style, alignment].filter(Boolean).join('; ');
        const caption = normalizeFigureCaption(props.node.attrs.caption);
        if (caption) table.splice(2, 0, ['caption', { style: 'caption-side: bottom; white-space: pre-wrap' }, caption]);
      }
    }
    return output;
  },
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
      if (end < 0) return undefined;
      let layout: TableLayout;
      try { layout = JSON.parse(src.slice(PREFIX.length, end)); } catch { return undefined; }
      if (!isTableLayout(layout)) return undefined;
      const after = src.slice(end + 3), whitespace = /^\s*/.exec(after)![0];
      const body = after.slice(whitespace.length), blank = body.indexOf('\n\n');
      const parsed = helper.blockTokens(blank < 0 ? body : body.slice(0, blank));
      const table = parsed[0];
      if (table?.type !== 'table' || !table.raw) return undefined;
      const blocks: Record<string, Record<string, MarkdownToken[]>> = {};
      const tableRows = [table.header, ...(Array.isArray(table.rows) ? table.rows : [])] as Array<Array<{ text?: string }> | undefined>;
      if (!matchesVisibleGrid(layout, tableRows)) {
        return { ...table, raw: src.slice(0, end + 3 + whitespace.length) + table.raw };
      }
      for (const [row, cells] of Object.entries(layout.blocks ?? {})) {
        const sourceCells = tableRows[Number(row) + (layout.noHeader ? 1 : 0)];
        for (const [cell, content] of Object.entries(cells)) {
          const column = layout.grid ? layout.rows?.[row]?.cells?.[cell]?.column ?? Number(cell) : Number(cell);
          // The visible cell is authoritative after an external source edit.
          if (sourceCells?.[column]?.text === content.preview) {
            (blocks[row] ??= {})[cell] = helper.blockTokens(content.markdown);
          }
        }
      }
      return { ...table, raw: src.slice(0, end + 3 + whitespace.length) + table.raw, tableLayout: layout, tableBlocks: blocks };
    },
  },
  parseMarkdown(token, helpers) {
    const result = Table.config.parseMarkdown!(token, helpers) as JSONContent;
    const layout = token.tableLayout as TableLayout | undefined;
    const blocks = token.tableBlocks as Record<string, Record<string, MarkdownToken[]>> | undefined;
    if (layout?.noHeader) result.content?.shift();
    const occupied: number[] = [];
    if (layout) result.content?.forEach((row, index) => {
      const height = size(layout.heights?.[index]);
      if (height) row.attrs = { ...row.attrs, height };
      const structure = layout.rows?.[index];
      if (structure && Number.isInteger(structure.count) && structure.count >= 0) {
        row.content = layout.grid
          ? Array.from({ length: structure.count }, (_, i) => row.content?.[structure.cells[i]?.column ?? i]).filter((cell): cell is JSONContent => !!cell)
          : row.content?.slice(0, structure.count);
      }
      let column = 0;
      row.content?.forEach((cell, cellIndex) => {
        const original = structure?.cells?.[cellIndex];
        const background = tableFill(layout.fills?.[index]?.[cellIndex]);
        if (background) cell.attrs = { ...cell.attrs, background };
        if (original) {
          cell.type = original.header ? 'tableHeader' : 'tableCell';
          cell.attrs = { ...cell.attrs, colspan: size(original.colspan) || 1, rowspan: size(original.rowspan) || 1 };
        }
        const blockTokens = blocks?.[index]?.[cellIndex];
        if (blockTokens) {
          const content = (helpers.parseBlockChildren ?? helpers.parseChildren)(blockTokens);
          if (content.length) cell.content = content;
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
    const grid = buildLogicalTableGrid(rows.map(row => row.content ?? []), cell => cell.attrs ?? {});
    const columns = grid.width;
    if (!columns) return '';
    if (columns > 10000) throw new RangeError('Table exceeds the supported 10000 logical columns');
    const alignment: Array<string | undefined> = Array(columns).fill(undefined);
    const blocks: NonNullable<TableLayout['blocks']> = {};
    const rendered = grid.rows.map((placements, row) => {
      const cells: string[] = [];
      for (const { cell, cellIndex, column } of placements) {
        alignment[column] ??= cell.attrs?.align ?? cell.attrs?.textAlign;
        const markdown = helpers.renderChildren(cell.content ?? [], '\n\n');
        const text = escapeCellPipes(markdown.trim().replace(/[ \t]*\r?\n[ \t]*/g, '<br>'));
        cells[column] = text;
        // GFM cannot represent multiple blocks, block nodes, or opaque odd-backslash
        // pipes. Preserve their grammar separately, guarded by the visible preview.
        if (cell.content?.length !== 1 || cell.content[0]?.type !== 'paragraph' || /(^|[^\\])(?:\\\\)*\\\|/.test(markdown)) {
          (blocks[row] ??= {})[cellIndex] = { markdown, preview: text.replace(/\\\|/g, '|') };
        }
      }
      return cells;
    });
    const line = (cells: string[]) => `| ${Array.from({ length: columns }, (_, i) => cells[i] ?? '').join(' | ')} |`;
    const hasHeader = rows[0].content?.some(cell => cell.type === 'tableHeader');
    const header = hasHeader ? rendered.shift()! : [];
    const separator = alignment.map(align => align === 'center' ? ':---:' : align === 'right' ? '---:' : align === 'left' ? ':---' : '---');
    let layout = dimensions(node, grid);
    if (Object.keys(blocks).length) layout = { ...(layout ?? { widths: Array(columns).fill(0), heights: {}, grid: true, rowCount: rows.length }), blocks };
    const caption = markdownFigureCaption(node.attrs?.caption);
    return '\n' + (layout ? PREFIX + commentJSON(layout) + ' -->\n' : '') + [line(header), line(separator), ...rendered.map(line)].join('\n') + '\n' + (caption ? '\n' + caption + '\n' : '');
  },
});
