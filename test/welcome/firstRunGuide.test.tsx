import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { FirstRunGuide } from '@/features/welcome/FirstRunGuide';

describe('first-run guide', () => {
  it('keeps editing focus and progress, and supports skipping or completing the guide', () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const container = document.createElement('div');
    const input = document.createElement('input');
    document.body.append(input, container);
    input.focus();
    const root = createRoot(container);
    const dismiss = vi.fn();
    const render = (active: boolean) => act(() => root.render(<FirstRunGuide active={active} onDismiss={dismiss} />));
    const click = (text: string) => {
      const button = [...container.querySelectorAll('button')].find(button => button.textContent === text)!;
      act(() => button.click());
    };
    try {
      render(true);
      expect(document.activeElement).toBe(input);
      expect(container.textContent).toContain('左上角');
      click('下一步');
      expect(container.textContent).toContain('六点把手');
      render(false);
      expect(container.childElementCount).toBe(0);
      render(true);
      expect(container.textContent).toContain('2 / 3');
      click('下一步');
      expect(container.textContent).toContain('图钉固定');
      click('跳过');
      expect(dismiss).toHaveBeenCalledOnce();
      click('开始体验');
      expect(dismiss).toHaveBeenCalledTimes(2);
    } finally {
      act(() => root.unmount());
      container.remove();
      input.remove();
      vi.unstubAllGlobals();
    }
  });
});
