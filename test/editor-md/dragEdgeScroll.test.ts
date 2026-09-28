import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDragEdgeScroller } from '@/features/editor-md/dragEdgeScroll';

afterEach(() => vi.unstubAllGlobals());

function harness(limit = 500) {
  let nextId = 0, position = 0;
  const pending = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++nextId; pending.set(id, callback); return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { pending.delete(id); });
  const element = document.createElement('div');
  Object.defineProperty(element, 'scrollTop', {
    get: () => position,
    set: (value: number) => { position = Math.max(0, Math.min(limit, value)); },
  });
  const step = (time: number) => {
    const entry = pending.entries().next().value as [number, FrameRequestCallback] | undefined;
    if (!entry) throw new Error('No pending animation frame');
    pending.delete(entry[0]); entry[1](time);
  };
  return { element, pending, step, position: () => position };
}

describe('drag edge scrolling', () => {
  it('keeps scrolling and refreshing the target under a stationary edge pointer', () => {
    const { element, pending, step, position } = harness();
    const targets: number[] = [];
    const scroller = createDragEdgeScroller([{ element, direction: 'y', edge: 40, maxSpeed: 800,
      bounds: () => ({ start: 0, end: 200 }),
    }], () => targets.push(position()));
    scroller.update(50, 195);
    step(16); step(32); step(48);
    expect(position()).toBeGreaterThan(0);
    expect(targets).toHaveLength(3);
    expect(targets[2]).toBeGreaterThan(targets[1]);
    scroller.update(50, 100);
    step(64);
    expect(pending.size).toBe(0);
    scroller.stop();
  });

  it('bounds delayed frames and stops at the scroll limit or on cancellation', () => {
    const { element, pending, step, position } = harness(30);
    const onFrame = vi.fn();
    const scroller = createDragEdgeScroller([{ element, direction: 'y', edge: 40, maxSpeed: 800,
      bounds: () => ({ start: 0, end: 200 }),
    }], onFrame);
    scroller.update(50, 200);
    step(16); const before = position();
    step(10_000);
    expect(position() - before).toBeLessThanOrEqual(800 * .032);
    let time = 10_016;
    while (pending.size) { step(time); time += 16; }
    expect(position()).toBe(30);
    expect(pending.size).toBe(0);
    scroller.update(50, 195);
    expect(pending.size).toBe(1);
    scroller.stop();
    expect(pending.size).toBe(0);
    expect(onFrame).toHaveBeenCalled();
  });

  it('does not schedule another frame after cleanup inside target refresh', () => {
    const { element, pending, step } = harness();
    const scroller = createDragEdgeScroller([{ element, direction: 'y', edge: 40, maxSpeed: 800,
      bounds: () => ({ start: 0, end: 200 }),
    }], () => scroller.stop());
    scroller.update(50, 195);
    step(16);
    expect(pending.size).toBe(0);
  });
});
