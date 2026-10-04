import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Tooltip, TooltipProvider } from '@/components/Tooltip';
import { setShortcutOverrides } from '@/core/shortcutBindings';
import { HoverMenuContext } from '@/components/useHoverMenu';

let root: Root;
const rich = () => document.querySelector('[data-help-key="block.disclosure"]');
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  setShortcutOverrides({}); document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals();
});

it('mounts an explanation only after sustained hover and releases it on Escape without moving focus', async () => {
  await act(async () => root.render(<TooltipProvider><Tooltip content="折叠块" helpKey="block.disclosure"><button>折叠块</button></Tooltip></TooltipProvider>));
  const trigger = document.querySelector('button')!;
  expect(rich()).toBeNull();
  await act(async () => { trigger.dispatchEvent(new MouseEvent('pointermove', { bubbles: true })); vi.advanceTimersByTime(640); });
  expect(rich()).toBeNull();
  await act(async () => { vi.advanceTimersByTime(20); });
  expect(rich()).not.toBeNull();
  expect(document.activeElement).toBe(document.body);
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(rich()).toBeNull();
});

it('shows the current custom binding on keyboard focus and hides a removed binding', async () => {
  setShortcutOverrides({ 'markdown.heading1': ['Ctrl+Alt+H'] });
  await act(async () => root.render(<TooltipProvider><Tooltip content="标题 1" shortcut="Ctrl+1"><button>标题 1</button></Tooltip></TooltipProvider>));
  const trigger = document.querySelector('button')!;
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })); trigger.focus(); });
  expect(document.querySelector('.nb-tooltip-kbd')?.textContent).toBe('Ctrl + Alt + H');
  expect(document.activeElement).toBe(trigger);
  await act(async () => setShortcutOverrides({ 'markdown.heading1': [] }));
  expect(document.querySelector('.nb-tooltip-kbd')).toBeNull();
});

it('keeps the owning menu alive while reading a portalled explanation and dismisses without focusing it', async () => {
  const cancel = vi.fn(), leave = vi.fn();
  await act(async () => root.render(<TooltipProvider><HoverMenuContext.Provider value={{ cancel, leave }}>
    <Tooltip content="折叠块" helpKey="block.disclosure"><button>折叠块</button></Tooltip>
  </HoverMenuContext.Provider></TooltipProvider>));
  const trigger = document.querySelector('button')!;
  await act(async () => { trigger.dispatchEvent(new MouseEvent('pointermove', { bubbles: true })); vi.advanceTimersByTime(660); });
  const card = document.querySelector('.nb-contextual-help-content')!;
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: card }));
    card.dispatchEvent(new MouseEvent('pointerover', { bubbles: true, relatedTarget: trigger }));
  });
  expect(cancel).toHaveBeenCalled(); expect(rich()).not.toBeNull();
  const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
  await act(async () => card.dispatchEvent(down));
  expect(down.defaultPrevented).toBe(true); expect(rich()).toBeNull();
  expect(document.activeElement).toBe(document.body);
});
