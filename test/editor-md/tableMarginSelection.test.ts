import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { buildDocumentExtensions } from '@/features/editor-md/documentExtensions';
import { TableMarginSelection } from '@/features/editor-md/tableMarginSelection';

const editors: Editor[] = [];
const cell = (attrs: Record<string, number> = {}): JSONContent => ({ type: 'tableCell', attrs, content: [{ type: 'paragraph' }] });
const row = (...cells: JSONContent[]): JSONContent => ({ type: 'tableRow', content: cells });
function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON() { return {}; } } as DOMRect;
}
function pointer(target: EventTarget, name: string, x: number, y: number, extra: Partial<PointerEvent> = {}) {
  const event = new MouseEvent(name, { bubbles: true, cancelable: true, clientX: x, clientY: y, buttons: name === 'pointerup' ? 0 : 1 });
  Object.defineProperties(event, Object.fromEntries(Object.entries({ pointerId: 1, pointerType: 'mouse', isPrimary: true, ...extra })
    .map(([key, value]) => [key, { value }])));
  target.dispatchEvent(event); return event;
}
function create(rows = [row(cell(), cell()), row(cell(), cell()), row(cell(), cell()), row(cell(), cell())]) {
  const scroll = document.createElement('div'); scroll.dataset.editorScroll = ''; document.body.append(scroll);
  const editor = new Editor({ element: scroll, extensions: [...buildDocumentExtensions(), TableMarginSelection], content: {
    type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Before' }] }, { type: 'table', content: rows }, { type: 'paragraph' }],
  } });
  editors.push(editor);
  const table = editor.view.dom.querySelector('table')!, wrapper = table.parentElement!;
  vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: editor.view.posAtDOM(table, 0), inside: -1 });
  const geometry = (element: Element, box: DOMRect) => vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(box);
  geometry(scroll, rect(0, 0, 800, 600));
  geometry(editor.view.dom, rect(100, 0, 500, 600));
  geometry(editor.view.dom.firstElementChild!, rect(100, 40, 500, 40));
  geometry(wrapper, rect(100, 100, 500, rows.length * 40 + 50));
  geometry(editor.view.dom.lastElementChild!, rect(100, 166 + rows.length * 40, 500, 40));
  geometry(table, rect(250, 100, 200, rows.length * 40 + 50));
  const rowBounds = Array.from(table.rows).map((item, index) => geometry(item, rect(250, 100 + index * 40, 200, 40)));
  return { editor, table, wrapper, rowBounds, scroll };
}
function selected(editor: Editor) {
  const selection = editor.state.selection as CellSelection;
  expect(selection).toBeInstanceOf(CellSelection);
  expect(selection.isRowSelection()).toBe(true);
  const map = TableMap.get(selection.$anchorCell.node(-1)), start = selection.$anchorCell.start(-1);
  const bounds = map.rectBetween(selection.$anchorCell.pos - start, selection.$headCell.pos - start);
  return [bounds.top, bounds.bottom];
}
function selectedColumns(editor: Editor) {
  const selection = editor.state.selection as CellSelection;
  expect(selection).toBeInstanceOf(CellSelection);
  expect(selection.isColSelection()).toBe(true);
  const map = TableMap.get(selection.$anchorCell.node(-1)), start = selection.$anchorCell.start(-1);
  const bounds = map.rectBetween(selection.$anchorCell.pos - start, selection.$headCell.pos - start);
  return [bounds.left, bounds.right];
}
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('table margin row selection', () => {
  it('selects the same logical row from either margin without changing the document', () => {
    const { editor, wrapper } = create(), original = editor.state.doc;
    for (const x of [150, 550]) {
      expect(pointer(wrapper, 'pointerdown', x, 155).defaultPrevented).toBe(true);
      expect(selected(editor)).toEqual([1, 2]);
      pointer(document, 'pointerup', x, 155);
    }
    expect(editor.state.doc).toBe(original);
  });

  it('extends and shrinks continuous row selections in both directions', async () => {
    const { editor, wrapper } = create(), original = editor.state.doc;
    pointer(wrapper, 'pointerdown', 150, 155);
    pointer(document, 'pointermove', 150, 245); await new Promise(requestAnimationFrame);
    expect(selected(editor)).toEqual([1, 4]);
    pointer(document, 'pointermove', 550, 195); await new Promise(requestAnimationFrame);
    expect(selected(editor)).toEqual([1, 3]);
    pointer(document, 'pointerup', 550, 110);
    expect(selected(editor)).toEqual([0, 2]);
    expect(editor.state.doc).toBe(original);
  });

  it('closes selected rows over overlapping rowspans in different columns', () => {
    const { editor, wrapper } = create([
      row(cell({ rowspan: 2 }), cell()), row(cell({ rowspan: 2 })), row(cell()), row(cell(), cell()),
    ]);
    pointer(wrapper, 'pointerdown', 550, 110);
    expect(selected(editor)).toEqual([0, 3]);
    pointer(document, 'pointerup', 550, 110);
  });

  it('selects columns from editor-targeted space above the table and below its caption, including horizontal drag', async () => {
    const { editor, wrapper, table } = create(), original = editor.state.doc;
    wrapper.style.margin = '16px 0';
    const before = editor.view.dom.querySelector('p')!, after = editor.view.dom.lastElementChild!;
    vi.spyOn(before, 'getBoundingClientRect').mockReturnValue(rect(100, 40, 500, 40));
    vi.spyOn(after, 'getBoundingClientRect').mockReturnValue(rect(100, 330, 500, 40));
    for (const [index, cell] of Array.from(table.rows[0].cells).entries()) {
      vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue(rect(250 + index * 100, 100, 100, 40));
    }
    expect(pointer(editor.view.dom, 'pointerdown', 300, 92).defaultPrevented).toBe(true);
    expect(selectedColumns(editor)).toEqual([0, 1]);
    pointer(document, 'pointerup', 300, 92);
    expect(selectedColumns(editor)).toEqual([0, 1]);
    expect(pointer(editor.view.dom, 'pointerdown', 400, 318).defaultPrevented).toBe(true);
    expect(selectedColumns(editor)).toEqual([1, 2]);
    pointer(document, 'pointermove', 300, 318); await new Promise(requestAnimationFrame);
    expect(selectedColumns(editor)).toEqual([0, 2]);
    pointer(document, 'pointerup', 300, 318);
    expect(selectedColumns(editor)).toEqual([0, 2]);
    expect(editor.state.doc).toBe(original);
  });

  it('closes a column selection over overlapping colspans', () => {
    const { editor, wrapper, table } = create([
      row(cell({ colspan: 2 }), cell()), row(cell(), cell({ colspan: 2 })), row(cell(), cell(), cell()),
    ]);
    wrapper.style.marginTop = '16px';
    vi.spyOn(table.rows[0].cells[0], 'getBoundingClientRect').mockReturnValue(rect(250, 100, 200, 40));
    vi.spyOn(table.rows[0].cells[1], 'getBoundingClientRect').mockReturnValue(rect(450, 100, 100, 40));
    expect(pointer(editor.view.dom, 'pointerdown', 275, 92).defaultPrevented).toBe(true);
    expect(selectedColumns(editor)).toEqual([0, 3]);
    pointer(document, 'pointerup', 275, 92);
  });

  it('does not capture caption, caption editor, body text, or another block’s space', () => {
    const { editor, wrapper, table } = create();
    wrapper.style.margin = '16px 0';
    const caption = document.createElement('caption'); table.append(caption);
    const input = document.createElement('input'); caption.append(input);
    const paragraph = editor.view.dom.lastElementChild!;
    vi.spyOn(paragraph, 'getBoundingClientRect').mockReturnValue(rect(100, 310, 500, 40));
    for (const [target, x, y] of [
      [caption, 300, 280], [input, 300, 280], [paragraph, 300, 320],
      [editor.view.dom, 300, 325], [editor.view.dom, 300, 70],
    ] as const) expect(pointer(target, 'pointerdown', x, y).defaultPrevented).toBe(false);
  });

  it('leaves grid, caption, text, editor padding and touch input alone', () => {
    const { editor, wrapper, table } = create();
    editor.view.dom.style.paddingLeft = '30px';
    const original = editor.state.selection;
    const caption = document.createElement('caption'); table.append(caption);
    const cases: [EventTarget, number, number, Partial<PointerEvent>?][] = [
      [table.rows[0].cells[0], 260, 110], [caption, 300, 280], [wrapper, 150, 280],
      [wrapper, 150, 90], [wrapper, 300, 110], [wrapper, 110, 110], [wrapper, 610, 110],
      [wrapper, 150, 110, { pointerType: 'touch' }], [wrapper, 150, 110, { isPrimary: false }],
    ];
    for (const [target, x, y, extra] of cases) expect(pointer(target, 'pointerdown', x, y, extra).defaultPrevented).toBe(false);
    pointer(editor.view.dom.querySelector('p')!, 'pointerdown', 150, 30);
    pointer(wrapper, 'pointermove', 150, 150);
    expect(editor.state.selection.eq(original)).toBe(true);
    editor.setEditable(false);
    expect(pointer(wrapper, 'pointerdown', 150, 110).defaultPrevented).toBe(false);
  });

  it('does not let another pointer take over and releases the gesture on cancellation or document edits', async () => {
    const { editor, wrapper } = create();
    pointer(wrapper, 'pointerdown', 150, 155);
    pointer(document, 'pointermove', 150, 245, { pointerId: 2 });
    pointer(document, 'pointerup', 150, 245, { pointerId: 2 });
    expect(selected(editor)).toEqual([1, 2]);
    pointer(document, 'pointercancel', 150, 155);
    pointer(document, 'pointermove', 150, 245); await new Promise(requestAnimationFrame);
    expect(selected(editor)).toEqual([1, 2]);
    pointer(wrapper, 'pointerdown', 150, 155);
    editor.view.dispatch(editor.state.tr.insertText('x', 1));
    const selection = editor.state.selection;
    pointer(document, 'pointermove', 150, 245); await new Promise(requestAnimationFrame);
    expect(editor.state.selection.eq(selection)).toBe(true);
  });

  it('binary-searches large row geometry and skips repeated selection transactions', async () => {
    const { editor, wrapper, rowBounds } = create(Array.from({ length: 512 }, () => row(cell())));
    pointer(wrapper, 'pointerdown', 150, 155);
    rowBounds.forEach(spy => spy.mockClear());
    const transactions = vi.fn(); editor.on('transaction', transactions);
    pointer(document, 'pointermove', 150, 455); await new Promise(requestAnimationFrame);
    expect(selected(editor)).toEqual([1, 9]);
    expect(rowBounds.reduce((count, spy) => count + spy.mock.calls.length, 0)).toBeLessThanOrEqual(10);
    pointer(document, 'pointermove', 150, 456); await new Promise(requestAnimationFrame);
    expect(transactions).toHaveBeenCalledTimes(1);
    pointer(document, 'pointerup', 150, 456);
  });

  it('measures only neighboring blocks when editor-targeted space belongs to one of many tables', () => {
    const scroll = document.createElement('div'); scroll.dataset.editorScroll = ''; document.body.append(scroll);
    const editor = new Editor({ element: scroll, extensions: [...buildDocumentExtensions(), TableMarginSelection], content: {
      type: 'doc', content: Array.from({ length: 128 }, () => ({ type: 'table', content: [row(cell(), cell())] })),
    } });
    editors.push(editor);
    vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 800, 600));
    vi.spyOn(editor.view.dom, 'getBoundingClientRect').mockReturnValue(rect(100, 0, 500, 600));
    const wrappers = Array.from(editor.view.dom.children) as HTMLElement[];
    expect(wrappers).toHaveLength(128);
    const targetTable = wrappers[64].querySelector('table')!;
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: editor.view.posAtDOM(targetTable, 0), inside: -1 });
    const bounds = wrappers.map((wrapper, index) => {
      const top = 20 + index * 4, table = wrapper.querySelector('table')!;
      wrapper.style.margin = '2px 0';
      const spy = vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue(rect(100, top, 500, 3));
      vi.spyOn(table, 'getBoundingClientRect').mockReturnValue(rect(250, top, 200, 3));
      vi.spyOn(table.rows[0], 'getBoundingClientRect').mockReturnValue(rect(250, top, 200, 3));
      Array.from(table.rows[0].cells).forEach((item, column) => {
        vi.spyOn(item, 'getBoundingClientRect').mockReturnValue(rect(250 + column * 100, top, 100, 3));
      });
      return spy;
    });
    bounds.forEach(spy => spy.mockClear());
    const y = 20 + 64 * 4 - .5;
    expect(pointer(editor.view.dom, 'pointerdown', 300, y).defaultPrevented).toBe(true);
    expect(selectedColumns(editor)).toEqual([0, 1]);
    expect(bounds.reduce((count, spy) => count + spy.mock.calls.length, 0)).toBeLessThanOrEqual(12);
    pointer(document, 'pointerup', 300, y);
  });

  it('finds the visible table across folded sibling blocks without using their zero rects as bounds', () => {
    const hidden = () => ({ type: 'paragraph', content: [{ type: 'text', text: 'folded' }] });
    const scroll = document.createElement('div'); scroll.dataset.editorScroll = ''; document.body.append(scroll);
    const editor = new Editor({ element: scroll, extensions: [...buildDocumentExtensions(), TableMarginSelection], content: {
      type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'before' }] },
        ...Array.from({ length: 24 }, hidden),
        { type: 'table', content: [row(cell(), cell()), row(cell(), cell())] },
        ...Array.from({ length: 24 }, hidden),
        { type: 'paragraph', content: [{ type: 'text', text: 'after' }] },
      ],
    } });
    editors.push(editor);
    const blocks = Array.from(editor.view.dom.children) as HTMLElement[];
    const before = blocks[0], wrapper = blocks[25], after = blocks[50], table = wrapper.querySelector('table')!;
    for (const block of [...blocks.slice(1, 25), ...blocks.slice(26, 50)]) {
      block.classList.add('nb-heading-fold-hidden');
      vi.spyOn(block, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 0, 0));
    }
    vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 800, 600));
    vi.spyOn(editor.view.dom, 'getBoundingClientRect').mockReturnValue(rect(100, 0, 500, 600));
    vi.spyOn(before, 'getBoundingClientRect').mockReturnValue(rect(100, 40, 500, 40));
    vi.spyOn(after, 'getBoundingClientRect').mockReturnValue(rect(100, 240, 500, 40));
    wrapper.style.margin = '16px 0';
    vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue(rect(100, 100, 500, 110));
    vi.spyOn(table, 'getBoundingClientRect').mockReturnValue(rect(250, 100, 200, 110));
    Array.from(table.rows).forEach((item, index) => vi.spyOn(item, 'getBoundingClientRect').mockReturnValue(rect(250, 100 + index * 40, 200, 40)));
    Array.from(table.rows[0].cells).forEach((item, column) => vi.spyOn(item, 'getBoundingClientRect').mockReturnValue(rect(250 + column * 100, 100, 100, 40)));
    const beforePos = editor.view.posAtDOM(before, 0), afterPos = editor.view.posAtDOM(after, 0);
    vi.spyOn(editor.view, 'posAtCoords').mockImplementation(({ top }) => ({ pos: top < 100 ? beforePos : afterPos, inside: -1 }));
    expect(pointer(editor.view.dom, 'pointerdown', 300, 92).defaultPrevented).toBe(true);
    expect(selectedColumns(editor)).toEqual([0, 1]);
    pointer(document, 'pointerup', 300, 92);
    expect(pointer(editor.view.dom, 'pointerdown', 400, 218).defaultPrevented).toBe(true);
    expect(selectedColumns(editor)).toEqual([1, 2]);
    pointer(document, 'pointerup', 400, 218);
  });

  it('scrolls at a bounded rate and stops when the table edge is visible', async () => {
    const { editor, wrapper, rowBounds, scroll } = create(Array.from({ length: 13 }, () => row(cell())));
    let scrollTop = 0;
    const increments: number[] = [];
    vi.spyOn(scroll, 'scrollTop', 'get').mockImplementation(() => scrollTop);
    vi.spyOn(scroll, 'scrollTop', 'set').mockImplementation(value => { increments.push(value - scrollTop); scrollTop = value; });
    rowBounds.forEach((spy, index) => spy.mockImplementation(() => rect(250, 100 + index * 40 - scrollTop, 200, 40)));
    pointer(wrapper, 'pointerdown', 150, 155);
    pointer(document, 'pointermove', 150, 590);
    await vi.waitFor(() => expect(scrollTop).toBeCloseTo(20, 3), { timeout: 1000 });
    expect(increments.every(delta => delta > 0 && delta <= 880 * .032)).toBe(true);
    expect(selected(editor)).toEqual([1, 13]);
    pointer(document, 'pointerup', 150, 590);
    const count = increments.length;
    await new Promise(requestAnimationFrame);
    expect(increments).toHaveLength(count);
  });
});
