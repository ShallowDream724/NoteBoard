import { installWorkerDocumentDom } from '../../../core/workerDocumentDom';
import { CLIPBOARD_LIMITS } from './normalize';
import { parseStructuredClipboard } from './structured';
import type { ExternalTextOptions } from './external';

installWorkerDocumentDom();
self.onmessage = async (event: MessageEvent<ExternalTextOptions & { raw: string; kind: 'html' | 'document' | 'table' | 'text' | 'markdown'; plainText?: string }>) => {
  try {
    const { raw, kind } = event.data;
    if (raw.length > CLIPBOARD_LIMITS.characters) throw new Error('剪贴板内容过大，请分段粘贴');
    const { clipboardHtmlSource, normalizeExternalHtml, normalizeExternalText } = await import('./external');
    if (kind === 'text' || kind === 'markdown') {
      self.postMessage({ ok: true, result: normalizeExternalText(raw, event.data, kind === 'markdown') });
    } else if (kind === 'document' || kind === 'table') {
      self.postMessage({ ok: true, result: parseStructuredClipboard(raw, kind === 'table', event.data.stripAnnotations) });
    } else {
      const html = clipboardHtmlSource(raw);
      const document = new DOMParser().parseFromString(/<html[\s>]/i.test(html) ? html : `<html><body>${html}</body></html>`, 'text/html');
      self.postMessage({ ok: true, result: normalizeExternalHtml(document, raw, event.data.plainText, event.data) });
    }
  } catch (error) { self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
};
