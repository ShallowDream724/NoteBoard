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

self.onmessage = async ({ data }: MessageEvent<{ markdown: string | JSONContent; title: string; directory: string; format: 'html' | 'pandoc' }>) => {
  try {
    const snapshot = typeof data.markdown === 'string' ? { markdown: data.markdown, doc: null }
      : (await import('../editor-md/documentExtensions')).materializeDocument(data.markdown);
    if (data.format === 'pandoc') {
      const { pandocSource } = await import('./pandocDocument');
      self.postMessage({ result: pandocSource(snapshot.markdown) });
      return;
    }
    const [{ renderDocument }, { renderMathMarkup }] = await Promise.all([import('./renderDocument'), import('../editor-md/mathEngine')]);
    const assets: string[] = [];
    const result = await renderDocument(snapshot.markdown, data.title, data.directory, undefined, snapshot.doc, renderMathMarkup,
      path => { const index = assets.push(path) - 1; return `noteboard-export-asset:${index}`; });
    const { html, items }: ExportDocument = result;
    self.postMessage({ result: { html, items, assets, markdown: snapshot.markdown } });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
