import type { LinkedMergeConflict, LinkedTextPatch } from './linkedMarkdownUpdatesMerge';

export interface LinkedWorkerRequest {
  baselineSource: string; currentSource: string; projectedNative: string; externalNative: string; externalHash: string; accepted?: LinkedTextPatch[];
}
export type LinkedWorkerResult = LinkedMergeConflict | { kind: 'invalid'; message: string }
  | { kind: 'merged' | 'unchanged'; content: string; patches: LinkedTextPatch[]; changedBlocks: number };

/** Parsing, positional matching and re-encoding run off the UI thread. The
 * disposable worker releases its full snapshots as soon as this check finishes. */
export function prepareLinkedMarkdownMerge(request: LinkedWorkerRequest, signal?: AbortSignal): Promise<LinkedWorkerResult> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./linkedMarkdownUpdatesWorker.ts', import.meta.url), { type: 'module' });
    let closed = false;
    const close = () => {
      if (closed) return false;
      closed = true; worker.terminate(); signal?.removeEventListener('abort', abort);
      worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
      return true;
    };
    const abort = () => { if (close()) reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')); };
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<LinkedWorkerResult>) => { if (close()) resolve(data); };
    worker.onerror = event => { if (close()) reject(new Error(event.message || '关联 Markdown 合并失败')); };
    worker.onmessageerror = () => { if (close()) reject(new Error('无法读取关联 Markdown 的合并结果')); };
    try { worker.postMessage(request); } catch (error) { if (close()) reject(error); }
  });
}
