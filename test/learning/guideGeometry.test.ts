import { describe, expect, it } from 'vitest';
import { bottom, guideArrow, intersectionArea, placeGuideCard, right, unionRects, type GuideRect } from '../../src/features/learning/guideGeometry';

describe('guide placement around editable targets', () => {
  it.each([
    { left: 4, top: 100, width: 80, height: 24 },
    { left: 850, top: 620, width: 90, height: 24 },
    { left: 420, top: 320, width: 160, height: 50 },
  ])('keeps the card visible and away from target at $left, $top', target => {
    const card = placeGuideCard(target, { width: 290, height: 210 }, { width: 1000, height: 700 });
    expect(card.left).toBeGreaterThanOrEqual(12); expect(card.top).toBeGreaterThanOrEqual(12);
    expect(right(card)).toBeLessThanOrEqual(988); expect(bottom(card)).toBeLessThanOrEqual(688);
    expect(intersectionArea(card, target)).toBe(0);
  });
  it('chooses another free side when an annotation popover occupies the preferred side', () => {
    const target = { left: 420, top: 300, width: 120, height: 40 };
    const obstacle = { left: 564, top: 260, width: 320, height: 300 };
    const card = placeGuideCard(target, { width: 290, height: 210 }, { width: 1000, height: 700 }, [obstacle]);
    expect(intersectionArea(card, target)).toBe(0); expect(intersectionArea(card, obstacle)).toBe(0);
  });
  it('shrinks the card to fit a narrow viewport', () => {
    const card = placeGuideCard({ left: 140, top: 90, width: 30, height: 20 }, { width: 290, height: 210 }, { width: 240, height: 180 });
    expect(card.width).toBe(216); expect(card.height).toBe(156);
    expect(right(card)).toBeLessThanOrEqual(228); expect(bottom(card)).toBeLessThanOrEqual(168);
  });
  it('unites multiline phrase bounds and returns no target for an empty range', () => {
    expect(unionRects([])).toBeNull();
    expect(unionRects([{ left: 100, top: 100, width: 150, height: 20 }, { left: 60, top: 125, width: 80, height: 20 }])).toEqual({ left: 60, top: 100, width: 190, height: 45 });
  });
  it.each([
    { left: 10, top: 100, width: 200, height: 120 },
    { left: 600, top: 100, width: 200, height: 120 },
    { left: 280, top: 10, width: 200, height: 120 },
    { left: 280, top: 400, width: 200, height: 120 },
  ])('anchors the arrow on the card edge and outside target text', (card: GuideRect) => {
    const target = { left: 320, top: 260, width: 120, height: 40 }, arrow = guideArrow(card, target);
    expect([card.left, right(card)].includes(arrow.start.x) || [card.top, bottom(card)].includes(arrow.start.y)).toBe(true);
    expect(arrow.end.x < target.left || arrow.end.x > right(target) || arrow.end.y < target.top || arrow.end.y > bottom(target)).toBe(true);
    expect(arrow.path).not.toContain('NaN');
  });
});
