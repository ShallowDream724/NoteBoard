import { getLowlight } from './lowlight';
import type { CodeToken } from './codeTokens';
import { normalizeLanguage } from './codeLanguages';

interface Tree { type: string; value?: string; properties?: { className?: string[] }; children?: Tree[] }

/** Runs inside code/export workers (or direct engine tests), without UI state. */
export function tokenizeCode(code: string, language: string): CodeToken[] {
  language = normalizeLanguage(language);
  const lowlight = getLowlight();
  if (!code || code.length > 200_000 || !lowlight.registered(language)) return [];
  const tokens: CodeToken[] = [];
  let offset = 0, bytes = 0;
  const walk = (tree: Tree, classes: string[]) => {
    if (tree.type === 'text') {
      const end = offset + (tree.value?.length ?? 0);
      if (classes.length && end > offset) {
        const className = classes.join(' ');
        bytes += 48 + className.length * 2;
        if (tokens.length >= 16_384 || bytes > 2 * 1024 * 1024) throw new Error('Token budget exceeded');
        tokens.push({ from: offset, to: end, className });
      }
      offset = end;
    } else {
      const next = [...classes, ...(tree.properties?.className ?? [])];
      tree.children?.forEach(child => walk(child, next));
    }
  };
  try { walk(lowlight.highlight(language, code) as Tree, []); } catch { return []; }
  return tokens;
}
