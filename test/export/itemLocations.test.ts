import { expect, it } from 'vitest';
import { addItemLocations, clearItemLocations } from '../../src/features/export/itemLocations';

it('adds independent hit boxes without wrapping formula glyphs or replacing content', () => {
  const math = document.createElement('span');
  math.className = 'export-math'; math.dataset.exportItem = 'formula-1';
  math.innerHTML = '<span class="katex-html"><span class="base"><span>x</span><span>+</span><span>y</span></span><span class="base">=z</span></span>';
  const original = math.innerHTML, glyph = math.querySelector('.base > span');
  const ids = new Set(['formula-1']);
  addItemLocations([math], ids); addItemLocations([math], ids);
  expect(math.querySelectorAll('a')).toHaveLength(2);
  expect(math.querySelector('.base > span')).toBe(glyph);
  expect(glyph?.closest('a')).toBeNull();
  expect([...math.querySelectorAll('a')].every(link => link.childElementCount === 0)).toBe(true);
  clearItemLocations(math);
  // Removing transient host classes must not disturb mathematical markup.
  expect(math.innerHTML).toBe(original);
});

it('uses one hit box per continued matrix part rather than per cell', () => {
  const matrix = document.createElement('div');
  matrix.className = 'export-math'; matrix.dataset.exportItem = 'formula-2'; matrix.dataset.mathContinued = 'true';
  matrix.innerHTML = Array.from({ length: 3 }, () => '<div class="math-continuation-part"><span class="katex-html"><span class="base">a</span><span class="base">b</span></span></div>').join('');
  addItemLocations([matrix], new Set(['formula-2']));
  expect(matrix.querySelectorAll('.export-item-link')).toHaveLength(3);
  expect(matrix.querySelector('.base > a')).toBeNull();
});

it('keeps original table links and formula locations separate on repeated updates', () => {
  const table = document.createElement('table'); table.dataset.exportItem = 'table-1';
  table.innerHTML = '<tbody><tr><td><a href="https://example.com">source</a></td><td><span class="export-math" data-export-item="formula-1"><span class="katex-html"><span class="base">x</span></span></span></td></tr></tbody>';
  const math = table.querySelector<HTMLElement>('.export-math')!, source = table.querySelector('a')!;
  const ids = new Set(['table-1', 'formula-1']);
  addItemLocations([table, math], ids); addItemLocations([table, math], ids);
  expect(table.querySelectorAll('.export-table-location')).toHaveLength(2);
  expect(math.querySelectorAll('.export-math-location')).toHaveLength(1);
  expect(table.querySelector('a a')).toBeNull();
  clearItemLocations(table);
  expect(table.querySelector('a')).toBe(source);
  expect(source.textContent).toBe('source');
});

it('keeps a formula error reachable even when no KaTeX fragment exists', () => {
  const math = document.createElement('div'); math.className = 'export-math'; math.dataset.exportItem = 'formula-3';
  math.textContent = '此公式超出排版预算';
  addItemLocations([math], new Set(['formula-3']));
  expect(math.querySelectorAll('.export-item-link')).toHaveLength(1);
  clearItemLocations(math);
  expect(math.textContent).toBe('此公式超出排版预算');
  expect(math.classList.contains('export-location-host')).toBe(false);
});
