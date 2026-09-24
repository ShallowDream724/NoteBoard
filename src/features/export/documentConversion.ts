import { convertFileSrc } from '@tauri-apps/api/core';
import type { ExportDocument } from './model';
import type { JSONContent } from '@tiptap/core';

/** One conversion per disposable worker; closing the dialog immediately releases its heap. */
function convert<T>(markdown: string | JSONContent, title: string, directory: string, format: 'html' | 'pandoc' | 'md' | 'nbdoc', signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./documentWorker.ts', import.meta.url), { type: 'module' });
    let closed = false;
    const close = () => {
      if (closed) return false;
      closed = true; worker.terminate(); signal?.removeEventListener('abort', abort);
      worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
      return true;
    };
    const fail = (error: unknown) => { if (close()) reject(error); };
    const abort = () => fail(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<{ type: 'assets'; paths: string[] } | { type: 'result'; result: T } | { type: 'error'; error: string }>) => {
      if (closed) return;
      if (data.type === 'assets') {
        try { worker.postMessage({ type: 'asset-urls', urls: data.paths.map(path => convertFileSrc(path)) }); }
        catch (error) { fail(error); }
      } else if (data.type === 'error') fail(new Error(data.error));
      else if (data.type === 'result' && close()) resolve(data.result);
    };
    worker.onerror = event => fail(new Error(event.message || '文档转换失败'));
    worker.onmessageerror = () => fail(new Error('无法读取转换结果'));
    try { worker.postMessage({ type: 'convert', markdown, title, directory, format }); } catch (error) { fail(error); }
  });
}

export async function prepareDocument(content: string | JSONContent, title: string, directory: string, signal?: AbortSignal): Promise<ExportDocument> {
  const result = await convert<Pick<ExportDocument, 'html' | 'items' | 'markdown'>>(content, title, directory, 'html', signal);
  return { ...result, title, baseDirectory: directory };
}
export function preparePandoc(markdown: string | JSONContent, signal?: AbortSignal) {
  return convert<string>(markdown, '', '', 'pandoc', signal);
}
export function prepareTextExport(content: string | JSONContent, format: 'md' | 'nbdoc', directory: string, signal?: AbortSignal) {
  return convert<string>(content, '', directory, format, signal);
}
