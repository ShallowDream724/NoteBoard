import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class TestWorker {
  static instances: TestWorker[] = [];
  onmessage?: (event: MessageEvent) => void;
  onerror?: () => void;
  messages: { id: number; latex: string }[] = [];
  terminated = false;
  constructor() { TestWorker.instances.push(this); }
  postMessage(message: { id: number; latex: string }) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  reply(html: string) { this.onmessage?.({ data: { id: this.messages.at(-1)!.id, result: { html } } } as MessageEvent); }
}

describe('formula worker ownership', () => {
  beforeEach(() => {
    vi.resetModules(); vi.useFakeTimers(); TestWorker.instances = []; vi.stubGlobal('Worker', TestWorker);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('prioritizes visible formulas before queued distant work', async () => {
    const { renderMath } = await import('../../src/features/editor-md/mathRendering');
    const distant = renderMath('distant', false, { priority: () => 1 });
    const visible = renderMath('visible', false, { priority: () => 0 });
    await vi.advanceTimersByTimeAsync(1);
    const worker = TestWorker.instances[0];
    expect(worker.messages.map(message => message.latex)).toEqual(['visible']);
    worker.reply('<span>visible</span>'); await visible;
    await vi.advanceTimersByTimeAsync(1);
    expect(worker.messages.map(message => message.latex)).toEqual(['visible', 'distant']);
    worker.reply('<span>distant</span>'); await distant;
  });

  it('keeps a shared render alive until its last subscriber leaves', async () => {
    const { renderMath } = await import('../../src/features/editor-md/mathRendering');
    const controller = new AbortController();
    const cancelled = renderMath('shared', false, { signal: controller.signal }).catch(error => error);
    const remaining = renderMath('shared', false);
    await vi.advanceTimersByTimeAsync(1);
    const worker = TestWorker.instances[0]; controller.abort();
    expect((await cancelled).name).toBe('AbortError'); expect(worker.terminated).toBe(false);
    worker.reply('<span>shared</span>');
    expect(await remaining).toEqual({ html: '<span>shared</span>' });
    expect(await renderMath('shared', false)).toEqual({ html: '<span>shared</span>' });
    expect(worker.messages).toHaveLength(1);
  });

  it('terminates stale active work and lets the current viewport proceed', async () => {
    const { renderMath } = await import('../../src/features/editor-md/mathRendering');
    const controller = new AbortController();
    const cancelled = renderMath('stale', false, { signal: controller.signal }).catch(error => error);
    await vi.advanceTimersByTimeAsync(1);
    const staleWorker = TestWorker.instances[0];
    const current = renderMath('current', false, { priority: () => 0 });
    controller.abort(); await cancelled; await vi.advanceTimersByTimeAsync(1);
    expect(staleWorker.terminated).toBe(true);
    const currentWorker = TestWorker.instances[1];
    expect(currentWorker.messages[0].latex).toBe('current');
    staleWorker.reply('<span>stale</span>'); currentWorker.reply('<span>current</span>');
    expect(await current).toEqual({ html: '<span>current</span>' });
  });

  it('removes cancelled waiting tasks without sending them to a worker', async () => {
    const { renderMath } = await import('../../src/features/editor-md/mathRendering');
    const controller = new AbortController();
    const cancelled = renderMath('never-visible', false, { signal: controller.signal }).catch(error => error);
    controller.abort(); await cancelled; await vi.advanceTimersByTimeAsync(1);
    expect(TestWorker.instances).toHaveLength(0);
  });

  it('does not enqueue oversized input or retain oversized worker output', async () => {
    const { renderMath } = await import('../../src/features/editor-md/mathRendering');
    const { MATH_LIMITS } = await import('../../src/features/editor-md/mathLimits');
    expect(await renderMath('x'.repeat(MATH_LIMITS.inputCharacters + 1), true)).toMatchObject({ html: '', limited: 'input' });
    expect(TestWorker.instances).toHaveLength(0);
    const rendered = renderMath('amplified', true); await vi.advanceTimersByTimeAsync(1);
    TestWorker.instances[0].reply('x'.repeat(MATH_LIMITS.markupCharacters + 1));
    expect(await rendered).toMatchObject({ html: '', limited: 'markup' });
    expect(await renderMath('amplified', true)).toMatchObject({ html: '', limited: 'markup' });
    expect(TestWorker.instances[0].messages).toHaveLength(1);
  });

  it('terminates an expression that exceeds its worker lifetime and advances the queue', async () => {
    const { renderMath } = await import('../../src/features/editor-md/mathRendering');
    const { MATH_LIMITS } = await import('../../src/features/editor-md/mathLimits');
    const stalled = renderMath('stalled', true), following = renderMath('following', true);
    await vi.advanceTimersByTimeAsync(MATH_LIMITS.workerMilliseconds + 2);
    expect(await stalled).toMatchObject({ html: '', limited: 'time' });
    expect(TestWorker.instances[0].terminated).toBe(true);
    const next = TestWorker.instances[1]; expect(next.messages[0].latex).toBe('following');
    next.reply('<span>following</span>'); expect(await following).toEqual({ html: '<span>following</span>' });
  });

  it('releases an idle worker while preserving the bounded result cache', async () => {
    const { renderMath } = await import('../../src/features/editor-md/mathRendering');
    const first = renderMath('idle', false);
    await vi.advanceTimersByTimeAsync(1);
    const worker = TestWorker.instances[0];
    worker.reply('<span>idle</span>'); await first;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(worker.terminated).toBe(true);
    expect(await renderMath('idle', false)).toEqual({ html: '<span>idle</span>' });
    expect(TestWorker.instances).toHaveLength(1);
  });

  it('retries the same expression after a transient worker timeout', async () => {
    const { renderMath } = await import('../../src/features/editor-md/mathRendering');
    const { MATH_LIMITS } = await import('../../src/features/editor-md/mathLimits');
    const first = renderMath('x + y', true);
    await vi.advanceTimersByTimeAsync(MATH_LIMITS.workerMilliseconds + 2);
    expect(await first).toMatchObject({ limited: 'time' });
    const retry = renderMath('x + y', true);
    await vi.advanceTimersByTimeAsync(1);
    expect(TestWorker.instances).toHaveLength(2);
    TestWorker.instances[1].reply('<span>x + y</span>');
    expect(await retry).toEqual({ html: '<span>x + y</span>' });
  });

  it('defers a large DOM commit during scrolling and cancels it after leaving', async () => {
    const { queueMath } = await import('../../src/features/editor-md/mathRenderQueue');
    const done = vi.fn(); let scrolling = true;
    const cancel = queueMath('large', { latex: 'large', display: true, isScrolling: () => scrolling, done });
    await vi.advanceTimersByTimeAsync(20);
    TestWorker.instances[0].reply('x'.repeat(40_000));
    await vi.advanceTimersByTimeAsync(40); expect(done).not.toHaveBeenCalled();
    cancel(); scrolling = false;
    await vi.advanceTimersByTimeAsync(100); expect(done).not.toHaveBeenCalled();
  });

  it('preempts an overscan preparation when a visible formula arrives', async () => {
    const { queueMath } = await import('../../src/features/editor-md/mathRenderQueue');
    const distant = queueMath('distant', { latex: 'distant', display: true, priority: () => 1, done: vi.fn() });
    await vi.advanceTimersByTimeAsync(20);
    const staleWorker = TestWorker.instances[0], done = vi.fn();
    const visible = queueMath('visible', { latex: 'visible', display: true, priority: () => 0, done });
    await vi.advanceTimersByTimeAsync(20);
    expect(staleWorker.terminated).toBe(true);
    expect(TestWorker.instances[1].messages[0].latex).toBe('visible');
    TestWorker.instances[1].reply('<span>visible</span>');
    await vi.advanceTimersByTimeAsync(20); expect(done).toHaveBeenCalledOnce();
    distant(); visible(); await vi.advanceTimersByTimeAsync(20);
  });
});
