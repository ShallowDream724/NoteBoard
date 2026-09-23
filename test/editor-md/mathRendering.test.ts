import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MathWorkerExpression, MathWorkerRequest } from '../../src/features/editor-md/mathWorkerProtocol';

class TestWorker {
  static instances: TestWorker[] = [];
  onmessage?: (event: MessageEvent) => void;
  onerror?: () => void;
  messages: { id: number; latex: string }[] = [];
  batches: MathWorkerRequest[] = [];
  pending: MathWorkerExpression[] = [];
  terminated = false;
  constructor() { TestWorker.instances.push(this); }
  postMessage(message: MathWorkerRequest) { this.batches.push(message); this.pending = [...message.expressions]; this.messages.push(...message.expressions); }
  terminate() { this.terminated = true; }
  reply(html: string, error?: string) {
    const expression = this.pending.shift()!;
    this.onmessage?.({ data: { batchId: this.batches.at(-1)!.batchId, id: expression.id, result: { html, ...(error ? { error } : {}) }, ...(!this.pending.length ? { done: true } : {}) } } as MessageEvent);
  }
  finishBatch() { this.pending = []; this.onmessage?.({ data: { batchId: this.batches.at(-1)!.batchId, done: true } } as MessageEvent); }
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

  it('finishes cancelled active work once, caches it, and reuses the warm worker', async () => {
    const { renderMath } = await import('../../src/features/editor-md/mathRendering');
    const controller = new AbortController();
    const cancelled = renderMath('stale', false, { signal: controller.signal }).catch(error => error);
    await vi.advanceTimersByTimeAsync(1);
    const worker = TestWorker.instances[0];
    const current = renderMath('current', false, { priority: () => 0 });
    controller.abort(); expect((await cancelled).name).toBe('AbortError'); await vi.advanceTimersByTimeAsync(1);
    expect(worker.terminated).toBe(false); expect(worker.messages).toHaveLength(1);
    worker.reply('<span>stale</span>'); await vi.advanceTimersByTimeAsync(1);
    expect(await renderMath('stale', false)).toEqual({ html: '<span>stale</span>' });
    expect(TestWorker.instances).toHaveLength(1);
    expect(worker.messages.map(message => message.latex)).toEqual(['stale', 'current']);
    worker.reply('<span>current</span>');
    expect(await current).toEqual({ html: '<span>current</span>' });
  });

  it('reattaches a returning consumer to the same active expression', async () => {
    const { renderMath } = await import('../../src/features/editor-md/mathRendering');
    const controller = new AbortController();
    const cancelled = renderMath('returning', false, { signal: controller.signal }).catch(error => error);
    await vi.advanceTimersByTimeAsync(1); controller.abort(); await cancelled;
    const returning = renderMath('returning', false);
    const worker = TestWorker.instances[0]; worker.reply('<span>returning</span>');
    expect(await returning).toEqual({ html: '<span>returning</span>' });
    expect(worker.messages).toHaveLength(1); expect(worker.terminated).toBe(false);
  });

  it('retains the original deadline when an active expression loses all consumers', async () => {
    const { renderMath } = await import('../../src/features/editor-md/mathRendering');
    const { MATH_LIMITS } = await import('../../src/features/editor-md/mathLimits');
    const controller = new AbortController();
    const cancelled = renderMath('orphan', false, { signal: controller.signal }).catch(error => error);
    await vi.advanceTimersByTimeAsync(1000); controller.abort(); await cancelled;
    const next = renderMath('next', false);
    await vi.advanceTimersByTimeAsync(MATH_LIMITS.workerMilliseconds - 1000 + 2);
    expect(TestWorker.instances[0].terminated).toBe(true);
    expect(TestWorker.instances[1].messages[0].latex).toBe('next');
    TestWorker.instances[0].reply('<span>late orphan</span>');
    TestWorker.instances[1].reply('<span>next</span>');
    expect(await next).toEqual({ html: '<span>next</span>' });
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

  it('coalesces short formulas into source- and count-bounded worker slices', async () => {
    const { renderMath } = await import('../../src/features/editor-md/mathRendering');
    const { MATH_BATCH_LIMITS } = await import('../../src/features/editor-md/mathWorkerProtocol');
    const rendered = Array.from({ length: 17 }, (_, index) => renderMath(`x_${index}`, false));
    await vi.advanceTimersByTimeAsync(0);
    const worker = TestWorker.instances[0];
    expect(worker.batches).toHaveLength(1); expect(worker.pending).toHaveLength(MATH_BATCH_LIMITS.expressions);
    for (let index = 0; index < 16; index++) worker.reply(`<span>${index}</span>`);
    await vi.advanceTimersByTimeAsync(0); expect(worker.batches).toHaveLength(2);
    worker.reply('<span>16</span>'); await Promise.all(rendered);
    const large = ['a', 'b', 'c'].map(value => renderMath(value.repeat(4_000), true));
    await vi.advanceTimersByTimeAsync(0); expect(worker.pending).toHaveLength(2);
    worker.reply('<span>a</span>'); worker.reply('<span>b</span>');
    await vi.advanceTimersByTimeAsync(0); expect(worker.pending).toHaveLength(1);
    worker.reply('<span>c</span>'); await Promise.all(large);
  });

  it('rechecks priorities when a time-bounded slice returns unfinished work', async () => {
    const { renderMath } = await import('../../src/features/editor-md/mathRendering');
    const first = renderMath('first', false, { priority: () => 1 });
    let rank = 1;
    const distant = renderMath('distant', false, { priority: () => 1 });
    const promoted = renderMath('promoted', false, { priority: () => rank });
    await vi.advanceTimersByTimeAsync(0); const worker = TestWorker.instances[0];
    worker.reply('<span>first</span>'); await first;
    rank = 0; worker.finishBatch(); await vi.advanceTimersByTimeAsync(0);
    expect(worker.pending.map(expression => expression.latex)).toEqual(['promoted']);
    worker.reply('<span>promoted</span>'); await promoted; await vi.advanceTimersByTimeAsync(0);
    expect(worker.pending.map(expression => expression.latex)).toEqual(['distant']);
    worker.reply('<span>distant</span>'); await distant;
  });

  it('keeps completed results and retries unstarted tail after a mid-slice timeout', async () => {
    const { renderMath } = await import('../../src/features/editor-md/mathRendering');
    const first = renderMath('completed', false), stalled = renderMath('stalled', false), tail = renderMath('tail', false);
    await vi.advanceTimersByTimeAsync(500); const worker = TestWorker.instances[0];
    worker.reply('<span>completed</span>'); await first;
    await vi.advanceTimersByTimeAsync(1501); expect(worker.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(worker.terminated).toBe(true); expect(await stalled).toMatchObject({ limited: 'time' });
    expect(await renderMath('completed', false)).toEqual({ html: '<span>completed</span>' });
    const next = TestWorker.instances[1]; expect(next.pending.map(expression => expression.latex)).toEqual(['tail']);
    next.reply('<span>tail</span>'); await tail;
  });

  it('does not retain renderer errors in the result cache', async () => {
    const { renderMath } = await import('../../src/features/editor-md/mathRendering');
    const first = renderMath('error', false); await vi.advanceTimersByTimeAsync(0);
    const worker = TestWorker.instances[0]; worker.reply('', 'parse failure'); await first;
    const retry = renderMath('error', false); await vi.advanceTimersByTimeAsync(0);
    expect(worker.batches).toHaveLength(2); worker.reply('<span>retry</span>'); await retry;
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

  it('allows lightweight nearby results during scrolling but defers background work', async () => {
    const { queueMath, refreshMathQueue } = await import('../../src/features/editor-md/mathRenderQueue');
    const done = vi.fn(), background = vi.fn(); let scrolling = true;
    queueMath('small', { latex: 'fraction', display: false, isScrolling: () => scrolling, done });
    await vi.advanceTimersByTimeAsync(20); TestWorker.instances[0].reply('<span>fraction</span>');
    await vi.advanceTimersByTimeAsync(20); expect(done).toHaveBeenCalledOnce();
    queueMath('background', { latex: 'background', display: false, priority: () => 2, isScrolling: () => scrolling, done: background });
    await vi.advanceTimersByTimeAsync(20); TestWorker.instances[0].reply('<span>background</span>');
    await vi.advanceTimersByTimeAsync(100); expect(background).not.toHaveBeenCalled();
    scrolling = false; refreshMathQueue(); await vi.advanceTimersByTimeAsync(20);
    expect(background).toHaveBeenCalledOnce();
  });

  it('bounds delayed reclamation by the shared frame budget and cancels a return', async () => {
    const { retireMath } = await import('../../src/features/editor-md/mathRenderQueue');
    const retired: number[] = [];
    let work = 0;
    const now = vi.spyOn(performance, 'now').mockImplementation(() => Date.now() + work);
    for (let index = 0; index < 5; index++) retireMath(String(index), () => { retired.push(index); work += 2; });
    const cancel = retireMath('returning', () => retired.push(99));
    await vi.advanceTimersByTimeAsync(180); expect(retired).toEqual([]); cancel();
    await vi.advanceTimersByTimeAsync(16); expect(retired).toEqual([0, 1]);
    await vi.advanceTimersByTimeAsync(16); expect(retired).toEqual([0, 1, 2, 3]);
    await vi.advanceTimersByTimeAsync(16); expect(retired).toEqual([0, 1, 2, 3, 4]);
    now.mockRestore();
  });

  it('never delivers an old result to a replacement with the same owner id', async () => {
    const { queueMath } = await import('../../src/features/editor-md/mathRenderQueue');
    const stale = vi.fn(), current = vi.fn();
    queueMath('owner', { latex: 'old', display: false, done: stale });
    await vi.advanceTimersByTimeAsync(20);
    queueMath('owner', { latex: 'new', display: false, done: current });
    await vi.advanceTimersByTimeAsync(20);
    const worker = TestWorker.instances[0]; worker.reply('<span>old</span>');
    await vi.advanceTimersByTimeAsync(20); worker.reply('<span>new</span>');
    await vi.advanceTimersByTimeAsync(20);
    expect(stale).not.toHaveBeenCalled(); expect(current).toHaveBeenCalledExactlyOnceWith({ html: '<span>new</span>' });
    expect(TestWorker.instances).toHaveLength(1);
  });

  it('preempts an overscan preparation when a visible formula arrives', async () => {
    const { queueMath } = await import('../../src/features/editor-md/mathRenderQueue');
    const distant = queueMath('distant', { latex: 'distant', display: true, priority: () => 1, done: vi.fn() });
    await vi.advanceTimersByTimeAsync(20);
    const staleWorker = TestWorker.instances[0], done = vi.fn();
    const visible = queueMath('visible', { latex: 'visible', display: true, priority: () => 0, done });
    await vi.advanceTimersByTimeAsync(20);
    expect(staleWorker.terminated).toBe(false);
    staleWorker.reply('<span>distant</span>'); await vi.advanceTimersByTimeAsync(1);
    expect(staleWorker.messages.at(-1)!.latex).toBe('visible');
    staleWorker.reply('<span>visible</span>');
    await vi.advanceTimersByTimeAsync(20); expect(done).toHaveBeenCalledOnce();
    distant(); visible(); await vi.advanceTimersByTimeAsync(20);
  });

  it('prepares visible work even when scrolling defers a full background result budget', async () => {
    const { queueMath } = await import('../../src/features/editor-md/mathRenderQueue');
    const background = vi.fn(), done = vi.fn();
    const cancels = Array.from({ length: 8 }, (_, index) => queueMath(`far-${index}`, {
      latex: `far-${index}`, display: false, priority: () => 2, isScrolling: () => true, done: background,
    }));
    await vi.advanceTimersByTimeAsync(20);
    const worker = TestWorker.instances[0];
    for (let index = 0; index < 8; index++) worker.reply('x'.repeat(65536));
    await vi.advanceTimersByTimeAsync(20); expect(background).not.toHaveBeenCalled();
    queueMath('foreground', { latex: 'foreground', display: false, priority: () => 0, isScrolling: () => true, done });
    await vi.advanceTimersByTimeAsync(20); expect(worker.messages.at(-1)!.latex).toBe('foreground');
    worker.reply('<span>foreground</span>'); await vi.advanceTimersByTimeAsync(20);
    expect(done).toHaveBeenCalledOnce(); expect(background).not.toHaveBeenCalled();
    cancels.forEach(cancel => cancel());
  });
});
