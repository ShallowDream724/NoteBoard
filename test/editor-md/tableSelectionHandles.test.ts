import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';
import { buildDocumentExtensions } from '@/features/editor-md/documentExtensions';
import { TableSelectionHandles } from '@/features/editor-md/tableSelectionHandles';

const editors: Editor[] = [];
const content = (merged = false, single = false): JSONContent => ({ type: 'doc', content: [{ type: 'table', content: single ? [
  { type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }] },
] : merged ? [
  { type: 'tableRow', content: [
    { type: 'tableCell', attrs: { rowspan: 2 }, content: [{ type: 'paragraph' }] },
    { type: 'tableCell', content: [{ type: 'paragraph' }] },
  ] },
  { type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }] },
] : [
  { type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }, { type: 'tableCell', content: [{ type: 'paragraph' }] }] },
  { type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }, { type: 'tableCell', content: [{ type: 'paragraph' }] }] },
] }] });

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON() { return {}; } } as DOMRect;
}
function create(merged = false, single = false) {
  const editor = new Editor({ extensions: [...buildDocumentExtensions(), TableSelectionHandles], content: content(merged, single) });
  editors.push(editor); document.body.append(editor.view.dom);
  const table = editor.view.dom.querySelector('table')!, cells = table.querySelectorAll<HTMLTableCellElement>('td,th');
  const geometry = (element: Element, box: DOMRect) => vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(box);
  geometry(document.documentElement, rect(0, 0, 800, 600));
  geometry(table, rect(200, 100, 200, 100));
  geometry(table.parentElement!, rect(200, 100, 200, 100));
  Array.from(table.rows).forEach((row, index) => geometry(row, rect(200, 100 + (single ? 100 : 50) * index, 200, single ? 100 : 50)));
  Array.from(table.querySelector(':scope > colgroup')!.children).forEach((column, index) => geometry(column, rect(200 + 100 * index, 100, single ? 200 : 100, 100)));
  const hover = async (cell: Element, x: number, y: number) => {
    cell.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y }));
    await new Promise(requestAnimationFrame);
    return [...document.querySelectorAll<HTMLButtonElement>('.nb-table-select-handle:not([hidden])')];
  };
  return { editor, table, cells, hover };
}
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('table selection handles', () => {
  it('moves row and column entry points to the nearer visible sides, then selects from either side', async () => {
    const { editor, cells, hover } = create();
    let [row, column] = await hover(cells[0], 220, 120);
    expect([row.style.left, column.style.top]).toEqual(['178px', '78px']);
    expect(row.classList.contains('nb-table-select-row-right')).toBe(false);
    expect(column.classList.contains('nb-table-select-column-bottom')).toBe(false);
    row.click(); expect(editor.state.selection).toBeInstanceOf(CellSelection);
    expect((editor.state.selection as CellSelection).isRowSelection()).toBe(true);
    column.click(); expect((editor.state.selection as CellSelection).isColSelection()).toBe(true);

    [row, column] = await hover(cells[3], 380, 180);
    expect([row.style.left, column.style.top]).toEqual(['400px', '200px']);
    expect(row.classList.contains('nb-table-select-row-right')).toBe(true);
    expect(column.classList.contains('nb-table-select-column-bottom')).toBe(true);
    row.click(); expect((editor.state.selection as CellSelection).isRowSelection()).toBe(true);
    column.click(); expect((editor.state.selection as CellSelection).isColSelection()).toBe(true);
  });

  it('uses the pointer position inside a cell merged across rows', async () => {
    const { cells, hover } = create(true);
    const [row, column] = await hover(cells[0], 220, 175);
    expect(row.dataset.index).toBe('1');
    expect(column.dataset.index).toBe('0');
  });

  it('switches both rails while the pointer stays in one cell', async () => {
    const { cells, hover } = create(false, true);
    const [row, column] = await hover(cells[0], 220, 120);
    expect([row.style.left, column.style.top]).toEqual(['178px', '78px']);
    await hover(cells[0], 380, 180);
    expect([row.style.left, column.style.top]).toEqual(['400px', '200px']);
  });

  it('keeps the right and bottom rails usable when the scroll viewport clips the table', async () => {
    const { cells, hover } = create();
    vi.mocked(document.documentElement.getBoundingClientRect).mockReturnValue(rect(200, 100, 130, 90));
    const [row, column] = await hover(cells[3], 320, 185);
    expect([row.style.left, column.style.top]).toEqual(['308px', '168px']);
    expect([row.dataset.index, column.dataset.index]).toEqual(['1', '1']);
  });
});
