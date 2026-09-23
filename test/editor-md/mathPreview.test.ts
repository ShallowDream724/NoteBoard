import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  near: undefined as ((near: boolean, visible: boolean) => void) | undefined,
  renders: [] as { done: (result: { html: string; error?: string }) => void }[],
  retirements: new Map<string, () => void>(),
  evict: undefined as (() => boolean) | undefined,
}));
vi.mock('../../src/features/editor-md/nearViewport', () => ({
  observeNearby: (_host: HTMLElement, callback: NonNullable<typeof state.near>) => {
    state.near = (near, visible) => { callback(near, visible); if (!near) state.evict?.(); };
    return () => {};
  },
  viewportIsScrolling: () => false,
}));
// Force residency pressure here to isolate the geometry contract. Ordinary
// offscreen retention and size budgets are covered by mathPreviewSession tests.
vi.mock('../../src/features/editor-md/mathPreviewSession', () => ({
  registerMathPreview: (_owner: HTMLElement, callbacks: { evict: () => boolean }) => {
    state.evict = callbacks.evict;
    return { nearby() {}, isActive: () => true, preparesBackground: () => false, canMount: () => true, mounted() {}, measured() {}, released() {}, cancelRetirement() {}, dispose() {} };
  },
}));
vi.mock('../../src/features/editor-md/mathRenderQueue', () => ({
  queueMath: (_id: string, request: (typeof state.renders)[number]) => { state.renders.push(request); return () => {}; },
  refreshMathQueue: () => {},
  retireMath: (id: string, done: () => void) => { state.retirements.set(id, done); return () => state.retirements.delete(id); },
}));
import { mountMathPreview } from '../../src/features/editor-md/mathPreview';

class TestResizeObserver {
  static current: TestResizeObserver;
  constructor(private callback: ResizeObserverCallback) { TestResizeObserver.current = this; }
  observe() {}
  unobserve() {}
  disconnect() {}
  notify(target: Element, width: number, height: number) {
    this.callback([{ target, contentRect: { width, height } } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
}

describe('formula preview reclamation geometry', () => {
  const cleanups: (() => void)[] = [];
  beforeEach(() => {
    state.near = undefined; state.renders = []; state.retirements.clear();
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
  });
  afterEach(() => { cleanups.splice(0).forEach(clean => clean()); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  const mount = (display: boolean, result: { html: string; error?: string } = { html: '<span class="katex">fraction</span>' }) => {
    const host = document.createElement('span'); host.style.display = display ? 'block' : 'inline-block'; document.body.append(host);
    cleanups.push(mountMathPreview(host, '\\frac{x}{y}', display, false).dispose);
    state.near!(true, true); state.renders.at(-1)!.done(result);
    return host;
  };

  it('captures baseline only after layout and retains both ascent and descent when retired', () => {
    const measure = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 100 } as DOMRect);
    const host = mount(false), preview = host.firstElementChild!;
    const probe = preview.querySelector<HTMLElement>('[aria-hidden="true"]')!;
    expect(measure).not.toHaveBeenCalled();
    vi.spyOn(probe, 'getBoundingClientRect').mockReturnValue({ top: 166 } as DOMRect);
    TestResizeObserver.current.notify(host, 240, 80);
    expect(measure).toHaveBeenCalledTimes(1);
    state.near!(false, false);
    expect(host.firstElementChild).toBe(preview);
    state.retirements.values().next().value!();
    const strut = host.firstElementChild as HTMLElement;
    expect(strut.style.width).toBe('240px'); expect(strut.style.height).toBe('80px');
    // The sole line ends at 66px, leaving the same 14px descent in the 80px box.
    expect(strut.style.display).toBe('block'); expect(strut.style.lineHeight).toBe('0'); expect(strut.style.fontSize).toBe('0px');
    expect((strut.firstElementChild as HTMLElement).style.height).toBe('66px');
    expect((strut.firstElementChild as HTMLElement).style.verticalAlign).toBe('baseline');
    expect(host.style.width).toBe(''); expect(host.style.height).toBe('');
    expect(measure).toHaveBeenCalledTimes(1);
    state.near!(true, true);
    expect(host.firstElementChild).toBe(strut);
    state.renders.at(-1)!.done({ html: '<span class="katex">fraction</span>' });
    expect(host.querySelector('.katex')).not.toBeNull();
  });

  it('preserves a display formula’s host height and wide horizontal extent', () => {
    const host = mount(true), preview = host.firstElementChild!;
    TestResizeObserver.current.notify(preview, 900, 72);
    TestResizeObserver.current.notify(host, 600, 80);
    state.near!(false, false); state.retirements.values().next().value!();
    const strut = host.firstElementChild as HTMLElement;
    expect(strut.style.display).toBe('block'); expect(strut.style.width).toBe('900px'); expect(strut.style.height).toBe('80px');
    expect(host.style.width).toBe('');
  });

  it('takes an error preview baseline from its final smaller-font line', () => {
    const host = mount(false, { html: '<span class="katex-error">invalid</span>', error: 'Invalid formula' });
    const error = host.querySelector<HTMLElement>('[role="status"]')!, probe = error.querySelector<HTMLElement>('[aria-hidden="true"]')!;
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ top: 100 } as DOMRect);
    vi.spyOn(probe, 'getBoundingClientRect').mockReturnValue({ top: 158 } as DOMRect);
    TestResizeObserver.current.notify(host, 240, 60);
    state.near!(false, false); state.retirements.values().next().value!();
    const placeholder = host.firstElementChild as HTMLElement;
    expect(placeholder.style.height).toBe('60px'); expect(placeholder.style.fontSize).toBe('0px');
    expect((placeholder.firstElementChild as HTMLElement).style.height).toBe('58px');
  });

  it('cancels retirement on a quick return and retains unmeasured markup', () => {
    const host = mount(false), preview = host.firstElementChild;
    state.near!(false, false); expect(state.retirements.size).toBe(0);
    expect(host.firstElementChild).toBe(preview);
    state.near!(true, true); TestResizeObserver.current.notify(host, 240, 80);
    state.near!(false, false); expect(state.retirements.size).toBe(1);
    state.near!(true, true); expect(state.retirements.size).toBe(0);
    expect(host.firstElementChild).toBe(preview);
  });

  it('keeps the same preview DOM when entering and leaving source editing', () => {
    const host = document.createElement('span'); document.body.append(host);
    const preview = mountMathPreview(host, 'x', false, false); cleanups.push(preview.dispose);
    state.near!(true, true); state.renders.at(-1)!.done({ html: '<span class="katex">x</span>' });
    const element = host.firstElementChild;
    preview.setEditing(true); preview.setEditing(false);
    expect(host.firstElementChild).toBe(element); expect(state.renders).toHaveLength(1);
  });
});
