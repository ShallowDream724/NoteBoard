import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PanelImperativeHandle, PanelSize } from 'react-resizable-panels';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRememberedPanelSize } from '../../src/components/useRememberedPanelSize';

let controls: ReturnType<typeof useRememberedPanelSize>;
let root: Root, container: HTMLDivElement;
let nextFrame = 0;
const frames = new Map<number, FrameRequestCallback>();
const size = (inPixels: number): PanelSize => ({ inPixels, asPercentage: inPixels / 10 });
const flushFrames = () => {
  const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0));
};
function Fixture({ width = 260, enabled = true }: { width?: number; enabled?: boolean }) {
  controls = useRememberedPanelSize(width, enabled); return null;
}
const render = async (width: number, enabled = true) => act(async () => {
  root.render(<StrictMode><Fixture width={width} enabled={enabled}/></StrictMode>);
});
const handle = () => ({ resize: vi.fn(), getSize: vi.fn(() => { throw new Error('Layout not found for Panel nb-explorer'); }) }) as unknown as PanelImperativeHandle;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => { frames.delete(frame); });
  container = document.body.appendChild(document.createElement('div')); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); frames.clear(); vi.unstubAllGlobals();
});

describe('remembered panel size lifecycle', () => {
  it('waits for the panel measurement before applying the latest asynchronous preference', async () => {
    const panel = handle(); await render(260); controls.panelRef(panel);
    await render(420); flushFrames();
    expect(panel.resize).not.toHaveBeenCalled(); expect(panel.getSize).not.toHaveBeenCalled();
    controls.onResize(size(260), 'nb-explorer', undefined);
    expect(panel.resize).not.toHaveBeenCalled();
    await render(380); flushFrames();
    expect(panel.resize).toHaveBeenCalledExactlyOnceWith(380); expect(panel.getSize).not.toHaveBeenCalled();
    controls.onResize(size(380), 'nb-explorer', size(260)); flushFrames();
    expect(panel.resize).toHaveBeenCalledTimes(1); expect(frames.size).toBe(0);
  });

  it('cancels queued work when detached and requires a fresh measurement on each attachment', async () => {
    const first = handle(), second = handle(); await render(400);
    controls.panelRef(first); controls.onResize(size(260), 'nb-explorer', undefined);
    controls.panelRef(null); controls.panelRef(second); flushFrames();
    expect(first.resize).not.toHaveBeenCalled(); expect(second.resize).not.toHaveBeenCalled();
    controls.onResize(size(260), 'nb-explorer', size(260)); flushFrames();
    expect(second.resize).toHaveBeenCalledExactlyOnceWith(400);
    expect(first.getSize).not.toHaveBeenCalled(); expect(second.getSize).not.toHaveBeenCalled();
  });

  it('does not fight a user resize and cancels pending restoration while disabled or unmounted', async () => {
    const panel = handle(); await render(260); controls.panelRef(panel);
    controls.onResize(size(260), 'nb-explorer', undefined); flushFrames();
    controls.onResize(size(330), 'nb-explorer', size(260)); flushFrames();
    expect(panel.resize).not.toHaveBeenCalled();
    await render(330); flushFrames(); expect(panel.resize).not.toHaveBeenCalled();
    await render(420); expect(frames.size).toBe(1);
    await render(420, false); flushFrames(); expect(panel.resize).not.toHaveBeenCalled();
    await render(420); expect(frames.size).toBe(1);
    await act(async () => root.render(null)); flushFrames(); expect(panel.resize).not.toHaveBeenCalled();
  });

  it('restores a width constrained by a smaller group without retrying an impossible width', async () => {
    const panel = handle(); await render(480); controls.panelRef(panel);
    controls.onResize({ inPixels:480, asPercentage:40 }, 'nb-explorer', undefined); flushFrames();
    controls.onResize({ inPixels:420, asPercentage:70 }, 'nb-explorer', { inPixels:480, asPercentage:40 }); flushFrames();
    expect(panel.resize).toHaveBeenCalledExactlyOnceWith(480);
    controls.onResize({ inPixels:420, asPercentage:70 }, 'nb-explorer', { inPixels:420, asPercentage:70 }); flushFrames();
    expect(panel.resize).toHaveBeenCalledTimes(1); expect(frames.size).toBe(0);
    controls.onResize({ inPixels:420, asPercentage:35 }, 'nb-explorer', { inPixels:420, asPercentage:70 }); flushFrames();
    expect(panel.resize).toHaveBeenCalledTimes(2);
    controls.onResize({ inPixels:480, asPercentage:40 }, 'nb-explorer', { inPixels:420, asPercentage:35 }); flushFrames();
    expect(panel.resize).toHaveBeenCalledTimes(2); expect(frames.size).toBe(0);
  });

  it('ignores zero-size hidden groups until a usable measurement is available', async () => {
    const panel = handle(); await render(400); controls.panelRef(panel);
    controls.onResize({ inPixels:0, asPercentage:NaN }, 'nb-explorer', undefined); flushFrames();
    await render(420); flushFrames(); expect(panel.resize).not.toHaveBeenCalled();
    controls.onResize(size(260), 'nb-explorer', { inPixels:0, asPercentage:NaN }); flushFrames();
    expect(panel.resize).toHaveBeenCalledExactlyOnceWith(420);
  });

  it('does not mistake pane rounding during a drag for a changed group width', async () => {
    const panel = handle(); await render(393); controls.panelRef(panel);
    const previous = { inPixels:393, asPercentage:393 / 1198 * 100 };
    controls.onResize(previous, 'nb-explorer', undefined); flushFrames();
    controls.onResize({ inPixels:394, asPercentage:394 / 1199 * 100 }, 'nb-explorer', previous); flushFrames();
    expect(panel.resize).not.toHaveBeenCalled(); expect(frames.size).toBe(0);
  });
});
