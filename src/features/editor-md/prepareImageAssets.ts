import { hasPendingImageAssets, imageExtension, publishImageAsset } from './imageAssetStorage';
import type { PreparedImageSources } from './imageAssetSource';

export async function prepareDocumentImageAssets(source: string, format: 'noteboard' | 'markdown', target: string, absolute = false, signal?: AbortSignal): Promise<PreparedImageSources> {
  signal?.throwIfAborted();
  if (!hasPendingImageAssets(source)) return { content: source, references: [], changes: [] };
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./imageAssetWorker.ts', import.meta.url), { type: 'module' });
    let closed = false;
    const finish = () => { if (closed) return false; closed = true; worker.terminate(); signal?.removeEventListener('abort', abort); worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; return true; };
    const fail = (error: unknown) => { if (finish()) reject(error); };
    const abort = () => fail(signal?.reason ?? new DOMException('图片保存已取消', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = async ({ data }: MessageEvent<{ type: 'asset'; source: string; bytes?: ArrayBuffer; mime: string } | { type: 'result'; result: PreparedImageSources } | { type: 'error'; error: string }>) => {
      if (closed) return;
      if (data.type === 'result') { if (finish()) resolve(data.result); }
      else if (data.type === 'error') fail(new Error(data.error));
      else try {
        const result = await publishImageAsset(data.source, data.bytes ? new Uint8Array(data.bytes) : undefined, imageExtension(data.source, data.mime), target, absolute);
        if (!closed) worker.postMessage({ type: 'stored', source: result });
      } catch (error) { fail(error); }
    };
    worker.onerror = event => fail(new Error(event.message || '无法准备图片资源'));
    worker.onmessageerror = () => fail(new Error('无法读取图片资源结果'));
    try { worker.postMessage({ type: 'prepare', source, format }); } catch (error) { fail(error); }
  });
}
