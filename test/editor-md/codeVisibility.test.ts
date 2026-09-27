import { afterEach, expect, it, vi } from 'vitest';
import { observeCodeVisibility } from '../../src/features/editor-md/codeVisibility';

class Resize {
  static instances: Resize[] = [];
  observed = new Set<Element>();
  constructor(readonly callback: ResizeObserverCallback) { Resize.instances.push(this); }
  observe(element: Element) { this.observed.add(element); }
  unobserve(element: Element) { this.observed.delete(element); }
  disconnect() { this.observed.clear(); }
  emit() { this.callback([], this as unknown as ResizeObserver); }
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); Resize.instances = []; });

function setup() {
  const frames = new Map<number, FrameRequestCallback>(); let sequence = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { const id = ++sequence; frames.set(id, callback); return id; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
  vi.stubGlobal('ResizeObserver', Resize);
  // This service must still work when IntersectionObserver delivers no entries.
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  const tab = document.createElement('section'), root = document.createElement('div'), editor = document.createElement('div'), block = document.createElement('pre');
  root.dataset.editorScroll = ''; tab.appendChild(root); root.appendChild(editor); editor.appendChild(block); document.body.appendChild(tab);
  let rootHeight = 400, blockTop = 600;
  root.getBoundingClientRect = () => ({ left: 0, right: 800, top: 0, bottom: rootHeight, width: 800, height: rootHeight } as DOMRect);
  block.getBoundingClientRect = () => ({ left: 10, right: 790, top: blockTop, bottom: blockTop + 100, width: 780, height: 100 } as DOMRect);
  const callback = vi.fn(), stop = observeCodeVisibility(editor, block, callback);
  return { tab, root, editor, block, callback, frames,
    rootHeight: (height: number) => { rootHeight = height; }, blockTop: (top: number) => { blockTop = top; },
    flush: async () => { await Promise.resolve(); for (const [id, callback] of [...frames]) { frames.delete(id); callback(16); } },
    destroy: () => { stop(); tab.remove(); },
  };
}

it('activates a block scrolled into view without focus or IntersectionObserver entries', async () => {
  const fixture = setup();
  try {
    await fixture.flush(); expect(fixture.callback.mock.lastCall?.[0].visible).toBe(false);
    fixture.blockTop(80); fixture.root.dispatchEvent(new Event('scroll')); fixture.root.dispatchEvent(new Event('scroll'));
    expect(fixture.frames.size).toBe(1);
    await fixture.flush(); expect(fixture.callback.mock.lastCall?.[0].visible).toBe(true);
    expect(document.activeElement).toBe(document.body);
  } finally { fixture.destroy(); }
});

it('recovers an editor mounted at zero height when asynchronous content/layout arrives', async () => {
  const fixture = setup();
  try {
    fixture.rootHeight(0); fixture.blockTop(20); await fixture.flush();
    expect(fixture.callback.mock.lastCall?.[0].visible).toBe(false);
    fixture.rootHeight(400); Resize.instances[0].emit(); await fixture.flush();
    expect(fixture.callback.mock.lastCall?.[0].visible).toBe(true);
  } finally { fixture.destroy(); }
});

it('reactivates a parked tab at unchanged dimensions and respects a hidden ancestor', async () => {
  const fixture = setup();
  try {
    fixture.blockTop(20); fixture.tab.style.visibility = 'hidden'; fixture.block.style.visibility = 'visible'; await fixture.flush();
    expect(fixture.callback.mock.lastCall?.[0].visible).toBe(false);
    fixture.tab.style.visibility = 'visible'; await fixture.flush();
    expect(fixture.callback.mock.lastCall?.[0].visible).toBe(true);
    fixture.tab.style.visibility = 'hidden'; await fixture.flush();
    expect(fixture.callback.mock.lastCall?.[0].visible).toBe(false);
  } finally { fixture.destroy(); }
  expect(Resize.instances[0].observed.size).toBe(0);
});

it('shares one geometry frame and observer across the controls and syntax subscribers', async () => {
  const fixture = setup(), other = vi.fn();
  const stop = observeCodeVisibility(fixture.editor, fixture.block, other);
  try {
    fixture.blockTop(20); expect(Resize.instances).toHaveLength(1); expect(fixture.frames.size).toBe(1);
    await fixture.flush(); expect(other.mock.lastCall?.[0].visible).toBe(true);
    stop(); fixture.root.dispatchEvent(new Event('scroll')); await fixture.flush();
    expect(other).toHaveBeenCalledTimes(1); expect(fixture.callback).toHaveBeenCalledTimes(2);
  } finally { stop(); fixture.destroy(); }
});
