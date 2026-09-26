import { DOMParser, parseHTML } from 'linkedom/worker';

class FragmentDOMParser {
  parseFromString(source: string, type: string) {
    // Browser DOMParser supplies <html> for fragments; LinkeDOM does not.
    const html = type === 'text/html' && !/<html[\s>]/i.test(source)
      ? `<html><head></head>${/<body[\s>]/i.test(source) ? source : `<body>${source}</body>`}</html>` : source;
    return new DOMParser().parseFromString(html, type as 'text/html');
  }
}

/** Disposable worker only. Install before dynamically importing TipTap's grammar
 * so raw HTML embedded in Markdown uses the same parser semantics as the UI. */
export function installWorkerDocumentDom() {
  const dom = parseHTML('<!doctype html><html><body></body></html>');
  Object.assign(globalThis, { window: { document: dom.document, DOMParser: FragmentDOMParser }, document: dom.document, DOMParser: FragmentDOMParser });
}
