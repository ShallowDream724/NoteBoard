import { describe, expect, it } from 'vitest';
import { commitImageEdit, createImageEditHistory, createImageEditRecipe, formatMarkerValue, redoImageEdit, undoImageEdit, type ImageEditOperation } from '../../src/features/image-editor/model';
import { constrainCrop, getOutputSize, getSourceTransform, hitTestOperation, outputToSource, sourceToOutput, translateOperation, validateImageEditRecipe } from '../../src/features/image-editor/geometry';

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
