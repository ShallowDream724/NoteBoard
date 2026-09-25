import { afterEach, expect, it, vi } from 'vitest';
import { allocateTableWidths, captureTablePresentation, markTableEdges, restoreTablePresentation, setAutomaticTableWidths } from '../../src/features/export/tableLayout';
import { continueTableRows } from '../../src/features/export/tableContinuation';

const originalRangeRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
afterEach(() => {
  document.body.replaceChildren(); vi.restoreAllMocks();
  if (originalRangeRect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', originalRangeRect);
  else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
});

it('reserves complete compact columns before fitting a long formula column', () => {
  const widths = allocateTableWidths({ natural: [65, 2100, 89], minimum: [22, 1400, 75] }, 700)!;
  expect(widths).toEqual([65, 546, 89]);
  expect(allocateTableWidths({ natural: [55, 90, 80], minimum: [20, 30, 25] }, 700)).toEqual([55, 90, 80]);
  expect(allocateTableWidths({ natural: Array(20).fill(80), minimum: Array(20).fill(20) }, 700)).toBeNull();
});

it('temporary wrapping restores original manual widths after repeated mode changes', () => {
  const table = document.createElement('table'); table.style.width = '1200px'; table.innerHTML = '<colgroup><col style="width:400px"><col style="width:800px"></colgroup><tbody><tr><td>A</td><td>B</td></tr></tbody>';
  const baseline = captureTablePresentation(table), original = table.querySelector('colgroup')!.outerHTML;
  setAutomaticTableWidths(table, [50, 130]);
  expect(table.querySelectorAll('col')).toHaveLength(2);
  expect(table.style.getPropertyValue('--export-table-width')).toBe('180px');
  expect(table.style.width).toBe('180px');
  restoreTablePresentation(table, baseline);
  expect(table.querySelector('colgroup')!.outerHTML).toBe(original);
  setAutomaticTableWidths(table, [200, 400]); restoreTablePresentation(table, baseline);
  expect(table.querySelectorAll('colgroup')).toHaveLength(1);
  expect(table.querySelector('colgroup')!.outerHTML).toBe(original);
  expect(table.style.width).toBe('1200px');
  expect(table.style.getPropertyValue('--export-table-width')).toBe('');
});

it('assigns outer rules to logical edges without adding a left border inside rowspans', () => {
  const table = document.createElement('table');
  table.innerHTML = '<thead><tr><th rowspan="2">A</th><th colspan="2">B</th></tr><tr><th>C</th><th>D</th></tr></thead><tbody><tr><td rowspan="0">E</td><td>F</td><td>G</td></tr><tr><td colspan="2">H</td></tr></tbody>';
  markTableEdges(table);
  expect(Array.from(table.querySelectorAll('[data-export-edge~="left"]'), cell => cell.textContent)).toEqual(['A', 'E']);
  expect(Array.from(table.querySelectorAll('[data-export-edge~="top"]'), cell => cell.textContent)).toEqual(['A', 'B']);
  expect(Array.from(table.querySelectorAll('[data-export-edge~="bottom"]'), cell => cell.textContent)).toEqual(['E', 'H']);
  // Recomputing after a structural change clears stale outer-edge markers.
  table.rows[0].cells[0].rowSpan = 1; markTableEdges(table);
  expect(table.rows[1].cells[0].dataset.exportEdge).toBe('left');
});

function tallRow() {
  const table = document.createElement('table');
  table.innerHTML = '<tbody><tr><td>R-1</td><td><a href="https://example.com">' + '文本🙂 linked content '.repeat(30) + '</a></td></tr></tbody>';
  document.body.append(table);
  vi.spyOn(table.rows[0], 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 900));
  // Only a character-sized range is needed for each binary-search step.
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: function(this: Range) {
    const top = this.startContainer.nodeType === Node.TEXT_NODE && this.startContainer.parentElement?.tagName === 'A'
      ? Math.floor(Math.max(0, this.endOffset - 1) / 16) * 20 : 0;
    return new DOMRect(0, top, 10, 20);
  } });
  return table;
}

it('continues tall rows without losing text or links and repeats only a short first label', () => {
  const table = tallRow(), source = table.rows[0].cells[1].textContent;
  const result = continueTableRows(table, 220);
  expect(result.changed).toBe(true); expect(result.unsupported).toBe(false);
  expect(table.rows.length).toBeGreaterThan(2);
  expect(Array.from(table.rows, row => row.cells[1].textContent).join('')).toBe(source);
  for (const row of Array.from(table.rows).slice(1)) {
    expect(row.cells[0].textContent).toBe('（续）R-1');
    expect(row.querySelector('a')?.href).toBe('https://example.com/');
    expect(row.classList.contains('export-row-continuation')).toBe(true);
  }
  expect(table.rows[table.rows.length - 1].classList.contains('export-row-continues')).toBe(false);
  expect(Array.from(table.querySelectorAll('a')).every(link => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(link.textContent!))).toBe(true);
});

it('does not duplicate a long first column or sever a rowspan', () => {
  const table = tallRow();
  table.rows[0].cells[0].textContent = 'long label '.repeat(20);
  const original = table.rows[0].cells[0].textContent;
  continueTableRows(table, 220);
  table.querySelectorAll('.export-row-marker').forEach(marker => marker.remove());
  expect(Array.from(table.rows, row => row.cells[0].textContent).join('')).toBe(original);
  const merged = tallRow(); merged.rows[0].cells[0].rowSpan = 2;
  const row = merged.rows[0];
  expect(continueTableRows(merged, 220)).toMatchObject({ changed: false, unsupported: true });
  expect(merged.rows[0]).toBe(row); expect(merged.rows[0].cells[0].rowSpan).toBe(2);
});

it('splits a tall formula only between intact KaTeX bases', () => {
  const table = tallRow(), cell = table.rows[0].cells[1];
  cell.innerHTML = '<span class="export-math wrap"><span class="katex"><span class="katex-html">' + Array.from({ length: 12 }, (_, index) => `<span class="base">x${index}</span>`).join('') + '</span></span></span>';
  vi.spyOn(cell.querySelector('.export-math')!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 500, 720));
  Array.from(cell.querySelectorAll('.base')).forEach((base, index) => vi.spyOn(base, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, index * 60, 300, 60)));
  expect(continueTableRows(table, 220)).toMatchObject({ changed: true, unsupported: false });
  expect(Array.from(table.querySelectorAll('.base'), base => base.textContent)).toEqual(Array.from({ length: 12 }, (_, index) => `x${index}`));
  expect(Array.from(table.querySelectorAll('.base')).every(base => base.parentElement?.className === 'katex-html')).toBe(true);
});
