import type { Eol } from './ipc/types';

/** Compare decoded file text consistently across platforms, without normalizing its grammar. */
export function normalizeDocumentEol(text: string): string {
  return text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text;
}

/** Match the native writer when tracking the text actually stored on disk. */
export function textWithEol(text: string, eol: Eol): string {
  const normalized = normalizeDocumentEol(text);
  return eol === 'crlf' ? normalized.replace(/\n/g, '\r\n') : normalized;
}
