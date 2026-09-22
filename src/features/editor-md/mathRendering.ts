import { checkMathMarkup, checkMathSource, MATH_LIMITS, mathLimitFailure, type MathLimitReason } from './mathLimits';

export interface MathRendering { html: string; error?: string; limited?: MathLimitReason }
export interface MathRenderOptions { signal?: AbortSignal; priority?: () => number }
interface Subscriber { resolve: (value: MathRendering) => void; priority: () => number; clean: () => void }
interface Task { id: number; key: string; latex: string; display: boolean; subscribers: Set<Subscriber> }
const cache = new Map<string, MathRendering>();
let cacheBytes = 0;
const MAX_CACHE_BYTES = 4 * 1024 * 1024;
const entryBytes = (key: string, value: MathRendering) => 2 * (key.length + value.html.length + (value.error?.length ?? 0));
const tasks = new Map<string, Task>();
let worker: Worker | undefined, active: Task | undefined, sequence = 0;
let scheduled: ReturnType<typeof setTimeout> | undefined;
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
  if (active !== task) return;
  clearTimeout(deadline); deadline = undefined;
  active = undefined;
  if (tasks.get(task.key) === task) tasks.delete(task.key);
  remember(task, result);
  for (const subscriber of task.subscribers) { subscriber.clean(); subscriber.resolve(result); }
  task.subscribers.clear(); schedule();
}
function schedule() {
  if (active || scheduled !== undefined) return;
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
  // Let one IntersectionObserver delivery update all priorities before choosing.
  scheduled = setTimeout(() => { scheduled = undefined; start(); }, 0);
}
function start() {
  if (active) return;
  let next: Task | undefined;
  for (const task of tasks.values()) if (task.subscribers.size && (!next || priority(task) < priority(next))) next = task;
  if (!next) return;
  active = next;
  const task = next;
  if (typeof Worker === 'undefined') {
    void import('./mathEngine').then(engine => engine.renderMathMarkup(task.latex, task.display)).then(result => settle(task, result), () => settle(task, failure()));
    return;
  }
  if (!worker) {
    try {
      const current = new Worker(new URL('./mathWorker.ts', import.meta.url), { type: 'module' });
      worker = current;
      current.onmessage = ({ data }: MessageEvent<{ id: number; result: MathRendering }>) => {
        if (worker === current && active?.id === data.id) settle(active, checkMathMarkup(data.result.html) ?? data.result);
      };
      current.onerror = () => {
        if (worker !== current) return;
        current.terminate(); worker = undefined;
        if (active) settle(active, failure());
      };
    } catch { settle(task, failure()); return; }
  }
  try {
    worker.postMessage({ id: task.id, latex: task.latex, displayMode: task.display });
    // KaTeX has no cooperative interruption during macro expansion. This is a
    // hard worker-lifetime bound, in addition to source/output admission limits.
    deadline = setTimeout(() => {
      if (active !== task) return;
      worker?.terminate(); worker = undefined; settle(task, mathLimitFailure('time'));
    }, MATH_LIMITS.workerMilliseconds);
  }
  catch { settle(task, failure()); }
}

/** One worker owns only one expression at a time; waiting requests stay on the
 * main-thread scheduler so newly visible work can pass distant matrix cells.
 * Aborting the final subscriber terminates even synchronous KaTeX work. Export
 * callers share the cache but have an independent, non-cancellable subscriber. */
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
        if (tasks.get(key) === current) tasks.delete(key);
        if (active === current && worker) { clearTimeout(deadline); deadline = undefined; worker.terminate(); worker = undefined; active = undefined; }
        schedule();
      }
    };
    const subscriber: Subscriber = { resolve, priority: options.priority ?? (() => 2), clean: () => options.signal?.removeEventListener('abort', abort) };
    current.subscribers.add(subscriber); options.signal?.addEventListener('abort', abort, { once: true }); schedule();
  });
}

export function clearKatexCache(): void { cache.clear(); cacheBytes = 0; }
