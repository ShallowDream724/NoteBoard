import { CODE_HIGHLIGHT_LIMIT, getCodeLanguage, normalizeLanguage } from './codeLanguages';
import type { CodeToken } from './codeTokens';
export type { CodeToken } from './codeTokens';
export interface CodeHighlightResult { tokens: CodeToken[]; status: 'ready' | 'unavailable' | 'cancelled' }
interface Consumer { resolve: (result: CodeHighlightResult) => void; signal?: AbortSignal; abort: () => void }
interface Work { id: number; key: string; code: string; language: string; bytes: number; consumers: Set<Consumer> }
interface Cached { tokens: CodeToken[]; bytes: number }
const MAX_REQUESTS = 64;
const MAX_PENDING_BYTES = 4 * 1024 * 1024;
const MAX_CACHE_BYTES = 4 * 1024 * 1024;
const jobs = new Map<string, Work>();
const queue: Work[] = [];
const cache = new Map<string, Cached>();
let pendingBytes = 0, cacheBytes = 0, sequence = 0;
let worker: Worker | undefined;
let active: Work | undefined;
let watchdog: ReturnType<typeof setTimeout> | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function stopWorker() {
  clearTimeout(watchdog); watchdog = undefined;
  clearTimeout(idleTimer); idleTimer = undefined;
  worker?.terminate(); worker = undefined;
}

function finish(work: Work, tokens: CodeToken[], remember = false, status: CodeHighlightResult['status'] = 'ready') {
  if (jobs.get(work.key) !== work) return;
  jobs.delete(work.key); pendingBytes -= work.bytes;
  if (active === work) { active = undefined; clearTimeout(watchdog); watchdog = undefined; }
  else { const index = queue.indexOf(work); if (index >= 0) queue.splice(index, 1); }
  if (remember && work.consumers.size) {
    const bytes = work.key.length * 2 + tokens.reduce((size, token) => size + 48 + token.className.length * 2, 0);
    if (bytes <= MAX_CACHE_BYTES) {
      cache.set(work.key, { tokens, bytes }); cacheBytes += bytes;
      while (cache.size > 256 || cacheBytes > MAX_CACHE_BYTES) {
        const oldest = cache.keys().next().value!;
        cacheBytes -= cache.get(oldest)!.bytes; cache.delete(oldest);
      }
    }
  }
  for (const consumer of work.consumers) {
    consumer.signal?.removeEventListener('abort', consumer.abort);
    consumer.resolve({ tokens, status });
  }
  work.consumers.clear();
}

function pump() {
  if (active) return;
  clearTimeout(idleTimer);
  if (!queue.length) {
    // Release the parser/language runtime after inactivity; the small bounded result cache survives scrolling.
    if (worker) idleTimer = setTimeout(stopWorker, 30_000);
    return;
  }
  if (!worker) {
    try {
      // No main-thread fallback: a missing/failed worker leaves readable plain code.
      worker = new Worker(new URL('./codeHighlightWorker.ts', import.meta.url), { type: 'module' });
      const currentWorker = worker;
      worker.onmessage = ({ data }: MessageEvent<{ id: number; tokens: CodeToken[]; unavailable?: boolean }>) => {
        if (worker !== currentWorker || active?.id !== data.id) return;
        if (data.unavailable) {
          // A failed module import may remain rejected in this worker's module map.
          // Recreate its runtime before a consumer retries, without caching failure.
          stopWorker(); finish(active, [], false, 'unavailable');
        } else finish(active, data.tokens, true);
        pump();
      };
      worker.onerror = worker.onmessageerror = () => {
        if (worker !== currentWorker) return;
        stopWorker();
        // A broken worker module should not be recreated once per queued block.
        for (const work of [...jobs.values()]) finish(work, [], false, 'unavailable');
      };
    } catch {
      for (const work of [...jobs.values()]) finish(work, [], false, 'unavailable');
      return;
    }
  }
  const work = queue.shift()!;
  active = work;
  // Synchronous grammars are interruptible by terminating their dedicated worker.
  watchdog = setTimeout(() => { if (active !== work) return; stopWorker(); finish(work, [], false, 'unavailable'); pump(); }, 5_000);
  try { worker.postMessage({ id: work.id, code: work.code, language: work.language }); }
  catch { stopWorker(); finish(work, [], false, 'unavailable'); pump(); }
}

/** One shared worker, bounded queue/cache, deduplication and cancellation per consumer. */
export function requestCodeHighlight(code: string, language: string, options: { signal?: AbortSignal } = {}): Promise<CodeHighlightResult> {
  const name = normalizeLanguage(language);
  const { signal } = options;
  if (signal?.aborted) return Promise.resolve({ tokens: [], status: 'cancelled' });
  if (!code || !getCodeLanguage(name)?.grammar || code.length > CODE_HIGHLIGHT_LIMIT) return Promise.resolve({ tokens: [], status: 'ready' });
  const key = name + '\0' + code;
  const cached = cache.get(key);
  if (cached) { cache.delete(key); cache.set(key, cached); return Promise.resolve({ tokens: cached.tokens, status: 'ready' }); }
  let work = jobs.get(key);
  if (!work) {
    const bytes = (key.length + code.length) * 2;
    // Backpressure is explicit: over-budget blocks remain plain until their next request.
    if (jobs.size >= MAX_REQUESTS || pendingBytes + bytes > MAX_PENDING_BYTES) return Promise.resolve({ tokens: [], status: 'unavailable' });
    work = { id: ++sequence, key, code, language: name, bytes, consumers: new Set() };
    jobs.set(key, work); queue.push(work); pendingBytes += bytes;
  }
  const request = work;
  const result = new Promise<CodeHighlightResult>(resolve => {
    const consumer: Consumer = { resolve, signal, abort: () => {
      signal?.removeEventListener('abort', consumer.abort);
      request.consumers.delete(consumer); resolve({ tokens: [], status: 'cancelled' });
      if (!request.consumers.size && jobs.get(key) === request) {
        if (active === request) stopWorker();
        finish(request, []); pump();
      }
    } };
    request.consumers.add(consumer);
    signal?.addEventListener('abort', consumer.abort, { once: true });
  });
  pump();
  return result;
}

/** Token-only convenience API for consumers that intentionally accept plain fallback. */
export async function highlightCode(code: string, language: string, options: { signal?: AbortSignal } = {}): Promise<CodeToken[]> {
  return (await requestCodeHighlight(code, language, options)).tokens;
}

export function disposeCodeHighlighting() {
  stopWorker();
  for (const work of [...jobs.values()]) finish(work, [], false, 'cancelled');
  cache.clear(); cacheBytes = 0;
}
// Consumers cancel on disposal; the scheduler releases the idle worker. Avoid
// module-load browser listeners: DOM-compatible worker windows aren't browsers.
if (import.meta.hot) import.meta.hot.dispose(disposeCodeHighlighting);
