import { afterEach, expect, it, vi } from 'vitest';
import { observeNearby } from '../../src/features/editor-md/nearViewport';

class Observer {
  static instances: Observer[] = [];
  disconnected = false;
  constructor(private callback: IntersectionObserverCallback, readonly options: IntersectionObserverInit) { Observer.instances.push(this); }
  observe() {}
  unobserve() {}
  disconnect() { this.disconnected = true; }
  emit(element: HTMLElement, intersecting: boolean) {
    this.callback([{ target: element, isIntersecting: intersecting } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

afterEach(() => { Observer.instances = []; vi.unstubAllGlobals(); });

it('reports the initial offscreen result and keeps visible blocks nearby during observer overlap', () => {
  vi.stubGlobal('IntersectionObserver', Observer);
  const root = document.createElement('div'); root.dataset.editorScroll = '';
  Object.defineProperty(root, 'clientHeight', { configurable: true, value: 400 });
  const block = document.createElement('pre'); root.appendChild(block); document.body.appendChild(root);
  const callback = vi.fn(); const cleanup = observeNearby(block, callback);
  try {
    const [near, visible] = Observer.instances;
    visible.emit(block, false);
    expect(callback).not.toHaveBeenCalled();
    near.emit(block, false);
    expect(callback).toHaveBeenLastCalledWith(false, false);
    visible.emit(block, true);
    expect(callback).toHaveBeenLastCalledWith(true, true);
    near.emit(block, false);
    expect(callback).toHaveBeenCalledTimes(2);
    visible.emit(block, false);
    expect(callback).toHaveBeenLastCalledWith(false, false);
  } finally { cleanup(); root.remove(); }
  expect(Observer.instances.every(observer => observer.disconnected)).toBe(true);
});

it('does not treat a hidden tab as leaving the nearby viewport', () => {
  vi.stubGlobal('IntersectionObserver', Observer);
  const root = document.createElement('div'); root.dataset.editorScroll = '';
  let height = 400; Object.defineProperty(root, 'clientHeight', { get: () => height });
  const block = document.createElement('pre'); root.appendChild(block); document.body.appendChild(root);
  const callback = vi.fn(); const cleanup = observeNearby(block, callback);
  try {
    const [near, visible] = Observer.instances;
    near.emit(block, true); visible.emit(block, true);
    callback.mockClear(); height = 0;
    near.emit(block, false); visible.emit(block, false);
    expect(callback).not.toHaveBeenCalled();
    height = 400; near.emit(block, true); visible.emit(block, true);
    expect(callback).not.toHaveBeenCalled();
  } finally { cleanup(); root.remove(); }
});
