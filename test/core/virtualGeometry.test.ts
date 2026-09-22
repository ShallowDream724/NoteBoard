import { expect, it } from 'vitest';
import { SizeIndex } from '../../src/core/dom/sizeIndex';
import { lastAtOrBefore } from '../../src/core/dom/orderedPosition';

it('tracks variable rows at exact boundaries after growth and shrinkage', () => {
  const index = new SizeIndex([20, 30, 10]);
  expect([-10, 0, 19, 20, 49, 50, 60, 100].map(value => index.indexAt(value)))
    .toEqual([0, 0, 0, 1, 1, 2, 2, 2]);
  expect(index.set(1, 50)).toBe(20);
  expect(index.prefix(2)).toBe(70);
  expect(index.total).toBe(80);
  expect(index.indexAt(60)).toBe(1);
  index.set(0, 5);
  expect(index.indexAt(55)).toBe(2);
  expect(index.total).toBe(65);
  expect(() => index.set(-1, 10)).toThrow(RangeError);
  expect(() => index.set(0, 0)).toThrow(RangeError);
});

it('matches direct row sums after interleaved updates on a large index', () => {
  const rows = Array.from({ length: 10_000 }, (_, i) => 20 + i % 7);
  const index = new SizeIndex(rows);
  for (let i = 0; i < rows.length; i += 71) index.set(i, rows[i] = 47);
  let sum = 0;
  rows.forEach((height, i) => {
    expect(index.prefix(i)).toBe(sum);
    expect(index.indexAt(sum + height / 2)).toBe(i);
    sum += height;
  });
  expect(index.total).toBe(sum);
});

it('finds the last heading using logarithmically bounded geometry reads', () => {
  let reads = 0;
  expect(lastAtOrBefore(100_000, i => { reads++; return i * 20; }, 123_459)).toBe(6172);
  expect(reads).toBeLessThanOrEqual(17);
  expect(lastAtOrBefore(3, i => [10, 10, 20][i], 10)).toBe(1);
  expect(lastAtOrBefore(3, i => i + 1, 0)).toBe(-1);
  expect(lastAtOrBefore(0, () => { throw Error('empty'); }, 100)).toBe(-1);
});
