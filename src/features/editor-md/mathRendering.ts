import { checkMathMarkup, checkMathSource, MATH_LIMITS, mathLimitFailure, type MathLimitReason } from './mathLimits';
import { MATH_BATCH_LIMITS, type MathWorkerRequest, type MathWorkerResponse } from './mathWorkerProtocol';

export interface MathRendering { html: string; error?: string; limited?: MathLimitReason }
export interface MathRenderOptions { signal?: AbortSignal; priority?: () => number }
interface Subscriber { resolve: (value: MathRendering) => void; priority: () => number; clean: () => void }
interface Task { id: number; key: string; latex: string; display: boolean; subscribers: Set<Subscriber>; inFlight?: boolean }
interface Batch { id: number; pending: Task[]; progressAt: number }
const cache = new Map<string, MathRendering>();
let cacheBytes = 0;
const MAX_CACHE_BYTES = 4 * 1024 * 1024;
const entryBytes = (key: string, value: MathRendering) => 2 * (key.length + value.html.length + (value.error?.length ?? 0));
const tasks = new Map<string, Task>();
let worker: Worker | undefined, active: Batch | undefined, sequence = 0, batchSequence = 0;
let scheduled = false;
let deadline: ReturnType<typeof setTimeout> | undefined;
let idleRelease: ReturnType<typeof setTimeout> | undefined;
const failure = (): MathRendering => ({ html: '', error: '公式排版失败，请重试' });
const priority = (task: Task) => Math.min(...Array.from(task.subscribers, subscriber => subscriber.priority()));

function remember(task: Task, result: MathRendering) {
  // A deadline can reflect cold startup or system load, not the expression.
  // Keep deterministic admission failures, but allow transient failures to retry.
  if (result.limited === 'time' || (result.error && !result.limited) || task.latex.length > MATH_LIMITS.inputCharacters || result.html.length >= MATH_LIMITS.markupCharacters) return;
  const previous = cache.get(task.key);
  if (previous) cacheBytes -= entryBytes(task.key, previous);
  cache.delete(task.key); cache.set(task.key, result); cacheBytes += entryBytes(task.key, result);
  while (cache.size > 512 || cacheBytes > MAX_CACHE_BYTES) {
    const oldest = cache.keys().next().value!;
    cacheBytes -= entryBytes(oldest, cache.get(oldest)!); cache.delete(oldest);
  }
}
function settle(task: Task, result: MathRendering) {
  task.inFlight = false;
  if (tasks.get(task.key) === task) tasks.delete(task.key);
  remember(task, result);
  for (const subscriber of task.subscribers) { subscriber.clean(); subscriber.resolve(result); }
  task.subscribers.clear();
}
function finishBatch(batch: Batch) {
  if (active !== batch) return;
  clearTimeout(deadline); deadline = undefined; active = undefined;
  for (const task of batch.pending) {
    task.inFlight = false;
    if (!task.subscribers.size && tasks.get(task.key) === task) tasks.delete(task.key);
  }
  schedule();
}
function failCurrent(result: MathRendering) {
  const batch = active;
  if (!batch) return;
  const task = batch.pending.shift();
  if (task) settle(task, result);
  // Unstarted expressions keep their subscribers and return to the scheduler.
  finishBatch(batch);
}
function schedule() {
  if (active || scheduled) return;
  if (!tasks.size) {
    if (worker && idleRelease === undefined) {
      const current = worker;
      idleRelease = setTimeout(() => {
        idleRelease = undefined;
        if (worker === current && !active && !tasks.size) { current.terminate(); worker = undefined; }
      }, 30_000);
    }
    return;
  }
  clearTimeout(idleRelease); idleRelease = undefined;
  // Coalesce a delivery's callers without adding a timer turn per expression.
  scheduled = true;
  queueMicrotask(() => { scheduled = false; start(); });
}
function selectBatch(): Task[] {
  let best = Infinity;
  const candidates: Task[] = [];
  for (const task of tasks.values()) {
    if (!task.subscribers.size) continue;
    const rank = priority(task);
    if (rank < best) { best = rank; candidates.length = 0; }
    if (rank === best) candidates.push(task);
  }
  let characters = 0;
  const selected: Task[] = [];
  for (const task of candidates) {
    // An admitted expression larger than the slice source budget runs alone.
    if (selected.length && characters + task.latex.length > MATH_BATCH_LIMITS.sourceCharacters) break;
    selected.push(task); characters += task.latex.length;
    if (selected.length >= MATH_BATCH_LIMITS.expressions) break;
  }
  return selected;
}
function armDeadline(batch: Batch, milliseconds: number = MATH_LIMITS.workerMilliseconds) {
  // Fast batches use one watchdog. Results only update the current task's age.
  deadline = setTimeout(() => {
    if (active !== batch || !batch.pending.length) return;
    const remaining = MATH_LIMITS.workerMilliseconds - (performance.now() - batch.progressAt);
    if (remaining > 0) { armDeadline(batch, remaining); return; }
    worker?.terminate(); worker = undefined; failCurrent(mathLimitFailure('time'));
  }, milliseconds);
}
function accept(batch: Batch, id: number, result: MathRendering) {
  if (active !== batch || batch.pending[0]?.id !== id) return;
  const task = batch.pending.shift()!;
  settle(task, checkMathMarkup(result.html) ?? result);
  batch.progressAt = performance.now();
}
async function runWithoutWorker(batch: Batch) {
  // SSR/test fallback has no hard interruption; browsers use the worker path.
  try {
    const engine = await import('./mathEngine');
    const started = performance.now();
    while (active === batch && batch.pending.length) {
      const task = batch.pending[0];
      accept(batch, task.id, await engine.renderMathMarkup(task.latex, task.display));
      if (performance.now() - started >= MATH_BATCH_LIMITS.milliseconds) break;
    }
    // Unlike worker messages, fallback microtasks do not give the browser a
    // rendering opportunity. Yield once per slice if more source remains.
    if (tasks.size) await new Promise<void>(resolve => setTimeout(resolve, 0));
    finishBatch(batch);
  } catch { failCurrent(failure()); }
}
function start() {
  if (active) return;
  const pending = selectBatch();
  if (!pending.length) return;
  const batch: Batch = { id: ++batchSequence, pending, progressAt: performance.now() };
  active = batch;
  for (const task of pending) task.inFlight = true;
  if (typeof Worker === 'undefined') { void runWithoutWorker(batch); return; }
  if (!worker) {
    try {
      const current = new Worker(new URL('./mathWorker.ts', import.meta.url), { type: 'module' });
      worker = current;
      current.onmessage = ({ data }: MessageEvent<MathWorkerResponse>) => {
        if (worker !== current || active?.id !== data.batchId) return;
        if ('result' in data) accept(active, data.id, data.result);
        if (data.done) finishBatch(active);
      };
      current.onerror = () => {
        if (worker !== current) return;
        current.terminate(); worker = undefined; failCurrent(failure());
      };
    } catch { failCurrent(failure()); return; }
  }
  try {
    const request: MathWorkerRequest = { batchId: batch.id, expressions: pending.map(task => ({ id: task.id, latex: task.latex, displayMode: task.display })) };
    worker.postMessage(request); armDeadline(batch);
  }
  catch { failCurrent(failure()); }
}

/** Requests coalesce into bounded, single-priority worker slices. Each completed
 * expression streams back without a round trip; priorities are reconsidered at
 * every slice. Cancellation is per consumer, while already dispatched work may
 * finish and warm the bounded cache. Export owns an independent subscriber. */
export function renderMath(latex: string, displayMode: boolean, options: MathRenderOptions = {}): Promise<MathRendering> {
  if (options.signal?.aborted) return Promise.reject(new DOMException('Formula rendering cancelled', 'AbortError'));
  const refused = checkMathSource(latex); if (refused) return Promise.resolve(refused);
  const key = String(displayMode) + ':' + latex;
  const cached = cache.get(key);
  if (cached) { cache.delete(key); cache.set(key, cached); return Promise.resolve(cached); }
  let task = tasks.get(key);
  if (!task) { task = { id: ++sequence, key, latex, display: displayMode, subscribers: new Set() }; tasks.set(key, task); }
  const current = task;
  return new Promise((resolve, reject) => {
    const abort = () => {
      subscriber.clean(); current.subscribers.delete(subscriber);
      reject(new DOMException('Formula rendering cancelled', 'AbortError'));
      if (!current.subscribers.size) {
        if (!current.inFlight && tasks.get(key) === current) tasks.delete(key);
        schedule();
      }
    };
    const subscriber: Subscriber = { resolve, priority: options.priority ?? (() => 2), clean: () => options.signal?.removeEventListener('abort', abort) };
    current.subscribers.add(subscriber); options.signal?.addEventListener('abort', abort, { once: true }); schedule();
  });
}

export function clearKatexCache(): void { cache.clear(); cacheBytes = 0; }
