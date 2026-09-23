/** Highlight data and serialization shared by editor and export workers. */
export interface CodeToken { from: number; to: number; className: string }

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function codeTokensToHTML(code: string, tokens: CodeToken[]): string {
  const parts: string[] = [];
  let offset = 0;
  for (const token of tokens) {
    parts.push(escape(code.slice(offset, token.from)), `<span class="${escape(token.className)}">`, escape(code.slice(token.from, token.to)), '</span>');
    offset = token.to;
  }
  parts.push(escape(code.slice(offset)));
  return parts.join('');
}
