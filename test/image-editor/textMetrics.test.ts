// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { getOperationBounds } from '../../src/features/image-editor/geometry';
import type { TextOperation } from '../../src/features/image-editor/model';
import { formatTextCanvasFont, measureTextLayout } from '../../src/features/image-editor/textMetrics';

const text = (value: string, patch: Partial<TextOperation> = {}): TextOperation => ({
  id: 'text', type: 'text', position: { x: 10, y: 20 }, text: value, color: '#000', fontSize: 32, ...patch,
});

describe('image annotation text metrics', () => {
  it('reserves full-width CJK and emoji glyphs when raster measurement is unavailable', () => {
    const cjk = text('图上输入文字'), latin = text('abcdef'), emoji = text('😀🖼️');
    expect(measureTextLayout(cjk).width).toBeGreaterThan(6 * 32 * .9);
    expect(measureTextLayout(cjk).width).toBeGreaterThan(measureTextLayout(latin).width);
    expect(measureTextLayout(emoji).width).toBeGreaterThan(2 * 32);
    expect(getOperationBounds(cjk)).toMatchObject({ x: 10, y: 20, width: measureTextLayout(cjk).width });
  });

  it('uses the widest line and a shared 1.25 line height for multiline bounds', () => {
    const operation = text('Hi\n图上输入文字\n', { fontSize: 20 });
    const layout = measureTextLayout(operation);
    expect(layout.lineHeight).toBe(25);
    expect(layout.height).toBe(75);
    expect(layout.baseline).toBeCloseTo(18.5);
    expect(layout.width).toBeGreaterThan(measureTextLayout(text('Hi', { fontSize: 20 })).width);
    expect(getOperationBounds(operation)).toEqual({ x: 10, y: 20, width: layout.width, height: layout.height });
    expect(measureTextLayout(operation)).toBe(layout);
  });

  it('formats bold, italic and chosen font family consistently', () => {
    const operation = text('字', { bold: true, italic: true, fontFamily: 'Noto Sans CJK SC' });
    expect(formatTextCanvasFont(operation)).toBe('italic bold 32px Noto Sans CJK SC');
    expect(measureTextLayout(operation).width).toBeGreaterThan(measureTextLayout(text('字')).width);
    expect(formatTextCanvasFont(text('abc'))).toBe('32px sans-serif');
  });
});
