import { describe, expect, it } from 'vitest';
import { mergeTextRects, unionRects } from '../../src/features/learning/guideGeometry';

describe('guide text bounds', () => {
  it('unites multiline phrase bounds and returns no target for an empty range', () => {
    expect(unionRects([])).toBeNull();
    expect(unionRects([{ left: 100, top: 100, width: 150, height: 20 }, { left: 60, top: 125, width: 80, height: 20 }])).toEqual({ left: 60, top: 100, width: 190, height: 45 });
  });
  it('merges overlapping and adjacent fragments from formatted text on the same line', () => {
    expect(mergeTextRects([
      { left: 150, top: 100, width: 50, height: 20 },
      { left: 100, top: 100, width: 60, height: 20 },
      { left: 200, top: 100, width: 30, height: 20 },
      { left: 100, top: 100, width: 60, height: 20 },
    ])).toEqual([{ left: 100, top: 100, width: 130, height: 20 }]);
  });
  it('keeps wrapped lines and separated text regions distinct', () => {
    expect(mergeTextRects([
      { left: 100, top: 100, width: 80, height: 20 },
      { left: 100, top: 124, width: 50, height: 20 },
      { left: 240, top: 100, width: 30, height: 20 },
    ])).toEqual([
      { left: 100, top: 100, width: 80, height: 20 },
      { left: 240, top: 100, width: 30, height: 20 },
      { left: 100, top: 124, width: 50, height: 20 },
    ]);
  });
  it('discards empty fragments instead of stretching the spotlight to the origin', () => {
    expect(mergeTextRects([
      { left: 0, top: 0, width: 0, height: 0 },
      { left: 0, top: 0, width: 10, height: 0 },
      { left: 0, top: 0, width: 0, height: 10 },
      { left: 100, top: 100, width: 60, height: 20 },
    ])).toEqual([{ left: 100, top: 100, width: 60, height: 20 }]);
    expect(mergeTextRects([])).toEqual([]);
  });
});
