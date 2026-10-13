import { afterEach, expect, it, vi } from 'vitest';
import { createLayoutSession } from '../../src/features/export/layout';
import { DEFAULT_PDF } from '../../src/features/export/model';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

function measure(element: HTMLElement, width: () => number) {
  return vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, width(), 20));
}

function fixture(html: string) {
  const root = document.createElement('div'); root.innerHTML = html; document.body.append(root);
  measure(root, () => 703);
  return root;
}

function scaledBox(element: HTMLElement, width: number, ancestorScale = () => 1) {
  Object.defineProperties(element, {
    offsetWidth: { configurable: true, get: () => width },
    clientWidth: { configurable: true, get: () => width },
    scrollWidth: { configurable: true, get: () => width },
  });
  measure(element, () => width * (parseFloat(element.style.zoom) || 1) * ancestorScale());
}

it('validates the visible width after explicit fit and restores original overflow', async () => {
  const root = fixture('<table data-export-item="table-1" style="width:1400px"><tbody><tr><td>A</td><td>B</td></tr></tbody></table>');
  const table = root.querySelector('table')!;
  scaledBox(table, 1400);
  Array.from(table.rows[0].cells).forEach(cell => scaledBox(cell, 700, () => parseFloat(table.style.zoom) || 1));
  const session = createLayoutSession(root);
  const fitted = await session.update({ ...DEFAULT_PDF, items: { 'table-1': 'fit' } });
  expect(parseFloat(table.style.zoom)).toBeLessThan(1);
  expect(fitted.issues).toEqual([]);
  const original = await session.update({ ...DEFAULT_PDF, items: { 'table-1': 'original' } });
  expect(original.issues.some(issue => issue.id === 'table-1' && issue.blocking)).toBe(true);
});

it('accepts an automatic table kept in one scaled band', async () => {
  const root = fixture('<table data-export-item="table-1"><tbody><tr><td>A</td><td>B</td><td>C</td></tr></tbody></table>');
  const table = root.querySelector('table')!;
  scaledBox(table, 720);
  Array.from(table.rows[0].cells).forEach(cell => scaledBox(cell, 240, () => parseFloat(table.style.zoom) || 1));
  const report = await createLayoutSession(root).update(DEFAULT_PDF);
  expect(parseFloat(table.style.zoom)).toBeLessThan(1);
  expect(root.querySelectorAll('table')).toHaveLength(1);
  expect(report.issues).toEqual([]);
});

it('compares nested fitted tables with their scaled cell and still detects nested overflow', async () => {
  const root = fixture('<table data-export-item="parent" style="width:1400px"><tbody><tr><td>A</td><td style="padding:10px"><table data-export-item="child" style="width:1200px"><tbody><tr><td>B</td><td>C</td></tr></tbody></table></td></tr></tbody></table>');
  const parent = root.querySelector('table')!, child = parent.querySelector('table')!;
  const parentScale = () => parseFloat(parent.style.zoom) || 1;
  scaledBox(parent, 1400);
  Array.from(parent.rows[0].cells).forEach(cell => scaledBox(cell, 700, parentScale));
  scaledBox(child, 1200, parentScale);
  Array.from(child.rows[0].cells).forEach(cell => scaledBox(cell, 600, () => parentScale() * (parseFloat(child.style.zoom) || 1)));
  const session = createLayoutSession(root);
  expect((await session.update({ ...DEFAULT_PDF, items: { parent: 'fit', child: 'fit' } })).issues).toEqual([]);
  expect(parseFloat(parent.style.zoom)).toBeLessThan(1);
  expect(parseFloat(child.style.zoom)).toBeLessThan(1);
  const overflow = await session.update({ ...DEFAULT_PDF, items: { parent: 'fit', child: 'original' } });
  expect(overflow.issues.some(issue => issue.id === 'child' && issue.blocking)).toBe(true);
});

it('single-formula changes only recheck their containing prose and preserve unrelated overflow', async () => {
  const root = fixture('<blockquote><p><span class="export-math" data-export-item="formula-1"><span class="katex-html">x</span></span></p></blockquote>' + '<p>unrelated</p>'.repeat(1000));
  const containing = root.querySelector('p')!, quote = root.querySelector('blockquote')!;
  let width = 750;
  const affectedRead = measure(containing, () => width), quoteRead = measure(quote, () => width);
  const unrelated = Array.from(root.querySelectorAll('p')).slice(1);
  let otherWidth = 750;
  const otherReads = unrelated.map((element, index) => measure(element, () => index === unrelated.length - 1 ? otherWidth : 500));
  const session = createLayoutSession(root);
  expect((await session.update(DEFAULT_PDF)).issues.some(issue => !issue.id && issue.blocking)).toBe(true);
  affectedRead.mockClear(); quoteRead.mockClear(); otherReads.forEach(read => read.mockClear());
  const scan = vi.spyOn(root, 'querySelectorAll');
  width = 500;
  const local = await session.update({ ...DEFAULT_PDF, items: { 'formula-1': 'fit' } });
  expect(affectedRead).toHaveBeenCalledTimes(1); expect(quoteRead).toHaveBeenCalledTimes(2); // overflow + container pagination
  expect(otherReads.every(read => read.mock.calls.length === 0)).toBe(true);
  expect(scan).not.toHaveBeenCalled();
  expect(local.issues.some(issue => !issue.id && issue.blocking)).toBe(true);
  otherWidth = 500;
  const global = await session.update({ ...DEFAULT_PDF, fontPt: 11, items: { 'formula-1': 'fit' } });
  expect(global.issues.some(issue => !issue.id && issue.blocking)).toBe(false);
});

it('clears a repaired formula ancestor overflow without measuring the rest of the document', async () => {
  const root = fixture('<p><span class="export-math" data-export-item="formula-1"><span class="katex-html">x</span></span></p>');
  let width = 750;
  measure(root.querySelector('p')!, () => width);
  const session = createLayoutSession(root);
  expect((await session.update(DEFAULT_PDF)).issues).toHaveLength(1);
  width = 500;
  expect((await session.update({ ...DEFAULT_PDF, items: { 'formula-1': 'fit' } })).issues).toHaveLength(0);
});

it('does not serialize oversized tables when one scaled band suffices or merged cells prevent splitting', async () => {
  const root = fixture('<table data-export-item="table-1"><tbody><tr><td>A</td><td>B</td><td>C</td></tr></tbody></table><table data-export-item="table-2"><tbody><tr><td colspan="2">D</td><td>E</td><td>F</td></tr></tbody></table>');
  const tables = Array.from(root.querySelectorAll('table'));
  tables.forEach((table, index) => {
    measure(table, () => index ? 900 : 720);
    Array.from(table.rows[0].cells).forEach(cell => measure(cell, () => index ? 300 : 240));
  });
  const snapshots = tables.map(table => vi.spyOn(table, 'outerHTML', 'get'));
  await createLayoutSession(root).update({ ...DEFAULT_PDF, items: { 'table-2': 'columns' } });
  expect(tables[0].style.zoom).not.toBe('');
  expect(tables[1].classList.contains('table-wrap')).toBe(true);
  expect(snapshots.every(snapshot => snapshot.mock.calls.length === 0)).toBe(true);
});

it('restores the complete table after a successful column split', async () => {
  const root = fixture('<table data-export-item="table-1"><thead><tr><th>Key</th><th>A</th><th>B</th></tr></thead><tbody><tr><td>row</td><td>1</td><td>2</td></tr></tbody></table>');
  const table = root.querySelector('table')!;
  measure(table, () => 900);
  Array.from(table.rows[0].cells).forEach(cell => measure(cell, () => 300));
  const session = createLayoutSession(root);
  await session.update({ ...DEFAULT_PDF, items: { 'table-1': 'columns' } });
  expect(root.querySelectorAll('table')).toHaveLength(2);
  expect(Array.from(root.querySelectorAll('thead')).map(head => head.textContent?.replaceAll('\u00a0', ''))).toEqual(['KeyA', 'KeyB']);
  await session.update({ ...DEFAULT_PDF, items: { 'table-1': 'wrap' } });
  expect(root.querySelectorAll('table')).toHaveLength(1);
  expect(root.querySelector('thead')?.textContent?.replaceAll('\u00a0', '')).toBe('KeyAB');
  expect(root.querySelector('tbody')?.textContent?.replaceAll('\u00a0', '')).toBe('row12');
});

it('retains explicit column widths while formulas reflow inside the fixed table', async () => {
  const root = fixture('<table data-export-item="table-1" style="width:465px"><colgroup><col style="width:85px"><col style="width:300px"><col style="width:80px"></colgroup><tbody><tr><td>Label</td><td>Formula</td><td>Source</td></tr></tbody></table>');
  const table = root.querySelector('table')!;
  measure(table, () => 465);
  Array.from(table.rows[0].cells).forEach((cell, index) => measure(cell, () => [85, 300, 80][index]));
  const report = await createLayoutSession(root).update(DEFAULT_PDF);
  expect(table.classList.contains('table-wrap')).toBe(true);
  expect(Array.from(table.querySelectorAll('col'), column => column.style.width)).toEqual(['85px', '300px', '80px']);
  expect(table.style.width).toBe('465px');
  expect(table.querySelector('colgroup[data-export-columns]')).toBeNull();
  expect(report.issues).toEqual([]);
});

it('automatic printing reclaims unused manual column width and original mode restores it', async () => {
  const root = fixture('<table data-export-item="table-1" style="width:1600px"><colgroup><col style="width:1200px"><col style="width:400px"></colgroup><tbody><tr><td>ID</td><td>Readable description</td></tr></tbody></table>');
  const table = root.querySelector('table')!, originalColumns = table.querySelector('colgroup')!.outerHTML;
  measure(table, () => parseFloat(table.style.width));
  vi.spyOn(HTMLTableCellElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLTableCellElement) {
    const widths = this.closest('.export-table-measure') ? [38, 210] : [1200, 400];
    return new DOMRect(0, 0, widths[this.cellIndex], 20);
  });
  const session = createLayoutSession(root);
  const automatic = await session.update(DEFAULT_PDF);
  expect(automatic.issues).toEqual([]);
  expect(automatic.adjustable).toContain('table-1');
  expect(table.style.width).toBe('252px');
  expect(table.style.zoom).toBe('');
  expect(Array.from(table.querySelectorAll('col'), column => column.style.width)).toEqual(['40px', '212px']);
  expect(root.querySelector('.export-table-measure')).toBeNull();
  const original = await session.update({ ...DEFAULT_PDF, items: { 'table-1': 'original' } });
  expect(table.style.width).toBe('1600px');
  expect(table.querySelector('colgroup')!.outerHTML).toBe(originalColumns);
  expect(original.issues.some(issue => issue.blocking && issue.message.includes('原列宽'))).toBe(true);
  expect(table.dataset.exportTableMode).toBe('original');
  expect((await session.update(DEFAULT_PDF)).issues).toEqual([]);
  expect(table.textContent?.replaceAll('\u00a0', '')).toBe('IDReadable description');
});

it('automatic printing wraps an oversized merged table without changing its cells', async () => {
  const root = fixture('<table data-export-item="table-1" style="width:1500px"><colgroup><col style="width:1000px"><col style="width:500px"></colgroup><tbody><tr><td colspan="2">Merged content</td></tr></tbody></table>');
  const table = root.querySelector('table')!, cell = table.rows[0].cells[0];
  measure(table, () => parseFloat(table.style.width));
  measure(cell, () => parseFloat(table.style.width));
  Array.from(table.querySelectorAll('col')).forEach((column, index) => measure(column, () => parseFloat(table.style.width) * [2 / 3, 1 / 3][index]));
  expect((await createLayoutSession(root).update(DEFAULT_PDF)).issues).toEqual([]);
  expect(parseFloat(table.style.width)).toBeCloseTo((210 - 24) * 96 / 25.4);
  expect(table.rows[0].cells[0]).toBe(cell);
  expect(cell.colSpan).toBe(2);
  expect(cell.textContent?.replaceAll('\u00a0', '')).toBe('Merged content');
});

it('automatic printing removes manual blank row height and original restores it', async () => {
  const root = fixture('<table data-export-item="table-1"><tbody><tr style="height:2000px;min-height:2000px"><td>Short row</td></tr></tbody></table>');
  const table = root.querySelector('table')!, row = table.rows[0];
  measure(table, () => 200); measure(row, () => 200); measure(row.cells[0], () => 200);
  const session = createLayoutSession(root), automatic = await session.update(DEFAULT_PDF);
  expect(row.style.height).toBe(''); expect(row.style.minHeight).toBe('');
  expect(automatic.adjustable).toContain('table-1'); expect(automatic.issues).toEqual([]);
  await session.update({ ...DEFAULT_PDF, items: { 'table-1': 'original' } });
  expect(row.style.height).toBe('2000px'); expect(row.style.minHeight).toBe('2000px');
  expect(row.textContent?.replaceAll('\u00a0', '')).toBe('Short row');
});

it('constrains nested automatic tables to their cell and rechecks ancestors on local mode changes', async () => {
  const root = fixture('<table data-export-item="table-parent" style="width:500px"><colgroup><col style="width:250px"><col style="width:250px"></colgroup><tbody><tr><td>Label</td><td><table data-export-item="table-1" style="width:500px"><colgroup><col style="width:250px"><col style="width:250px"></colgroup><tbody><tr><td>ID</td><td>Long content</td></tr></tbody></table></td></tr></tbody></table>');
  const parent = root.querySelector('table')!, table = parent.querySelector('table')!;
  table.parentElement!.style.padding = '10px';
  Object.defineProperty(table.parentElement!, 'clientWidth', { configurable: true, value: 250 });
  for (const element of [parent, table]) measure(element, () => parseFloat(element.style.width));
  vi.spyOn(HTMLTableCellElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLTableCellElement) {
    return new DOMRect(0, 0, this.closest('.export-table-measure') ? [38, 400][this.cellIndex] : 250, 20);
  });
  const session = createLayoutSession(root), report = await session.update(DEFAULT_PDF);
  expect(report.issues).toEqual([]); expect(table.style.width).toBe('230px');
  expect(table.style.zoom).toBe(''); expect(parent.style.width).toBe('500px');
  const original = await session.update({ ...DEFAULT_PDF, items: { 'table-1': 'original' } });
  expect(table.style.width).toBe('500px'); expect(original.issues.some(issue => issue.id === 'table-1' && issue.blocking)).toBe(true);
  expect((await session.update(DEFAULT_PDF)).issues).toEqual([]); expect(table.style.width).toBe('230px');
});

it('restores original nested widths after continuing the parent row', async () => {
  const root = fixture('<table data-export-item="table-parent" style="width:500px"><colgroup><col style="width:250px"><col style="width:250px"></colgroup><tbody><tr><td>' + 'Long text '.repeat(120) + '</td><td style="padding:10px"><table data-export-item="table-1" style="width:500px"><colgroup><col style="width:250px"><col style="width:250px"></colgroup><tbody><tr><td>ID</td><td>Long content</td></tr></tbody></table></td></tr></tbody></table>');
  vi.spyOn(HTMLTableElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLTableElement) { return new DOMRect(0, 0, parseFloat(this.style.width) || 500, 20); });
  vi.spyOn(HTMLTableRowElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLTableRowElement) { return new DOMRect(0, 0, 500, this.closest('table')?.dataset.exportItem === 'table-parent' && !this.hasAttribute('data-export-row-part') ? 2000 : 20); });
  vi.spyOn(HTMLTableCellElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLTableCellElement) { return new DOMRect(0, 0, this.closest('.export-table-measure') ? [38, 400][this.cellIndex] : 250, 20); });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(250);
  const rangeRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: function(this: Range) { return new DOMRect(0, Math.max(0, this.endOffset - 1) * 2, 10, 20); } });
  try {
    const session = createLayoutSession(root);
    await session.update(DEFAULT_PDF);
    expect(root.querySelectorAll('table[data-export-item="table-parent"] > tbody > tr').length).toBeGreaterThan(1);
    expect(root.querySelector<HTMLTableElement>('table[data-export-item="table-1"]')!.style.width).toBe('230px');
    await session.update({ ...DEFAULT_PDF, items: { 'table-1': 'original' } });
    expect(root.querySelector<HTMLTableElement>('table[data-export-item="table-1"]')!.style.width).toBe('500px');
    await session.update(DEFAULT_PDF);
    expect(root.querySelector<HTMLTableElement>('table[data-export-item="table-1"]')!.style.width).toBe('230px');
    expect(root.querySelectorAll('table[data-export-item="table-1"]')).toHaveLength(1);
  } finally {
    if (rangeRect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', rangeRect);
    else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
  }
});
