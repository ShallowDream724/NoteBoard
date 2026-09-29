import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTENT_VIEW_CHANGED } from '../../src/core/dom/contentViewport';
import { mountMathReadingLayout } from '../../src/features/editor-md/mathReadingLayout';

const rendering = vi.hoisted(() => ({ requests: [] as {
  latex: string; display: boolean; done: (value: { html: string; error?: string }) => void;
  cancel: ReturnType<typeof vi.fn>;
}[] }));
vi.mock('../../src/features/editor-md/mathRenderQueue', () => ({
  queueMath: (_id: string, request: Omit<(typeof rendering.requests)[number], 'cancel'>) => {
    const cancel = vi.fn(); rendering.requests.push({ ...request, cancel }); return cancel;
  },
}));
vi.mock('../../src/features/editor-md/nearViewport', () => ({ viewportIsScrolling: () => false }));

class TestResizeObserver implements ResizeObserver {
  static instances: TestResizeObserver[] = [];
  readonly targets = new Set<Element>();
  readonly observe = vi.fn((target: Element) => { this.targets.add(target); });
  readonly unobserve = vi.fn((target: Element) => { this.targets.delete(target); });
  readonly disconnect = vi.fn(() => { this.targets.clear(); });
  constructor(private readonly callback: ResizeObserverCallback) { TestResizeObserver.instances.push(this); }
  static notify(target: Element) {
    for (const observer of this.instances) if (observer.targets.has(target)) {
      observer.callback([{ target } as ResizeObserverEntry], observer);
    }
  }
}

const markup = (label: string, width: number) => ({
  html: `<span class="katex-html"><span class="base" data-math-width="${width}">${label}</span></span>`,
});
const longFormula = Array.from({ length: 24 }, (_, index) => `a_{${index}}^2`).join('+');
const frames = new Map<number, FrameRequestCallback>();
const cleanups = new Set<() => void>();
let nextFrame = 0;
function flushFrame() {
  const current = [...frames.values()]; frames.clear(); current.forEach(callback => callback(0));
}
async function settle() { for (let i = 0; i < 6; i++) await Promise.resolve(); }

function mount({ display = true, mode = 'wrap', latex = longFormula, width = 160 } = {}) {
  const owner = document.createElement('div'); owner.dataset.formulaReading = mode;
  const paragraph = document.createElement('p'), node = document.createElement('span'); node.className = 'math-node';
  const renderer = document.createElement('span'); renderer.className = 'react-renderer node-mathInline'; renderer.style.display = 'inline';
  // Inline spans have no client box even though their visual rectangle follows
  // the formula. The paragraph supplies the available reading width.
  Object.defineProperties(renderer, { clientWidth: { value: 0 }, offsetWidth: { value: 640 } });
  renderer.dataset.mathWidth = '640';
  const host = document.createElement('span'), preview = document.createElement('span');
  host.style.fontSize = '16px'; preview.innerHTML = markup('original', 640).html;
  host.append(preview); node.append(host);
  if (display) paragraph.append(node);
  else { renderer.append(node); paragraph.append(renderer); }
  owner.append(paragraph); document.body.append(owner);
  const block = display ? node : paragraph;
  let currentWidth = width;
  Object.defineProperties(block, {
    clientWidth: { configurable: true, get: () => currentWidth },
    offsetWidth: { configurable: true, get: () => currentWidth },
  });
  vi.spyOn(block, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, currentWidth, 80));
  const removeListener = vi.spyOn(owner, 'removeEventListener');
  const controller = mountMathReadingLayout({ host, preview, owner, display, latex, original: markup('original', 640) });
  const dispose = () => { controller.dispose(); cleanups.delete(dispose); }; cleanups.add(dispose);
  controller.nearby(true); flushFrame();
  return { controller, owner, block, renderer, preview, dispose, removeListener,
    resize(value: number) { currentWidth = value; TestResizeObserver.notify(block); },
    mode(value: string) { owner.dataset.formulaReading = value; owner.dispatchEvent(new Event(CONTENT_VIEW_CHANGED)); },
  };
}

describe('formula reading layout lifecycle', () => {
  beforeEach(() => {
    rendering.requests = []; TestResizeObserver.instances = []; frames.clear(); nextFrame = 0;
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((frame: number) => { frames.delete(frame); }));
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return new DOMRect(0, 0, Number(this.dataset.mathWidth ?? 0), 20);
    });
  });
  afterEach(async () => {
    [...cleanups].forEach(dispose => dispose()); await settle();
    expect(TestResizeObserver.instances.every(observer => observer.targets.size === 0)).toBe(true);
    expect(frames.size).toBe(0);
    document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  });

  it('cancels queued candidates on mode changes and ignores a late completion', async () => {
    const view = mount(), pending = rendering.requests[0];
    expect(pending.latex).toContain(String.raw`\begin{gathered}`);
    view.mode('expand'); flushFrame();
    expect(pending.cancel).toHaveBeenCalledOnce();
    pending.done(markup('stale', 100)); await settle();
    expect(view.preview.textContent).toBe('original');
    expect(view.preview.style.zoom).toBe('');
    expect(rendering.requests).toHaveLength(1);
  });

  it('rejects a completed candidate when reading mode changes before its promise continuation', async () => {
    const view = mount();
    rendering.requests[0].done(markup('stale', 100));
    view.mode('expand');
    await settle();
    expect(view.preview.textContent).toBe('original');
    expect(view.preview.style.zoom).toBe('');
    flushFrame();
  });

  it('retries an inline candidate after switching between two modes that both wrap it', async () => {
    const view = mount({ display: false });
    rendering.requests[0].done(markup('previous mode', 100));
    view.mode('scroll'); await settle();
    expect(view.preview.textContent).toBe('original');
    flushFrame(); expect(rendering.requests).toHaveLength(2);
    rendering.requests[1].done(markup('current mode', 100)); await settle();
    expect(view.preview.textContent).toBe('current mode'); expect(view.preview.style.zoom).toBe('');
  });

  it('keeps source editing at natural size even when a candidate just finished rendering', async () => {
    const view = mount();
    rendering.requests[0].done(markup('stale', 100));
    view.controller.editing(true); await settle(); flushFrame();
    expect(view.preview.textContent).toBe('original'); expect(view.preview.style.zoom).toBe('');
    expect(rendering.requests).toHaveLength(1);
    view.controller.editing(false); flushFrame();
    expect(rendering.requests).toHaveLength(2);
    rendering.requests[1].done(markup('reading', 100)); await settle();
    expect(view.preview.textContent).toBe('reading');
  });

  it('cancels pending work on destruction and never applies its late markup or fitting', async () => {
    const view = mount(), pending = rendering.requests[0];
    view.dispose();
    expect(pending.cancel).toHaveBeenCalledOnce();
    pending.done(markup('destroyed', 900)); await settle();
    expect(view.preview.textContent).toBe('original'); expect(view.preview.style.zoom).toBe('');
    expect(rendering.requests).toHaveLength(1);
  });

  it('uses the paragraph width around a zero-client-width inline renderer, while display scroll stays natural', async () => {
    const inline = mount({ display: false, mode: 'scroll' });
    expect(inline.renderer.clientWidth).toBe(0); expect(inline.block.clientWidth).toBe(160);
    expect(TestResizeObserver.instances[0].targets.has(inline.block)).toBe(true);
    expect(TestResizeObserver.instances[0].targets.has(inline.renderer)).toBe(false);
    expect(rendering.requests).toHaveLength(1); expect(rendering.requests[0].display).toBe(false);
    expect(rendering.requests[0].latex).toContain(String.raw`\begin{gathered}`);
    rendering.requests[0].done(markup('wrapped inline', 120)); await settle();
    expect(inline.preview.textContent).toBe('wrapped inline'); expect(inline.preview.style.zoom).toBe('');
    const display = mount({ mode: 'scroll' });
    expect(rendering.requests).toHaveLength(1); expect(display.preview.textContent).toBe('original');
    expect(display.preview.style.zoom).toBe('');
    inline.mode('expand'); flushFrame(); await settle();
    expect(inline.preview.textContent).toBe('original'); expect(inline.preview.style.zoom).toBe('');
  });

  it('fits an atomic formula only while wrapping and restores natural size in expand mode', async () => {
    const view = mount({ latex: 'abcdefghijklmno' }); await settle();
    expect(rendering.requests).toHaveLength(0); expect(Number(view.preview.style.zoom)).toBe(.25);
    view.mode('expand'); flushFrame(); await settle();
    expect(view.preview.style.zoom).toBe(''); expect(view.preview.textContent).toBe('original');
    view.resize(80); flushFrame(); await settle();
    expect(view.preview.style.zoom).toBe(''); expect(rendering.requests).toHaveLength(0);
  });

  it('does not repeat rendering for height, scroll or same-width notifications', async () => {
    const view = mount(), first = rendering.requests[0];
    view.owner.dispatchEvent(new Event('scroll')); expect(frames.size).toBe(0);
    TestResizeObserver.notify(view.block); flushFrame();
    view.owner.dispatchEvent(new Event(CONTENT_VIEW_CHANGED)); flushFrame();
    expect(rendering.requests).toHaveLength(1); expect(first.cancel).not.toHaveBeenCalled();
    view.resize(96); flushFrame(); await settle();
    expect(first.cancel).toHaveBeenCalledOnce(); expect(rendering.requests).toHaveLength(2);
    expect(rendering.requests[1].latex).not.toBe(first.latex);
    rendering.requests[1].done(markup('narrow', 90)); await settle();
    expect(view.preview.textContent).toBe('narrow');
  });

  it('releases listeners and observers when away, resubscribes nearby, and clears them on dispose', async () => {
    const view = mount(), firstObserver = TestResizeObserver.instances[0], pending = rendering.requests[0];
    expect(firstObserver.targets.has(view.block)).toBe(true);
    view.controller.nearby(false); await settle();
    expect(pending.cancel).toHaveBeenCalledOnce();
    expect(firstObserver.unobserve).toHaveBeenCalledWith(view.block); expect(firstObserver.disconnect).toHaveBeenCalledOnce();
    expect(view.removeListener).toHaveBeenCalledWith(CONTENT_VIEW_CHANGED, expect.any(Function));
    view.resize(80); view.owner.dispatchEvent(new Event(CONTENT_VIEW_CHANGED)); expect(frames.size).toBe(0);
    view.controller.nearby(true); flushFrame();
    expect(rendering.requests).toHaveLength(2);
    const secondObserver = TestResizeObserver.instances[1]; expect(secondObserver.targets.has(view.block)).toBe(true);
    view.dispose();
    expect(secondObserver.unobserve).toHaveBeenCalledWith(view.block); expect(secondObserver.disconnect).toHaveBeenCalledOnce();
    view.owner.dispatchEvent(new Event(CONTENT_VIEW_CHANGED)); expect(frames.size).toBe(0);
  });
});
