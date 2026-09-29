import { afterEach, describe, expect, it, vi } from 'vitest';
import { clientBounds } from '../../src/core/dom/contentViewport';
import { preserveReadingAnchor } from '../../src/core/dom/readingAnchor';

function fixture(pageScale = 1, scale = 1, border = 0) {
  const page = document.createElement('div'); page.dataset.editorScroll = 'true';
  const viewport = document.createElement('div'); page.append(viewport); document.body.append(page);
  const layout = { left: 150, top: 2500, width: 600, height: 2000 };
  Object.defineProperties(page, {
    offsetWidth: { get: () => 800 }, offsetHeight: { get: () => 600 },
    clientWidth: { get: () => 800 }, clientHeight: { get: () => 600 },
  });
  Object.defineProperties(viewport, {
    offsetWidth: { get: () => layout.width }, offsetHeight: { get: () => layout.height },
    clientLeft: { get: () => border }, clientTop: { get: () => border },
    clientWidth: { get: () => layout.width - border * 2 }, clientHeight: { get: () => layout.height - border * 2 },
  });
  vi.spyOn(page, 'getBoundingClientRect').mockImplementation(() => new DOMRect(100, 100, 800 * pageScale, 600 * pageScale));
  vi.spyOn(viewport, 'getBoundingClientRect').mockImplementation(() => new DOMRect(
    layout.left - page.scrollLeft * pageScale, layout.top - page.scrollTop * pageScale,
    layout.width * scale, layout.height * scale,
  ));
  const visibleContentPoint = (x: number, y: number) => {
    const bounds = clientBounds(viewport);
    return { x: bounds.left + (x - viewport.scrollLeft) * scale, y: bounds.top + (y - viewport.scrollTop) * scale };
  };
  return { page, viewport, layout, visibleContentPoint };
}
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('reading mode content anchor', () => {
  it('moves a deeply visible content offset into the local scroller when preceding tables collapse', () => {
    const { page, viewport, layout, visibleContentPoint } = fixture();
    page.scrollTop = 3200;
    const before = visibleContentPoint(0, 800);
    expect(before.y).toBe(100);
    const change = vi.fn(() => {
      layout.top = 1100; layout.height = 400;
      viewport.style.overflowY = 'auto';
    });
    preserveReadingAnchor(viewport, change);
    expect(change).toHaveBeenCalledOnce();
    expect(viewport.scrollTop).toBe(800);
    expect(page.scrollTop).toBe(1000);
    expect(visibleContentPoint(0, 800)).toEqual(before);
  });

  it('moves the local offset back into the page when preceding tables expand', () => {
    const { page, viewport, layout, visibleContentPoint } = fixture();
    layout.top = 1100; layout.height = 400;
    page.scrollTop = 1000; viewport.scrollTop = 800; viewport.style.overflowY = 'auto';
    const before = visibleContentPoint(0, 800);
    preserveReadingAnchor(viewport, () => {
      layout.top = 2500; layout.height = 2000;
      viewport.style.overflowY = 'visible'; viewport.scrollTop = 0;
    });
    expect(page.scrollTop).toBe(3200);
    expect(viewport.scrollTop).toBe(0);
    expect(visibleContentPoint(0, 800)).toEqual(before);
  });

  it('transfers horizontal offsets in CSS pixels across differently scaled page and content geometry', () => {
    const { page, viewport, layout, visibleContentPoint } = fixture(1.25, 2, 5);
    page.scrollLeft = 1000;
    layout.left = 940; layout.top = 150; layout.height = 300;
    const before = visibleContentPoint(200, 0);
    expect(before.x).toBe(100);
    preserveReadingAnchor(viewport, () => {
      layout.left = 740; layout.width = 300;
      viewport.style.overflowX = 'scroll';
    });
    expect(viewport.scrollLeft).toBe(200);
    expect(page.scrollLeft).toBe(520);
    expect(page.scrollTop).toBe(0);
    expect(visibleContentPoint(200, 0)).toEqual(before);

    preserveReadingAnchor(viewport, () => {
      layout.left = 940; layout.width = 600;
      viewport.style.overflowX = 'visible'; viewport.scrollLeft = 0;
    });
    expect(page.scrollLeft).toBe(1000);
    expect(viewport.scrollLeft).toBe(0);
    expect(visibleContentPoint(200, 0)).toEqual(before);
  });

  it.each([
    ['above', 150, -2100], ['below', 150, 700], ['left', -600, 150], ['right', 900, 150],
  ] as const)('only changes presentation for a viewport entirely %s the page', (_side, left, top) => {
    const { page, viewport, layout } = fixture();
    layout.left = left; layout.top = top;
    const writes = [page, viewport].flatMap(element => [vi.spyOn(element, 'scrollLeft', 'set'), vi.spyOn(element, 'scrollTop', 'set')]);
    const change = vi.fn(() => { viewport.style.overflow = 'auto'; });
    preserveReadingAnchor(viewport, change);
    expect(change).toHaveBeenCalledOnce();
    writes.forEach(write => expect(write).not.toHaveBeenCalled());
  });

  it('runs the change for null and detached targets without measuring or scrolling', () => {
    const { page, viewport } = fixture(); viewport.remove();
    const pageMeasure = vi.mocked(page.getBoundingClientRect), measure = vi.mocked(viewport.getBoundingClientRect);
    const change = vi.fn();
    preserveReadingAnchor(null, change);
    preserveReadingAnchor(viewport, change);
    expect(change).toHaveBeenCalledTimes(2);
    expect(pageMeasure).not.toHaveBeenCalled(); expect(measure).not.toHaveBeenCalled();
    expect(page.scrollTop).toBe(0); expect(page.scrollLeft).toBe(0);
    expect(viewport.scrollTop).toBe(0); expect(viewport.scrollLeft).toBe(0);
  });
});
