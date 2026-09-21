import { convertFileSrc } from '@tauri-apps/api/core';
import type { ExportDocument } from './model';
import type { JSONContent } from '@tiptap/core';

/** One conversion per disposable worker; closing the dialog immediately releases its heap. */
function convert<T>(markdown: string | JSONContent, title: string, directory: string, format: 'html' | 'pandoc', signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./documentWorker.ts', import.meta.url), { type: 'module' });
    const close = () => { worker.terminate(); signal?.removeEventListener('abort', abort); };
    const abort = () => { close(); reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')); };
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<{ result?: T; error?: string }>) => {
      close(); if (data.error) reject(new Error(data.error)); else resolve(data.result!);
    };
    worker.onerror = event => { close(); reject(new Error(event.message || '文档转换失败')); };
    worker.onmessageerror = () => { close(); reject(new Error('无法读取转换结果')); };
    try { worker.postMessage({ markdown, title, directory, format }); } catch (error) { close(); reject(error); }
  });
}

export async function prepareDocument(content: string | JSONContent, title: string, directory: string, signal?: AbortSignal): Promise<ExportDocument> {
  const result = await convert<Pick<ExportDocument, 'html' | 'items' | 'markdown'> & { assets: string[] }>(content, title, directory, 'html', signal);
  const urls = result.assets.map(path => convertFileSrc(path).replace(/&/g, '&amp;').replace(/"/g, '&quot;'));
  const html = result.html.replace(/noteboard-export-asset:(\d+)/g, (_, index: string) => urls[Number(index)] ?? '');
  return { markdown: result.markdown, title, baseDirectory: directory, html, items: result.items };
}
export function preparePandoc(markdown: string, signal?: AbortSignal) {
  return convert<string>(markdown, '', '', 'pandoc', signal);
}
