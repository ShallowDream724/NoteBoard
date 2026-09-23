import { describe, expect, it, vi } from 'vitest';
import { Mapping, StepMap } from '@tiptap/pm/transform';
import { transactionStart } from '../../src/features/editor-md/transactionStart';

function reference(maps: StepMap[]) {
  let result: number | undefined;
  maps.forEach((map, index) => map.forEach(from => {
    const original = new Mapping(maps.slice(0, index)).invert().map(from);
    result = Math.min(result ?? original, original);
  }));
  return result;
}

describe('history transaction start', () => {
  it('preserves original caret boundaries across insertion, removal and bulk edits', () => {
    const cases = [[], [StepMap.empty], [[8, 0, 4], [2, 3, 1]], [[4, 2, 0], [8, 1, 4]],
      [[2, 3, 10], [6, 2, 0], [25, 4, 1]], [[20, 2, 1], [10, 2, 1], [2, 2, 1]],
      [[2, 1, 2, 8, 2, 3], [4, 5, 0], [1, 0, 8]]];
    for (const input of cases) {
      const maps = input.map(item => item instanceof StepMap ? item : new StepMap(item));
      expect(transactionStart(maps)).toBe(reference(maps));
    }
  });

  it('visits each map once for 10,000 replacements', () => {
    const maps = Array.from({ length: 10_000 }, (_, index) => new StepMap([(10_000 - index) * 3, 1, 2]));
    const visit = vi.spyOn(StepMap.prototype, 'forEach');
    const invert = vi.spyOn(StepMap.prototype, 'invert');
    try {
      expect(transactionStart(maps)).toBe(3);
      expect(visit).toHaveBeenCalledTimes(maps.length);
      expect(invert).toHaveBeenCalledTimes(maps.length - 1);
    } finally { visit.mockRestore(); invert.mockRestore(); }
  });
});
