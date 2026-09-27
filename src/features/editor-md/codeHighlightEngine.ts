import { loadCodeLanguage } from './codeLanguageLoader';
import type { CodeToken } from './codeTokens';
import { CODE_HIGHLIGHT_LIMIT } from './codeLanguages';

interface Tree { type: string; value?: string; properties?: { className?: string[] }; children?: Tree[] }
class TokenBudgetExceeded extends Error {}

/** Runs inside code/export workers (or direct engine tests), without UI state. */
export async function tokenizeCode(code: string, language: string): Promise<CodeToken[]> {
  if (!code || code.length > CODE_HIGHLIGHT_LIMIT) return [];
  const loaded = await loadCodeLanguage(language);
  if (!loaded) return [];
  const tokens: CodeToken[] = [];
  let offset = 0, bytes = 0;
  const walk = (tree: Tree, classes: string[]) => {
    if (tree.type === 'text') {
      const end = offset + (tree.value?.length ?? 0);
      if (classes.length && end > offset) {
        const className = classes.join(' ');
        bytes += 48 + className.length * 2;
        // A 10,000-line block is parsed off-thread, then only its visible token
        // window enters the editor DOM. Keep a separate bounded worker budget.
        if (tokens.length >= 131_072 || bytes > 12 * 1024 * 1024) throw new TokenBudgetExceeded();
        tokens.push({ from: offset, to: end, className });
      }
      offset = end;
    } else {
      const next = [...classes, ...(tree.properties?.className ?? [])];
      tree.children?.forEach(child => walk(child, next));
    }
  };
  try { walk(loaded.lowlight.highlight(loaded.grammar, code) as Tree, []); }
  catch (error) {
    // A deterministic size limit is a successful plain-code fallback. Parser
    // failures must reach the worker's unavailable result, never its ready cache.
    if (error instanceof TokenBudgetExceeded) return [];
    throw error;
  }
  return tokens;
}
