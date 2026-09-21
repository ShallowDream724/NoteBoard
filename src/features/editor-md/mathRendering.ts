export interface MathRendering { html: string; error?: string }
const cache = new Map<string, MathRendering>();
let cacheBytes = 0;
const MAX_CACHE_BYTES = 4 * 1024 * 1024;
const entryBytes = (key: string, value: MathRendering) => 2 * (key.length + value.html.length + (value.error?.length ?? 0));
let worker: Worker | undefined;
let sequence = 0;
const pending = new Map<number, (result: MathRendering) => void>();
const inFlight = new Map<string, Promise<MathRendering>>();

async function requestMarkup(latex: string, displayMode: boolean): Promise<MathRendering> {
  if (typeof Worker === 'undefined') return (await import('./mathEngine')).renderMathMarkup(latex, displayMode);
  if (!worker) {
    try { worker = new Worker(new URL('./mathWorker.ts', import.meta.url), { type: 'module' }); }
    catch { return { html: '', error: '公式排版无法启动，请重试' }; }
    worker.onmessage = ({ data }: MessageEvent<{ id: number; result: MathRendering }>) => {
      pending.get(data.id)?.(data.result); pending.delete(data.id);
    };
    worker.onerror = () => {
      worker?.terminate(); worker = undefined;
      pending.forEach(resolve => resolve({ html: '', error: '公式排版失败，请重试' })); pending.clear();
    };
  }
  return new Promise(resolve => {
    const id = ++sequence; pending.set(id, resolve);
    try { worker!.postMessage({ id, latex, displayMode }); }
    catch { pending.delete(id); resolve({ html: '', error: '公式排版失败，请重试' }); }
  });
}

/** Shared loading/cache, with fresh macro scope per expression. */
export async function renderMath(latex: string, displayMode: boolean): Promise<MathRendering> {
  const key = String(displayMode) + ':' + latex;
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const existing = inFlight.get(key);
  if (existing) return existing;
  const task = requestMarkup(latex, displayMode);
  inFlight.set(key, task);
  let result: MathRendering;
  try { result = await task; } finally { inFlight.delete(key); }
  if (!result.error && latex.length < 16_384 && result.html.length < 262_144) {
    const previous = cache.get(key);
    if (previous) cacheBytes -= entryBytes(key, previous);
    cache.set(key, result);
    cacheBytes += entryBytes(key, result);
    while (cache.size > 512 || cacheBytes > MAX_CACHE_BYTES) {
      const oldest = cache.keys().next().value!;
      cacheBytes -= entryBytes(oldest, cache.get(oldest)!);
      cache.delete(oldest);
    }
  }
  return result;
}

export function clearKatexCache(): void { cache.clear(); cacheBytes = 0; }
