import { describe, expect, it } from 'vitest';
import { clipGuideRect, guideAnchor, guideControlAnchor, guideInsertionRect, mergeTextRects, unionRects } from '../../src/features/learning/guideGeometry';

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
  it('clips a text fragment to the actual editor scroll bounds', () => {
    const bounds = { left: 40, top: 180, width: 360, height: 260 };
    expect(clipGuideRect({ left: 20, top: 160, width: 100, height: 60 }, bounds)).toEqual({ left: 40, top: 180, width: 80, height: 40 });
    expect(clipGuideRect({ left: 370, top: 420, width: 100, height: 60 }, bounds)).toEqual({ left: 370, top: 420, width: 30, height: 20 });
    expect(clipGuideRect({ left: 40, top: 100, width: 100, height: 20 }, bounds)).toBeNull();
    expect(clipGuideRect({ left: 400, top: 180, width: 100, height: 20 }, bounds)).toBeNull();
  });
  it.each([100, 600, 1100])('keeps a compact empty-line cue around a caret at %i, including centered and right-aligned lines', left => {
    const caret = { left, top: 240, width: 0, height: 28 }, line = { left: 100, top: 238, width: 1000, height: 32 };
    const cue = guideInsertionRect(caret, line, 20)!;
    expect(cue.width).toBe(100); expect(cue.top).toBe(caret.top); expect(cue.height).toBe(caret.height);
    expect(cue.left).toBeGreaterThanOrEqual(line.left); expect(cue.left + cue.width).toBeLessThanOrEqual(line.left + line.width);
    expect(cue.left).toBeLessThanOrEqual(caret.left); expect(cue.left + cue.width).toBeGreaterThanOrEqual(caret.left);
  });
  it('uses the available width on a very short line and rejects unmeasurable insertion areas', () => {
    const caret = { left: 100, top: 240, width: 0, height: 28 }, line = { left: 100, top: 238, width: 42, height: 32 };
    expect(guideInsertionRect(caret, line, 20)).toEqual({ ...caret, width: 42 });
    expect(guideInsertionRect({ ...caret, height: 0 }, line, 20)).toBeNull();
    expect(guideInsertionRect(caret, { ...line, width: 0 }, 20)).toBeNull();
    expect(guideInsertionRect(caret, line, NaN)).toBeNull();
  });
  it('anchors a multiline popover on the actual first line when there is room above', () => {
    const first = { left: 240, top: 250, width: 100, height: 20 }, last = { left: 100, top: 275, width: 80, height: 20 };
    expect(guideAnchor([first, last], { left: 0, top: 0, width: 600, height: 600 })).toEqual({ rect: first, side: 'top' });
  });
  it('anchors on the actual last line when only the space below can fit the popover', () => {
    const first = { left: 240, top: 50, width: 100, height: 20 }, last = { left: 100, top: 75, width: 80, height: 20 };
    expect(guideAnchor([first, last], { left: 0, top: 0, width: 600, height: 600 })).toEqual({ rect: last, side: 'bottom' });
  });
  it('lets collision handling use the union when neither side fits and handles missing text', () => {
    const lines = [{ left: 240, top: 100, width: 100, height: 20 }, { left: 100, top: 125, width: 80, height: 20 }];
    const bounds = { left: 0, top: 0, width: 600, height: 240 };
    expect(guideAnchor(lines, bounds)).toEqual({ rect: unionRects(lines), side: 'top' });
    expect(guideAnchor([], bounds)).toEqual({ rect: null, side: 'top' });
  });
  it('places a selection toolbar cue below the control to preserve the selected text above it', () => {
    const button = { left: 320, top: 246, width: 24, height: 30 }, text = { left: 365, top: 210, width: 96, height: 21 };
    expect(guideControlAnchor([button], [text], { left: 4, top: 4, width: 1432, height: 992 }, { width: 280, height: 161 })).toEqual({ rect: button, side: 'bottom' });
  });
  it.each([['right', 600, 1440], ['left', 440, 680]] as const)('moves a top toolbar cue to the %s when there is no room above and its text is below', (side, left, width) => {
    const button = { left, top: 42, width: 24, height: 24 }, text = { left: 350, top: 210, width: 96, height: 21 };
    expect(guideControlAnchor([button], [text], { left: 4, top: 4, width: width - 8, height: 532 }, { width: 280, height: 161 })).toEqual({ rect: button, side, align: 'end' });
  });
});
