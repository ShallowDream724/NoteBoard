import { DOMParser } from 'linkedom';
import { CLIPBOARD_LIMITS, normalizeClipboardDocument, normalizeClipboardText } from './normalize';
import { parseStructuredClipboard } from './structured';

self.onmessage = (event: MessageEvent<{ raw: string; kind: 'html' | 'document' | 'table' | 'text'; stripAnnotations?: boolean; inferTable?: boolean; tableContext?: boolean }>) => {
  try {
    const { raw, kind } = event.data;
    if (raw.length > CLIPBOARD_LIMITS.characters) throw new Error('剪贴板内容过大，请分段粘贴');
    if (kind === 'text') {
      self.postMessage({ ok: true, result: normalizeClipboardText(raw, event.data.inferTable, event.data.tableContext) });
    } else if (kind === 'document' || kind === 'table') {
      self.postMessage({ ok: true, result: parseStructuredClipboard(raw, kind === 'table', event.data.stripAnnotations) });
    } else {
      const document = new DOMParser().parseFromString(/<html[\s>]/i.test(raw) ? raw : `<html><body>${raw}</body></html>`, 'text/html');
      self.postMessage({ ok: true, result: normalizeClipboardDocument(document as unknown as Document, raw.length) });
    }
  } catch (error) { self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
};
