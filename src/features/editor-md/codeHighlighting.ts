import { normalizeLanguage } from './codeLanguages';

export interface CodeToken { from: number; to: number; className: string }
interface Tree { type: string; value?: string; properties?: { className?: string[] }; children?: Tree[] }
let engine: Promise<typeof import('./lowlight')> | undefined;

/** Shared tokenization; callers choose decorations or read-only HTML, never mutate editable DOM. */
export async function highlightCode(code: string, language: string): Promise<CodeToken[]> {
  const name = normalizeLanguage(language);
  if (!code || name === 'plaintext' || code.length > 200_000) return [];
  const { getLowlight } = await (engine ??= import('./lowlight'));
  const lowlight = getLowlight();
  if (!lowlight.registered(name)) return [];
  const tokens: CodeToken[] = [];
  let offset = 0;
  const walk = (tree: Tree, classes: string[]) => {
    if (tree.type === 'text') {
      const end = offset + (tree.value?.length ?? 0);
      if (classes.length && end > offset) tokens.push({ from: offset, to: end, className: classes.join(' ') });
      offset = end;
    } else {
      const next = [...classes, ...(tree.properties?.className ?? [])];
      tree.children?.forEach(child => walk(child, next));
    }
  };
  try { walk(lowlight.highlight(name, code) as Tree, []); } catch { return []; }
  return tokens;
}

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function codeTokensToHTML(code: string, tokens: CodeToken[]): string {
  let html = '', offset = 0;
  for (const token of tokens) {
    html += escape(code.slice(offset, token.from)) + `<span class="${escape(token.className)}">${escape(code.slice(token.from, token.to))}</span>`;
    offset = token.to;
  }
  return html + escape(code.slice(offset));
}
