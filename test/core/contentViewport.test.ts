import { afterEach, describe, expect, it, vi } from 'vitest';
import { clientBounds, CONTENT_VIEW_CHANGED, contentViewport, observeContentViewport } from '../../src/core/dom/contentViewport';

function box(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON: () => ({}) };
}
function element(parent: HTMLElement, rect: DOMRect, overflowX = 'visible', overflowY = 'visible') {
  const next = document.createElement('div'); parent.append(next);
  next.style.overflowX = overflowX; next.style.overflowY = overflowY;
  vi.spyOn(next, 'getBoundingClientRect').mockReturnValue(rect);
  return next;
}
function dimensions(target: HTMLElement, values: Partial<Record<'offsetWidth' | 'offsetHeight' | 'clientLeft' | 'clientTop' | 'clientWidth' | 'clientHeight', number>>) {
  Object.entries(values).forEach(([name, value]) => Object.defineProperty(target, name, { configurable: true, value }));
}
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('content viewport geometry', () => {
  it('excludes borders and scrollbar gutters in scaled screen coordinates', () => {
    const target = element(document.body, box(100, 50, 600, 300));
    dimensions(target, { offsetWidth: 300, offsetHeight: 150, clientLeft: 3, clientTop: 2, clientWidth: 280, clientHeight: 130 });
    expect(clientBounds(target)).toEqual({ left: 106, top: 54, right: 666, bottom: 314, width: 560, height: 260 });
  });

  it('uses the browser viewport for the root instead of the scrolled document rectangle', () => {
    vi.stubGlobal('innerWidth', 800); vi.stubGlobal('innerHeight', 600);
    vi.spyOn(document.documentElement, 'getBoundingClientRect').mockReturnValue(box(-30, -400, 1200, 3000));
    expect(clientBounds(document.documentElement)).toEqual({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 });
  });

  it('intersects nested clips per axis and chooses the nearest scroll owner independently', () => {
    const boundary = element(document.body, box(0, 0, 800, 600), 'auto', 'auto'); boundary.dataset.editorScroll = 'true';
    const horizontalClip = element(boundary, box(100, 5, 500, 590), 'hidden');
    const verticalOwner = element(horizontalClip, box(80, 50, 620, 450), 'visible', 'auto');
    const horizontalOwner = element(verticalOwner, box(130, 30, 300, 550), 'scroll');
    const target = element(horizontalOwner, box(-100, -200, 1500, 2000));
    const viewport = contentViewport(target);
    expect(viewport.bounds).toEqual({ left: 130, right: 430, top: 50, bottom: 500, width: 300, height: 450 });
    expect(viewport.scrollX).toBe(horizontalOwner);
    expect(viewport.scrollY).toBe(verticalOwner);
    expect(viewport.outer).toEqual({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 });
  });

  it('clips hidden ancestors without choosing them as scroll owners and stops at the declared boundary', () => {
    const ignored = element(document.body, box(300, 300, 1, 1), 'scroll', 'scroll');
    const boundary = element(ignored, box(10, 20, 600, 500));
    const farOwner = element(boundary, box(20, 30, 500, 400), 'auto', 'auto');
    const nearOwner = element(farOwner, box(40, 50, 450, 350), 'visible', 'scroll');
    const clip = element(nearOwner, box(60, 70, 400, 300), 'clip', 'hidden');
    const target = element(clip, box(0, 0, 1000, 1000));
    const viewport = contentViewport(target, boundary);
    expect(viewport.bounds).toEqual({ left: 60, right: 460, top: 70, bottom: 370, width: 400, height: 300 });
    expect(viewport.scrollX).toBe(farOwner);
    expect(viewport.scrollY).toBe(nearOwner);
  });

  it('constrains the document owner to the window and returns an empty extent for disjoint clips', () => {
    vi.stubGlobal('innerWidth', 800); vi.stubGlobal('innerHeight', 600);
    const boundary = element(document.body, box(-40, -30, 1100, 850));
    const host = element(boundary, box(-100, -100, 1200, 900));
    const target = element(host, box(0, 0, 2000, 2000));
    expect(contentViewport(target, boundary).bounds).toEqual({ left: 0, right: 800, top: 0, bottom: 600, width: 800, height: 600 });
    host.style.overflowX = 'hidden';
    vi.mocked(host.getBoundingClientRect).mockReturnValue(box(900, 0, 100, 600));
    const clipped = contentViewport(target, boundary);
    expect(clipped.bounds.width).toBe(0);
    expect(clipped.bounds.height).toBe(600);
    expect(clipped.scrollX).toBe(boundary);
    expect(clipped.scrollY).toBe(boundary);
  });
});

describe('content viewport subscriptions', () => {
  it('shares ancestor observers, reacts to later reading-mode changes and releases every subscription', () => {
    let resized: ResizeObserverCallback = () => {};
    const observe = vi.fn(), unobserve = vi.fn(), disconnect = vi.fn();
    const resizeObserver = { observe, unobserve, disconnect } as unknown as ResizeObserver;
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { resized = callback; }
      observe = observe; unobserve = unobserve; disconnect = disconnect;
    });
    const boundary = element(document.body, box(0, 0, 800, 600));
    const host = element(boundary, box(20, 20, 700, 500));
    const target = element(host, box(20, 20, 700, 500));
    const first = vi.fn(), second = vi.fn();
    const stopFirst = observeContentViewport(target, first, boundary);
    const stopSecond = observeContentViewport(target, second, boundary);
    expect(observe.mock.calls.map(([observed]) => observed)).toEqual([host, boundary]);

    host.style.overflowY = 'auto';
    host.dispatchEvent(new Event(CONTENT_VIEW_CHANGED));
    host.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));
    expect(first).toHaveBeenCalledTimes(3); expect(second).toHaveBeenCalledTimes(3);
    resized([host, boundary].map(target => ({ target, contentRect: target.getBoundingClientRect(),
      borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [],
    })), resizeObserver);
    expect(first).toHaveBeenCalledTimes(4); expect(second).toHaveBeenCalledTimes(4);

    stopFirst();
    expect(unobserve).not.toHaveBeenCalled();
    host.dispatchEvent(new Event('scroll'));
    expect(first).toHaveBeenCalledTimes(4); expect(second).toHaveBeenCalledTimes(5);
    stopSecond();
    expect(unobserve.mock.calls.map(([observed]) => observed)).toEqual([host, boundary]);
    expect(disconnect).toHaveBeenCalledOnce();
    host.dispatchEvent(new Event(CONTENT_VIEW_CHANGED));
    host.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));
    expect(second).toHaveBeenCalledTimes(5);
  });
});
