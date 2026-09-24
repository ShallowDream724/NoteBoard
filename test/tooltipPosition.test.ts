import { expect, it } from 'vitest';
import { placeCursorTooltip, type TooltipSide } from '../src/components/tooltipPosition';

it('honors a bottom preference at the top edge, and flips above near the bottom', () => {
  const size = { width: 180, height: 35 }, viewport = { width: 800, height: 500 };
  expect(placeCursorTooltip({ x: 200, y: 10 }, size, viewport, 'bottom', 'center', 14).y).toBe(24);
  expect(placeCursorTooltip({ x: 200, y: 490 }, size, viewport, 'bottom', 'center', 14).y).toBe(441);
});

it('keeps measured content inside all four window corners for every preferred side', () => {
  const viewport = { width: 400, height: 240 }, size = { width: 350, height: 70 };
  for (const side of ['top', 'bottom', 'left', 'right'] as TooltipSide[]) {
    for (const point of [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 0, y: 240 }, { x: 400, y: 240 }]) {
      const result = placeCursorTooltip(point, size, viewport, side, 'center', 14);
      expect(result.x).toBeGreaterThanOrEqual(8); expect(result.y).toBeGreaterThanOrEqual(8);
      expect(result.x + size.width).toBeLessThanOrEqual(392); expect(result.y + size.height).toBeLessThanOrEqual(232);
    }
  }
});
