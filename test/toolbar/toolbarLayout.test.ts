import { describe, expect, it } from 'vitest';
import { fitToolbar, type ToolbarItemSize } from '../../src/features/toolbar/toolbarLayout';

const button = (priority: number, width = 28): ToolbarItemSize => ({ priority, width });
const separator: ToolbarItemSize = { width: 7, priority: 0, separator: true };

describe('responsive toolbar', () => {
  it('shortens labels before removing an action, and restores them when space returns', () => {
    const items = [{ ...button(100, 72), compactSaving: 26 }, button(10)];
    expect(fitToolbar(items, 102)).toEqual({ compact: false, visible: [0, 1] });
    expect(fitToolbar(items, 76)).toEqual({ compact: true, visible: [0, 1] });
    expect(fitToolbar(items, 75)).toEqual({ compact: true, visible: [0] });
    expect(fitToolbar(items, 102).compact).toBe(false);
  });

  it('removes low priority actions in order regardless of their display order', () => {
    const items = [button(150), button(50), button(10), button(20), button(30), button(40)];
    expect(fitToolbar(items, 148).visible).toEqual([0, 1, 3, 4, 5]);
    expect(fitToolbar(items, 118).visible).toEqual([0, 1, 4, 5]);
    expect(fitToolbar(items, 58).visible).toEqual([0, 1]);
    expect(fitToolbar(items, 28).visible).toEqual([0]);
  });

  it('does not strand leading, trailing, or duplicate group separators', () => {
    const items = [button(10), separator, button(100), separator, button(20), separator, button(110)];
    expect(fitToolbar(items, 67).visible).toEqual([2, 3, 6]);
    expect(fitToolbar(items, 28).visible).toEqual([6]);
    expect(fitToolbar(items, 0).visible).toEqual([]);
  });

  it('keeps the full remaining row within every available width, including enlarged UI text', () => {
    const items = [button(130), separator, { ...button(150, 92), compactSaving: 36 }, separator,
      button(140), button(110), button(100), button(90), button(50), button(40, 46), separator,
      button(10), button(20), button(80), separator, { ...button(160, 84), compactSaving: 36 },
      button(30), button(70), separator, button(60)];
    for (let available = 0; available < 1000; available++) {
      const result = fitToolbar(items, available);
      const used = result.visible.reduce((sum, index) => sum + items[index].width
        - (result.compact ? items[index].compactSaving ?? 0 : 0), 0)
        + Math.max(0, result.visible.length - 1) * 2;
      expect(used).toBeLessThanOrEqual(available);
    }
  });
});
