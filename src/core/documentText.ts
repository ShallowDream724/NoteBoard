/** Compare decoded file text consistently across platforms, without normalizing its grammar. */
export function normalizeDocumentEol(text: string): string {
  return text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text;
}
