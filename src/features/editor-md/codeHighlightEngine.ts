import { highlightTree } from '@lezer/highlight';
import { cssSyntaxHighlighter } from '../../core/cssSyntaxHighlight';
import { loadCodeLanguage } from './codeLanguageLoader';
import type { CodeToken } from './codeTokens';
import { CODE_HIGHLIGHT_LIMIT, getCodeLanguage } from './codeLanguages';

interface Tree { type: string; value?: string; properties?: { className?: string[] }; children?: Tree[] }
class TokenBudgetExceeded extends Error {}

/** The editor uses the same CSS grammar as source mode. Export retains its own rendering. */
export function tokenizeEditorCode(code: string, language: string): Promise<CodeToken[]> {
  return tokenize(code, language, getCodeLanguage(language)?.grammar === 'css');
}

export function tokenizeCode(code: string, language: string): Promise<CodeToken[]> {
  return tokenize(code, language, false);
}

async function tokenize(code: string, language: string, useCssParser: boolean): Promise<CodeToken[]> {
  if (!code || code.length > CODE_HIGHLIGHT_LIMIT) return [];
  const tokens: CodeToken[] = [];
  let bytes = 0;
  const addToken = (from: number, to: number, className: string) => {
    bytes += 48 + className.length * 2;
    // Keep the worker budget independent of the editor's visible token window.
    if (tokens.length >= 131_072 || bytes > 12 * 1024 * 1024) throw new TokenBudgetExceeded();
    tokens.push({ from, to, className });
  };
  let offset = 0;
  const walk = (tree: Tree, classes: string[]) => {
    if (tree.type === 'text') {
      const end = offset + (tree.value?.length ?? 0);
      if (classes.length && end > offset) addToken(offset, end, classes.join(' '));
      offset = end;
    } else {
      const next = [...classes, ...(tree.properties?.className ?? [])];
      tree.children?.forEach(child => walk(child, next));
    }
  };
  try {
    if (useCssParser) {
      const { cssLanguage } = await import('@codemirror/lang-css');
      highlightTree(cssLanguage.parser.parse(code), cssSyntaxHighlighter, addToken);
    } else {
      const loaded = await loadCodeLanguage(language);
      if (loaded) walk(loaded.lowlight.highlight(loaded.grammar, code) as Tree, []);
    }
  }
  catch (error) {
    // A deterministic size limit is a successful plain-code fallback. Parser
    // failures must reach the worker's unavailable result, never its ready cache.
    if (error instanceof TokenBudgetExceeded) return [];
    throw error;
  }
  return tokens;
}
