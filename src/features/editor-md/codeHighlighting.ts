import { normalizeLanguage } from './codeLanguages';

export interface CodeToken { from: number; to: number; className: string }
interface Consumer { resolve: (tokens: CodeToken[]) => void; signal?: AbortSignal; abort: () => void }
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

function finish(work: Work, tokens: CodeToken[], remember = false) {
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
    consumer.resolve(tokens);
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
      worker.onmessage = ({ data }: MessageEvent<{ id: number; tokens: CodeToken[] }>) => {
        if (worker !== currentWorker || active?.id !== data.id) return;
        finish(active, data.tokens, true); pump();
      };
      worker.onerror = worker.onmessageerror = () => {
        if (worker !== currentWorker) return;
        stopWorker();
        // A broken worker module should not be recreated once per queued block.
        for (const work of [...jobs.values()]) finish(work, []);
      };
    } catch {
      for (const work of [...jobs.values()]) finish(work, []);
      return;
    }
  }
  const work = queue.shift()!;
  active = work;
  // Synchronous grammars are interruptible by terminating their dedicated worker.
  watchdog = setTimeout(() => { if (active !== work) return; stopWorker(); finish(work, []); pump(); }, 5_000);
  try { worker.postMessage({ id: work.id, code: work.code, language: work.language }); }
  catch { stopWorker(); finish(work, []); pump(); }
}

/** One shared worker, bounded queue/cache, deduplication and cancellation per consumer. */
export function highlightCode(code: string, language: string, options: { signal?: AbortSignal } = {}): Promise<CodeToken[]> {
  const name = normalizeLanguage(language);
  const { signal } = options;
  if (signal?.aborted || !code || name === 'plaintext' || code.length > 200_000) return Promise.resolve([]);
  const key = name + '\0' + code;
  const cached = cache.get(key);
  if (cached) { cache.delete(key); cache.set(key, cached); return Promise.resolve(cached.tokens); }
  let work = jobs.get(key);
  if (!work) {
    const bytes = (key.length + code.length) * 2;
    // Backpressure is explicit: over-budget blocks remain plain until their next request.
    if (jobs.size >= MAX_REQUESTS || pendingBytes + bytes > MAX_PENDING_BYTES) return Promise.resolve([]);
    work = { id: ++sequence, key, code, language: name, bytes, consumers: new Set() };
    jobs.set(key, work); queue.push(work); pendingBytes += bytes;
  }
  const request = work;
  const result = new Promise<CodeToken[]>(resolve => {
    const consumer: Consumer = { resolve, signal, abort: () => {
      signal?.removeEventListener('abort', consumer.abort);
      request.consumers.delete(consumer); resolve([]);
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

export function disposeCodeHighlighting() {
  stopWorker();
  for (const work of [...jobs.values()]) finish(work, []);
  cache.clear(); cacheBytes = 0;
}
if (typeof window !== 'undefined') window.addEventListener('pagehide', disposeCodeHighlighting);
if (import.meta.hot) import.meta.hot.dispose(() => {
  window.removeEventListener('pagehide', disposeCodeHighlighting);
  disposeCodeHighlighting();
});

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function codeTokensToHTML(code: string, tokens: CodeToken[]): string {
  let html = '', offset = 0;
  for (const token of tokens) {
    html += escape(code.slice(offset, token.from)) + `<span class="${escape(token.className)}">${escape(code.slice(token.from, token.to))}</span>`;
    offset = token.to;
  }
  return html + escape(code.slice(offset));
}
