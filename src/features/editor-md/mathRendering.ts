export interface MathRendering { html: string; error?: string }
const cache = new Map<string, MathRendering>();
let cacheBytes = 0;
const MAX_CACHE_BYTES = 4 * 1024 * 1024;
const entryBytes = (key: string, value: MathRendering) => 2 * (key.length + value.html.length + (value.error?.length ?? 0));
let loading: Promise<typeof import('katex')> | undefined;
let chemistry: Promise<unknown> | undefined;

/** Shared loading/cache, with fresh macro scope per expression. */
export async function renderMath(latex: string, displayMode: boolean): Promise<MathRendering> {
  const key = String(displayMode) + ':' + latex;
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  loading ??= import('katex').catch((error) => { loading = undefined; throw error; });
  let result: MathRendering;
  try {
    const katex = await loading;
    if (/\\(?:ce|pu)\s*\{/.test(latex)) {
      chemistry ??= import('katex/contrib/mhchem').catch((error) => { chemistry = undefined; throw error; });
      await chemistry;
    }
    const html = katex.renderToString(latex, {
      displayMode, throwOnError: true, trust: false, strict: false,
      maxExpand: 1000, maxSize: 100,
    });
    result = { html };
  } catch (error) {
    result = { html: '', error: error instanceof Error ? error.message.replace(/^KaTeX parse error: /, '') : '公式暂时无法排版' };
  }
  if (latex.length < 16_384 && result.html.length < 262_144) {
    const previous = cache.get(key);
    if (previous) cacheBytes -= entryBytes(key, previous);
    cache.set(key, result);
    cacheBytes += entryBytes(key, result);
    while (cache.size > 200 || cacheBytes > MAX_CACHE_BYTES) {
      const oldest = cache.keys().next().value!;
      cacheBytes -= entryBytes(oldest, cache.get(oldest)!);
      cache.delete(oldest);
    }
  }
  return result;
}

export function clearKatexCache(): void { cache.clear(); cacheBytes = 0; }
