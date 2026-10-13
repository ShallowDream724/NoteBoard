import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Tooltip, TooltipProvider } from '../../src/components/Tooltip';

let root: Root;
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const trigger = () => document.querySelector('button')!;
const tip = () => document.querySelector('.nb-tooltip-content');
const event = (type: string) => trigger().dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: 50, clientY: 60 }));

it('cancels a pending Radix tooltip on backgrounding and requires a new hover before opening', async () => {
  await act(async () => root.render(<TooltipProvider><Tooltip content="提示"><button>悬停</button></Tooltip></TooltipProvider>));
  await act(async () => { event('pointerover'); event('pointermove'); vi.advanceTimersByTime(50); });
  await act(async () => { window.dispatchEvent(new Event('blur')); vi.advanceTimersByTime(200); });
  expect(tip()).toBeNull();
  await act(async () => { event('pointerout'); event('pointerover'); event('pointermove'); vi.advanceTimersByTime(110); });
  expect(tip()).not.toBeNull();
  await act(async () => window.dispatchEvent(new Event('pagehide')));
  expect(tip()).toBeNull();
});

it('cancels pending and visible cursor tooltips without consuming an outside pointer', async () => {
  await act(async () => root.render(<Tooltip followCursor content="提示"><button>悬停</button></Tooltip>));
  await act(async () => event('mouseover'));
  await act(async () => { window.dispatchEvent(new Event('blur')); vi.advanceTimersByTime(200); });
  expect(tip()).toBeNull();
  await act(async () => { event('mouseout'); event('mouseover'); vi.advanceTimersByTime(110); });
  expect(tip()).not.toBeNull();
  const press = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
  await act(async () => document.body.dispatchEvent(press));
  expect(tip()).toBeNull(); expect(press.defaultPrevented).toBe(false);
});
