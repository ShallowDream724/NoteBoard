import { DOMParser, parseHTML } from 'linkedom/worker';
import type { ExportDocument, ExportInputFormat } from './model';
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

type Request = { type: 'convert'; markdown: string | JSONContent; title: string; directory: string; format: 'html' | 'standalone-html' | 'pandoc' | 'md' | 'noteboard'; inputFormat?: ExportInputFormat }
  | { type: 'asset-urls'; urls: string[] };
let started = false;
let receiveAssetUrls: ((urls: string[]) => void) | undefined;
self.onmessage = async ({ data }: MessageEvent<Request>) => {
  if (data.type === 'asset-urls') { const receive = receiveAssetUrls; receiveAssetUrls = undefined; receive?.(data.urls); return; }
  if (started) return;
  started = true;
  try {
    const content = typeof data.markdown === 'string' && data.inputFormat === 'noteboard'
      ? (await import('../../core/nativeDocument')).decodeNativeDocument(data.markdown) : data.markdown;
    if (data.format === 'md' || data.format === 'noteboard') {
      const json = typeof content !== 'string' ? content
        : (await import('../editor-md/documentExtensions')).parseMarkdownDocument(content).toJSON();
      const { rebaseDocumentReferences } = await import('../../core/documentReferences');
      rebaseDocumentReferences(json, data.directory);
      const result = data.format === 'md'
        ? (await import('./portableMarkdown')).portableMarkdown(json)
        : (await import('../../core/nativeDocument')).encodeNativeDocument(json);
      self.postMessage({ type: 'result', result });
      return;
    }
    if (data.format === 'pandoc') {
      const { pandocSource } = await import('./pandocDocument');
      const source = typeof content === 'string' ? content
        : (await import('../editor-md/documentExtensions')).documentParser().schema.nodeFromJSON(content);
      self.postMessage({ type: 'result', result: pandocSource(source) });
      return;
    }
    const snapshot = typeof content === 'string' ? { markdown: content, doc: null }
      : { markdown: '', doc: (await import('../editor-md/documentExtensions')).documentParser().schema.nodeFromJSON(content) };
    const [{ renderDocument }, { renderMathMarkup }] = await Promise.all([import('./renderDocument'), import('../editor-md/mathEngine')]);
    if (data.format === 'standalone-html') {
      const { standaloneHtml, localFileUrl } = await import('./standaloneHtml');
      const result = await renderDocument(snapshot.markdown, data.title, data.directory, undefined, snapshot.doc, renderMathMarkup, paths => paths.map(localFileUrl), 'html');
      self.postMessage({ type: 'result', result: standaloneHtml(result.html, data.title) });
      return;
    }
    const result = await renderDocument(snapshot.markdown, data.title, data.directory, undefined, snapshot.doc, renderMathMarkup,
      paths => new Promise<string[]>(resolve => { receiveAssetUrls = resolve; self.postMessage({ type: 'assets', paths }); }));
    const { html, items, richSummary }: ExportDocument = result;
    self.postMessage({ type: 'result', result: { html, items, richSummary, markdown: snapshot.markdown } });
  } catch (error) { self.postMessage({ type: 'error', error: error instanceof Error ? error.message : String(error) }); }
};
