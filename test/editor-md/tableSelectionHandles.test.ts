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
  const scroll = document.createElement('div'); scroll.dataset.editorScroll = 'true';
  const host = document.createElement('div'); scroll.append(host); document.body.append(scroll);
  const editor = new Editor({ element: host, extensions: [...buildDocumentExtensions(), TableSelectionHandles], content: content(merged, single) });
  editors.push(editor);
  const table = editor.view.dom.querySelector('table')!, cells = table.querySelectorAll<HTMLTableCellElement>('td,th');
  const geometry = (element: Element, box: DOMRect) => vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(box);
  geometry(scroll, rect(0, 0, 800, 600));
  geometry(table, rect(200, 100, 200, 100));
  geometry(table.parentElement!, rect(200, 100, 200, 100));
  Array.from(table.rows).forEach((row, index) => geometry(row, rect(200, 100 + (single ? 100 : 50) * index, 200, single ? 100 : 50)));
  Array.from(table.querySelector(':scope > colgroup')!.children).forEach((column, index) => geometry(column, rect(200 + 100 * index, 100, single ? 200 : 100, 100)));
  const hover = async (cell: Element, x: number, y: number) => {
    cell.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y }));
    await new Promise(requestAnimationFrame);
    return [...document.querySelectorAll<HTMLButtonElement>('.nb-table-select-handle:not([hidden])')];
  };
  return { editor, table, cells, scroll, hover, geometry };
}
function handleBox(handle: HTMLButtonElement) {
  return rect(Number.parseFloat(handle.style.left), Number.parseFloat(handle.style.top), Number.parseFloat(handle.style.width), Number.parseFloat(handle.style.height));
}
function expectOutsideText(handle: HTMLButtonElement, text: DOMRect) {
  const bounds = handleBox(handle);
  expect(bounds.right <= text.left || bounds.left >= text.right || bounds.bottom <= text.top || bounds.top >= text.bottom).toBe(true);
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
    expect([row.style.left, column.style.top]).toEqual(['400px', '190px']);
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
    expect([row.style.left, column.style.top]).toEqual(['400px', '190px']);
  });

  it('tracks the pointer immediately across the gap between a cell and its rail', async () => {
    const { table, cells, hover } = create(false, true);
    const [row, column] = await hover(cells[0], 220, 120);
    expect([row.style.left, column.style.top]).toEqual(['178px', '78px']);
    table.parentElement!.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 380, clientY: 180 }));
    await new Promise(requestAnimationFrame);
    expect([row.style.left, column.style.top]).toEqual(['400px', '190px']);
    expect(row.parentElement?.hidden).toBe(false);
  });

  it('keeps the right and bottom rails usable when the scroll viewport clips the table', async () => {
    const { cells, scroll, hover } = create();
    vi.mocked(scroll.getBoundingClientRect).mockReturnValue(rect(200, 100, 130, 90));
    const [row, column] = await hover(cells[3], 320, 185);
    expect([row.style.left, row.style.width, column.style.top]).toEqual(['324px', '6px', '180px']);
    expect([row.dataset.index, column.dataset.index]).toEqual(['1', '1']);
    expect(row.classList.contains('nb-table-select-row-compact')).toBe(true);
  });
  it('uses the document gutter when a local table viewport clips the top row and right columns', async () => {
    const { table, cells, hover, geometry } = create();
    const local = table.parentElement!;
    local.style.overflowX = 'auto'; local.style.overflowY = 'auto';
    vi.mocked(local.getBoundingClientRect).mockReturnValue(rect(200, 150, 130, 40));
    const text = rect(208, 158, 84, 10); geometry(cells[2].querySelector('p')!, text);
    const [row, column] = await hover(cells[2], 220, 160);
    expect(handleBox(row)).toMatchObject({ left: 178, right: 200, top: 150, bottom: 190 });
    expect(handleBox(column)).toMatchObject({ left: 200, right: 300, top: 128, bottom: 150 });
    expect([row.dataset.index, column.dataset.index]).toEqual(['1', '0']);
    expectOutsideText(row, text); expectOutsideText(column, text);
  });
  it('uses compact border strips when the clipped table has no outer gutter, preserving the text area', async () => {
    const { editor, table, cells, scroll, hover, geometry } = create();
    const local = table.parentElement!;
    local.style.overflowX = 'auto'; local.style.overflowY = 'auto';
    const clipped = rect(200, 130, 130, 60);
    vi.mocked(local.getBoundingClientRect).mockReturnValue(clipped);
    vi.mocked(scroll.getBoundingClientRect).mockReturnValue(clipped);
    const text = rect(208, 138, 84, 10); geometry(cells[0].querySelector('p')!, text);
    const [row, column] = await hover(cells[0], 220, 140);
    expect(handleBox(row)).toMatchObject({ left: 200, right: 206, top: 130, bottom: 150 });
    expect(handleBox(column)).toMatchObject({ left: 200, right: 300, top: 130, bottom: 136 });
    expect(row.classList.contains('nb-table-select-row-compact')).toBe(true);
    expect(column.classList.contains('nb-table-select-column-compact')).toBe(true);
    expectOutsideText(row, text); expectOutsideText(column, text);
    row.click(); expect((editor.state.selection as CellSelection).isRowSelection()).toBe(true);
    column.click(); expect((editor.state.selection as CellSelection).isColSelection()).toBe(true);
  });
  it('keeps the entire bottom hit strip inside the grid, before empty or multi-line captions', async () => {
    for (const captionHeight of [30, 120]) {
      const { table, cells, hover } = create();
      vi.mocked(table.getBoundingClientRect).mockReturnValue(rect(200, 100, 200, 100 + captionHeight));
      const [, column] = await hover(cells[3], 380, 180);
      expect(Number.parseFloat(column.style.top) + Number.parseFloat(column.style.height)).toBe(200);
      const caption = document.createElement('caption'); caption.className = 'nb-table-accessories'; table.append(caption);
      caption.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 300, clientY: 215 }));
      expect(column.parentElement?.hidden).toBe(true);
      editors.pop()!.destroy();
    }
  });
});
