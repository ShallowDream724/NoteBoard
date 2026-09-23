import { checkRegexSearchRequest, regexSearchFailure, REGEX_SEARCH_LIMITS, type RegexSearchRequest, type RegexSearchResult } from './regexProtocol';
export { REGEX_SEARCH_LIMITS } from './regexProtocol';
export type { RegexSearchRequest, RegexSearchResult, RegexSearchSegment, RegexSearchLimit } from './regexProtocol';

/** One cancellable snapshot per worker. A caller owns its AbortController and
 * must reject stale document/query generations before applying the result.
 * Errors return no partial index; cancellation rejects with AbortError. */
export function searchRegex(request: RegexSearchRequest, options: { signal?: AbortSignal } = {}): Promise<RegexSearchResult> {
  if (options.signal?.aborted) return Promise.reject(new DOMException('Search cancelled', 'AbortError'));
  const refused = checkRegexSearchRequest(request);
  if (refused) return Promise.resolve(refused);
  if (!request.pattern) return Promise.resolve({ ranges: new Uint32Array() });
  if (typeof Worker === 'undefined') return Promise.resolve(regexSearchFailure('unavailable'));
  return new Promise((resolve, reject) => {
    let worker: Worker | undefined, finished = false;
    const clean = () => { clearTimeout(deadline); options.signal?.removeEventListener('abort', abort); worker?.terminate(); };
    const finish = (result: RegexSearchResult) => { if (finished) return; finished = true; clean(); resolve(result); };
    const abort = () => { if (finished) return; finished = true; clean(); reject(new DOMException('Search cancelled', 'AbortError')); };
    // The budget includes startup and matching. Compilation alone cannot prove
    // bounded execution, so no user expression ever runs on the main thread.
    const deadline = setTimeout(() => finish(regexSearchFailure('time')), REGEX_SEARCH_LIMITS.workerMilliseconds);
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
      worker = new Worker(new URL('./regexWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }: MessageEvent<RegexSearchResult>) => finish(data);
      worker.onerror = () => finish(regexSearchFailure('worker'));
      worker.onmessageerror = () => finish(regexSearchFailure('worker'));
      worker.postMessage(request);
    } catch { finish(regexSearchFailure('unavailable')); }
  });
}
