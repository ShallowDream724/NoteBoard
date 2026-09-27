import { describe, expect, it } from 'vitest';
import { commitImageEdit, createImageEditHistory, createImageEditRecipe, formatMarkerValue, redoImageEdit, undoImageEdit, type ImageEditOperation } from '../../src/features/image-editor/model';
import { constrainCrop, getMagnifierRect, getOperationOutputBounds, getOperationResizeHandles, getOutputSize, getSourceTransform, hitTestOperation, isOperationMovable, outputToSource, resizeOperationInOutput, scaleOperationInOutput, sourceToOutput, translateOperation, validateImageEditRecipe } from '../../src/features/image-editor/geometry';

describe('image editing coordinates', () => {
  it.each([0, 1, 2, 3] as const)('round-trips cropped points for rotation %i and every mirror', rotation => {
    for (const flipX of [false, true]) for (const flipY of [false, true]) {
      const recipe = { ...createImageEditRecipe(800, 600), crop: { x: 123, y: 78, width: 320, height: 180 }, rotation, flipX, flipY };
      const point = { x: 300, y: 170 }, output = sourceToOutput(point, recipe);
      expect(outputToSource(output, recipe)).toEqual(point);
      const [a, b, c, d, e, f] = getSourceTransform(recipe);
      expect({ x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f }).toEqual(output);
      expect(getOutputSize(recipe)).toEqual(rotation % 2 ? { width: 180, height: 320 } : { width: 320, height: 180 });
    }
  });

  it('rotates crop top left clockwise into the output top right', () => {
    const recipe = { ...createImageEditRecipe(500, 300), crop: { x: 50, y: 20, width: 200, height: 100 }, rotation: 1 as const };
    expect(sourceToOutput({ x: 50, y: 20 }, recipe)).toEqual({ x: 100, y: 0 });
    expect(sourceToOutput({ x: 250, y: 120 }, recipe)).toEqual({ x: 0, y: 200 });
  });

  it('fits fixed aspect crops inside the source and rejects stale crop bounds', () => {
    expect(constrainCrop({ x: -4, y: 20, width: 800, height: 500 }, 400, 300, 2)).toEqual({ x: 0, y: 20, width: 400, height: 200 });
    expect(() => validateImageEditRecipe({ ...createImageEditRecipe(400, 300), crop: { x: 399, y: 0, width: 2, height: 10 } })).toThrow('裁剪范围');
  });

  it('hit tests line segments, not their enclosing empty box, and translates without mutation', () => {
    const operation: ImageEditOperation = { id: 'line', type: 'polyline', points: [{ x: 0, y: 0 }, { x: 100, y: 100 }], style: { color: '#fff', width: 4, pattern: 'solid' } };
    expect(hitTestOperation({ x: 50, y: 52 }, operation, 1)).toBe(true);
    expect(hitTestOperation({ x: 0, y: 100 }, operation, 1)).toBe(false);
    expect(translateOperation(operation, { x: 10, y: 20 })).toMatchObject({ points: [{ x: 10, y: 20 }, { x: 110, y: 120 }] });
    expect(operation.points[0]).toEqual({ x: 0, y: 0 });
  });

  it('resizes source geometry from output handles after crop, rotation and reflection', () => {
    const recipe = { ...createImageEditRecipe(300, 200), crop: { x: 40, y: 20, width: 200, height: 100 }, rotation: 1 as const, flipX: true };
    const rectangle: ImageEditOperation = { id: 'r', type: 'rectangle', rect: { x: 70, y: 40, width: 60, height: 30 }, style: { color: 'red', width: 2, pattern: 'solid' } };
    const old = getOperationOutputBounds(rectangle, recipe);
    const handles = getOperationResizeHandles(rectangle, recipe);
    expect(handles.map(item => item.handle)).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
    const changed = resizeOperationInOutput(rectangle, recipe, 'se', { x: old.x + old.width + 20, y: old.y + old.height + 10 });
    expect(getOperationOutputBounds(changed, recipe)).toEqual({ ...old, width: old.width + 20, height: old.height + 10 });
    expect(rectangle.rect).toEqual({ x: 70, y: 40, width: 60, height: 30 });
  });

  it('keeps text, markers and line geometry proportional while scaling', () => {
    const recipe = createImageEditRecipe(200, 200);
    const line: ImageEditOperation = { id: 'l', type: 'line', points: [{ x: 20, y: 30 }, { x: 80, y: 70 }], style: { color: 'red', width: 4, pattern: 'solid' } };
    const enlarged = scaleOperationInOutput(line, recipe, 1.5);
    expect(enlarged.type).toBe('line');
    if (enlarged.type === 'line') expect(enlarged.style.width).toBeCloseTo(6);
    const marker: ImageEditOperation = { id: 'm', type: 'marker', center: { x: 50, y: 50 }, size: 20, value: 1, format: 'decimal', shape: 'circle', appearance: 'filled', style: line.style };
    const marker2 = resizeOperationInOutput(marker, recipe, 'e', { x: 70, y: 50 });
    expect(getOperationOutputBounds(marker2, recipe).width).toBeCloseTo(getOperationOutputBounds(marker2, recipe).height);
    const text: ImageEditOperation = { id: 't', type: 'text', position: { x: 10, y: 10 }, text: 'hello', color: 'red', fontSize: 20 };
    const text2 = scaleOperationInOutput(text, recipe, 2);
    if (text2.type === 'text') expect(text2.fontSize).toBeCloseTo(40);
  });

  it('accepts legacy round magnifiers and excludes drawn strokes from dragging', () => {
    const legacy: ImageEditOperation = { id: 'mag', type: 'magnifier', center: { x: 50, y: 50 }, radius: 10, zoom: 2, style: { color: 'red', width: 2, pattern: 'solid' } };
    expect(getMagnifierRect(legacy)).toEqual({ x: 40, y: 40, width: 20, height: 20 });
    const brush: ImageEditOperation = { id: 'brush', type: 'mosaic-brush', points: [{ x: 10, y: 10 }, { x: 20, y: 20 }], width: 8, blockSize: 4 };
    expect(hitTestOperation({ x: 15, y: 15 }, brush)).toBe(true);
    expect(isOperationMovable(brush)).toBe(false);
    expect(translateOperation(brush, 10, 10)).toBe(brush);
    const outline: ImageEditOperation = { id: 'outline', type: 'rectangle', rect: { x: 0, y: 0, width: 100, height: 100 }, style: { color: 'red', width: 2, pattern: 'solid' } };
    expect(hitTestOperation({ x: 50, y: 50 }, outline)).toBe(false);
    expect(hitTestOperation({ x: 1, y: 50 }, outline)).toBe(true);
  });
});

describe('semantic image edit history', () => {
  it('shares immutable operations and restores numbering through undo and redo', () => {
    const recipe = createImageEditRecipe(8000, 6000), operation: ImageEditOperation = { id: 'text', type: 'text', position: { x: 1, y: 1 }, text: 'A', fontSize: 24, color: 'red' };
    const initial = createImageEditHistory(recipe);
    const one = commitImageEdit(initial, { ...recipe, operations: [operation] }, 2);
    const two = commitImageEdit(one, { ...one.present.recipe, flipX: true }, 2);
    expect(two.present.recipe.operations).toBe(one.present.recipe.operations);
    expect(two.past[1].recipe.operations[0]).toBe(operation);
    const undone = undoImageEdit(undoImageEdit(two));
    expect(undone.present).toEqual({ recipe, nextMarker: 1 });
    expect(redoImageEdit(undone).present.nextMarker).toBe(2);
    expect(commitImageEdit(undone, { ...recipe, flipY: true }).future).toEqual([]);
  });

  it('bounds retained snapshots and treats no-op commits as no-ops', () => {
    let history = createImageEditHistory(createImageEditRecipe(100, 100));
    expect(commitImageEdit(history, history.present.recipe)).toBe(history);
    for (let index = 0; index < 200; index++) history = commitImageEdit(history, { ...history.present.recipe, flipX: !history.present.recipe.flipX });
    expect(history.past).toHaveLength(80);
    expect(undoImageEdit(createImageEditHistory(history.present.recipe)).present.recipe).toBe(history.present.recipe);
  });

  it.each([[4, 'roman', 'IV'], [49, 'roman', 'XLIX'], [27, 'alpha', 'AA'], [702, 'alpha', 'ZZ'], [12, 'decimal', '12'], [Infinity, 'alpha', 'A']] as const)('formats marker %s as %s', (value, format, expected) => {
    expect(formatMarkerValue(value, format)).toBe(expected);
  });
});
