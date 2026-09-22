import { DOMParser, parseHTML } from 'linkedom/worker';
import type { ExportDocument } from './model';
import type { JSONContent } from '@tiptap/core';

// A DOM implementation only inside this disposable worker. It also preserves
// raw-HTML Markdown parsing, which TipTap otherwise treats literally in workers.
const dom = parseHTML('<!doctype html><html><body></body></html>');
class FragmentDOMParser {
  parseFromString(source: string, type: string) {
    // TipTap passes <body> fragments. Browser DOMParser supplies <html>; LinkeDOM
    // deliberately does not, so normalize that boundary explicitly.
    const html = type === 'text/html' && !/<html[\s>]/i.test(source)
      ? `<html><head></head>${/<body[\s>]/i.test(source) ? source : `<body>${source}</body>`}</html>` : source;
    return new DOMParser().parseFromString(html, type as 'text/html');
  }
}
Object.assign(globalThis, { window: { document: dom.document, DOMParser: FragmentDOMParser }, document: dom.document, DOMParser: FragmentDOMParser });

type Request = { type: 'convert'; markdown: string | JSONContent; title: string; directory: string; format: 'html' | 'pandoc' }
  | { type: 'asset-urls'; urls: string[] };
let started = false;
let receiveAssetUrls: ((urls: string[]) => void) | undefined;
self.onmessage = async ({ data }: MessageEvent<Request>) => {
  if (data.type === 'asset-urls') { const receive = receiveAssetUrls; receiveAssetUrls = undefined; receive?.(data.urls); return; }
  if (started) return;
  started = true;
  try {
    const snapshot = typeof data.markdown === 'string' ? { markdown: data.markdown, doc: null }
      : (await import('../editor-md/documentExtensions')).materializeDocument(data.markdown);
    if (data.format === 'pandoc') {
      const { pandocSource } = await import('./pandocDocument');
      self.postMessage({ type: 'result', result: pandocSource(snapshot.markdown) });
      return;
    }
    const [{ renderDocument }, { renderMathMarkup }] = await Promise.all([import('./renderDocument'), import('../editor-md/mathEngine')]);
    const result = await renderDocument(snapshot.markdown, data.title, data.directory, undefined, snapshot.doc, renderMathMarkup,
      paths => new Promise<string[]>(resolve => { receiveAssetUrls = resolve; self.postMessage({ type: 'assets', paths }); }));
    const { html, items }: ExportDocument = result;
    self.postMessage({ type: 'result', result: { html, items, markdown: snapshot.markdown } });
  } catch (error) { self.postMessage({ type: 'error', error: error instanceof Error ? error.message : String(error) }); }
};
