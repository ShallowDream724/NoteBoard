import { expect, it } from 'vitest';
import { trailingTabEdge, type TabBounds } from '../src/components/titlebar/tabEdge';

const boxes = (widths: number[]) => {
  let start = 8;
  return widths.map(width => { const box = { start, end: start + width }; start += width + 4; return box; });
};
const edge = (tabs: TabBounds[], left: number, width: number) => trailingTabEdge(tabs.length, i => tabs[i], left, width);

it('removes a tiny trailing tab together with its gap but preserves the previous shoulder', () => {
  const tabs = boxes([200, 200, 200]);
  expect(edge(tabs, 0, 222)).toEqual({ hidden: 1, last: 0, trim: 6 });
  expect(edge(tabs, 0, 211)).toEqual({ hidden: 1, last: 0, trim: 0 });
});

it('keeps a useful partial tab and never hides the only visible tab', () => {
  const tabs = boxes([200, 200, 200]);
  expect(edge(tabs, 0, 260).hidden).toBe(-1);
  expect(edge(tabs, 0, 259).hidden).toBe(1);
  expect(edge(tabs, 196, 28).hidden).toBe(-1);
  expect(edge([], 0, 400).hidden).toBe(-1);
  expect(edge(boxes([80]), 0, 20).hidden).toBe(-1);
});

it('works for different title widths and a scrolled viewport without shortening its geometry', () => {
  const tabs = boxes([80, 170, 100, 200]);
  const snapshot = structuredClone(tabs);
  expect(edge(tabs, 85, 289)).toEqual({ hidden: 3, last: 2, trim: 0 });
  expect(edge(tabs, 85, 310)).toEqual({ hidden: 3, last: 2, trim: 21 });
  expect(tabs).toEqual(snapshot);
  expect(edge(tabs, 200, 500).hidden).toBe(-1);
});

it('uses logarithmic reads even with a million tabs', () => {
  let reads = 0;
  const result = trailingTabEdge(1_000_000, i => { reads++; return { start: 8 + i * 204, end: 208 + i * 204 }; }, 0, 834);
  expect(result.hidden).toBe(4);
  expect(reads).toBeLessThanOrEqual(22);
});
