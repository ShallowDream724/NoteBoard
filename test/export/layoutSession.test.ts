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
  expect(affectedRead).toHaveBeenCalledTimes(1); expect(quoteRead).toHaveBeenCalledTimes(1);
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
