// @vitest-environment jsdom
import { act, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { useImageWheelGesture, zoomImageAt } from '../../src/features/image-viewer/imageWheelGesture';
import { installMediaGestureBoundary } from '../../src/core/mediaGestures';

describe('image pinch gestures', () => {
  it('keeps the point under the cursor fixed, is reversible and clamps without drift', () => {
    const before = { scale: 1, x: 0, y: 0 }, point = { x: 120, y: -45 };
    const zoomed = zoomImageAt(before, -25, point, .2, 4);
    expect((point.x - zoomed.x) / zoomed.scale).toBeCloseTo(point.x);
    expect((point.y - zoomed.y) / zoomed.scale).toBeCloseTo(point.y);
    const restored = zoomImageAt(zoomed, 25, point, .2, 4);
    expect(restored.scale).toBeCloseTo(1); expect(restored.x).toBeCloseTo(0); expect(restored.y).toBeCloseTo(0);
    expect(zoomImageAt({ scale: 4, x: 20, y: 30 }, -100, point, .2, 4)).toEqual({ scale: 4, x: 20, y: 30 });
  });
  it('cancels native ctrl-wheel browser zoom and composes a rapid pinch stream', async () => {
    const disposeBoundary = installMediaGestureBoundary(document);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    function Fixture() {
      const ref = useRef<HTMLDivElement>(null), [value, setValue] = useState({ scale: 1, x: 0, y: 0 });
      useImageWheelGesture(ref, value, setValue, { min: .2, max: 4, normalWheel: 'pan' });
      return <div ref={ref} data-scale={value.scale}/>;
    }
    const host = document.createElement('div'), root = createRoot(host); document.body.append(host);
    try {
      await act(async () => root.render(<Fixture/>));
      const wheel = () => new WheelEvent('wheel', { ctrlKey: true, deltaY: -10, cancelable: true, bubbles: true });
      const first = wheel(), second = wheel();
      await act(async () => { host.firstElementChild!.dispatchEvent(first); host.firstElementChild!.dispatchEvent(second); });
      expect(first.defaultPrevented).toBe(true); expect(second.defaultPrevented).toBe(true);
      expect(Number(host.firstElementChild!.getAttribute('data-scale'))).toBeCloseTo(Math.exp(.16));
    } finally { disposeBoundary(); await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
  });
  it('leaves ordinary page scrolling native and prevents page zoom outside viewers', () => {
    const dispose = installMediaGestureBoundary(document);
    try {
      const scroll = new WheelEvent('wheel', { deltaY: 120, cancelable: true });
      const pinch = new WheelEvent('wheel', { ctrlKey: true, deltaY: -4, cancelable: true });
      document.dispatchEvent(scroll); document.dispatchEvent(pinch);
      expect(scroll.defaultPrevented).toBe(false); expect(pinch.defaultPrevented).toBe(true);
    } finally { dispose(); }
  });
});
