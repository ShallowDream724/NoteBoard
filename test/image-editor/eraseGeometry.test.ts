import { describe, expect, it, vi } from 'vitest';
import { intersectsEraseSweep } from '../../src/features/image-editor/eraseGeometry';
import type { ImageEditOperation, Point } from '../../src/features/image-editor/model';

const point = (x: number, y: number): Point => ({ x, y });
const style = { color: '#f00', width: 2, pattern: 'solid' as const };

describe('object eraser geometry', () => {
  it('hits a stroke at the circular boundary and catches a small object crossed between pointer events', () => {
    const line: ImageEditOperation = { id: 'line', type: 'line', points: [point(50, 10), point(50, 20)], style };
    expect(intersectsEraseSweep(line, point(0, 15), point(100, 15), 1)).toBe(true);
    expect(intersectsEraseSweep(line, point(0, 23), point(100, 23), 2)).toBe(true);
    expect(intersectsEraseSweep(line, point(0, 23.1), point(100, 23.1), 2)).toBe(false);
  });

  it('distinguishes empty shape interiors from fills', () => {
    const outline: ImageEditOperation = { id: 'outline', type: 'rectangle', rect: { x: 10, y: 10, width: 40, height: 30 }, style };
    expect(intersectsEraseSweep(outline, point(20, 20), point(30, 20), 2)).toBe(false);
    expect(intersectsEraseSweep(outline, point(20, 9), point(20, 9), 0)).toBe(true);
    expect(intersectsEraseSweep({ ...outline, fill: '#fff' }, point(20, 20), point(30, 20), 2)).toBe(true);
    const ellipse: ImageEditOperation = { id: 'ellipse', type: 'ellipse', rect: { x: 30, y: 30, width: 40, height: 40 }, style };
    expect(intersectsEraseSweep(ellipse, point(50, 50), point(50, 50), 2)).toBe(false);
    expect(intersectsEraseSweep(ellipse, point(50, 50), point(50, 68), 1)).toBe(true);
    expect(intersectsEraseSweep(ellipse, point(0, 50), point(100, 50), 0)).toBe(true);
    expect(intersectsEraseSweep({ ...ellipse, fill: '#fff' }, point(50, 50), point(50, 50), 2)).toBe(true);
  });

  it('uses circular areas rather than the corners of their bounding squares', () => {
    const marker: ImageEditOperation = { id: 'marker', type: 'marker', center: point(50, 50), size: 40, value: 1, format: 'decimal', shape: 'circle', appearance: 'filled', style };
    expect(intersectsEraseSweep(marker, point(69, 69), point(69, 69), 1)).toBe(false);
    expect(intersectsEraseSweep(marker, point(70, 50), point(70, 50), 0)).toBe(true);
    expect(intersectsEraseSweep(marker, point(71, 50), point(71, 50), 0)).toBe(false);
    expect(intersectsEraseSweep(marker, point(71, 50), point(71, 50), 1)).toBe(true);
    const magnifier: ImageEditOperation = { id: 'magnifier', type: 'magnifier', center: point(50, 50), radius: 20, zoom: 2, style };
    expect(intersectsEraseSweep(magnifier, point(69, 69), point(69, 69), 1)).toBe(false);
  });

  it('keeps elliptical hover to one boundary solve and circular hover analytic', () => {
    const ellipse: ImageEditOperation = { id: 'ellipse', type: 'ellipse', rect: { x: 30, y: 30, width: 80, height: 40 }, style };
    const circle: ImageEditOperation = { id: 'circle', type: 'ellipse', rect: { x: 30, y: 30, width: 40, height: 40 }, style };
    const cos = vi.spyOn(Math, 'cos'), sin = vi.spyOn(Math, 'sin');
    try {
      expect(intersectsEraseSweep(ellipse, point(111, 50), point(111, 50), 0)).toBe(true);
      expect(cos.mock.calls.length + sin.mock.calls.length).toBeLessThan(240);
      cos.mockClear(); sin.mockClear();
      expect(intersectsEraseSweep(circle, point(70, 50), point(70, 50), 0)).toBe(true);
      expect(cos).not.toHaveBeenCalled();
      expect(sin).not.toHaveBeenCalled();
    } finally { cos.mockRestore(); sin.mockRestore(); }
    expect(intersectsEraseSweep(ellipse, point(111.1, 50), point(111.1, 50), 0)).toBe(false);
  });

  it('tests every path segment and the arrow wings', () => {
    const pen: ImageEditOperation = { id: 'pen', type: 'pen', points: [point(10, 10), point(30, 10), point(30, 30)], style };
    expect(intersectsEraseSweep(pen, point(0, 20), point(50, 20), 0)).toBe(true);
    expect(intersectsEraseSweep(pen, point(15, 25), point(20, 25), 2)).toBe(false);
    const arrow: ImageEditOperation = { id: 'arrow', type: 'line', points: [point(30, 50), point(50, 50)], style, endHead: 'open' };
    expect(intersectsEraseSweep(arrow, point(42, 55), point(42, 55), .5)).toBe(true);
  });

  it('does not delete pixel erasers and rejects invalid sweep inputs', () => {
    const eraser: ImageEditOperation = { id: 'eraser', type: 'eraser', points: [point(0, 0), point(10, 0)], width: 10 };
    expect(intersectsEraseSweep(eraser, point(5, 0), point(5, 0), 20)).toBe(false);
    const pen: ImageEditOperation = { id: 'pen', type: 'pen', points: [], style };
    expect(intersectsEraseSweep(pen, point(0, 0), point(0, 0), 2)).toBe(false);
    expect(intersectsEraseSweep({ ...pen, points: [point(0, 0)] }, point(0, 0), point(0, 0), -1)).toBe(false);
    expect(intersectsEraseSweep({ ...pen, points: [point(0, 0)] }, point(Infinity, 0), point(0, 0), 2)).toBe(false);
  });
});
