import { isolateHistory } from '@codemirror/commands';
import { ensureSyntaxTree, language } from '@codemirror/language';
import { countColumn, type ChangeSpec, type EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { getStyleTags, tags } from '@lezer/highlight';
import type { CodeOpsCapabilities } from '../../core/editor/editorTypes';
import type { LanguageId } from '../../core/ipc/types';

const detectionLimit = 512 * 1024;
const detectionLines = 10_000;
const parseDeadlineMs = 5_000;
const sliceMs = 12;
const noGrammar = new Set<LanguageId>(['plaintext', 'mermaid', 'plantuml']);
const literalNodes = new Set([
  'BlockLiteral', 'BlockFolded', 'CData', 'CDATA', 'FormatString',
  'JSXText', 'RawText', 'TemplateString',
]);
const yieldToView = () => new Promise<void>(resolve => setTimeout(resolve, 0));

type SyntaxTree = NonNullable<ReturnType<typeof ensureSyntaxTree>>;

function isLiteralIndent(tree: SyntaxTree | null, to: number): boolean {
  for (let node = tree?.resolveInner(to - 1, 1); node; node = node.parent ?? undefined) {
    if (node.from >= to || node.to < to) continue;
    if (literalNodes.has(node.name)) return true;
    // Text tokens in markup commonly include whitespace before the next tag.
    if (node.name === 'Text' && node.to > to) return true;
    const styles = getStyleTags(node)?.tags;
    if (styles?.some(tag => tag.set.includes(tags.string) || tag.set.includes(tags.comment))) return true;
  }
  return false;
}

async function scanIndentation(
  state: EditorState,
  languageId: LanguageId,
  isCurrent: () => boolean,
  visit: (indent: string, from: number) => void,
  to = state.doc.length,
): Promise<'done' | 'unavailable' | 'syntax-unavailable'> {
  let tree: SyntaxTree | null = null;
  if (!noGrammar.has(languageId)) {
    if (!state.facet(language)) return 'syntax-unavailable';
    const deadline = performance.now() + parseDeadlineMs;
    while (!(tree = ensureSyntaxTree(state, to, sliceMs))) {
      if (performance.now() >= deadline) return 'syntax-unavailable';
      await yieldToView();
      if (!isCurrent()) return 'unavailable';
    }
  }
  const endLine = state.doc.lineAt(to).number;
  const lines = state.doc.iterLines(1, endLine + 1);
  let from = 0;
  let lineNumber = 0;
  let sliceStart = performance.now();
  for (const line of lines) {
    const indent = /^[ \t]*/.exec(line)![0];
    if (indent.length < line.length && (!indent || !isLiteralIndent(tree, from + indent.length))) visit(indent, from);
    from += line.length + 1;
    if (++lineNumber % 256 === 0 && performance.now() - sliceStart >= sliceMs) {
      await yieldToView();
      if (!isCurrent()) return 'unavailable';
      sliceStart = performance.now();
    }
  }
  return isCurrent() ? 'done' : 'unavailable';
}

export function createIndentationOps(
  view: EditorView,
  getLanguage: () => LanguageId,
  isMounted: () => boolean,
  isReadonly: () => boolean,
): NonNullable<CodeOpsCapabilities['indentation']> {
  function stillCurrent(state: EditorState, languageId: LanguageId) {
    return isMounted() && !view.composing && view.state.doc === state.doc
      && getLanguage() === languageId && view.state.facet(language) === state.facet(language)
      && view.state.tabSize === state.tabSize;
  }
  return {
    async convert(insertSpaces) {
      const { state } = view;
      const languageId = getLanguage();
      const canConvert = () => stillCurrent(state, languageId) && !view.state.readOnly && !isReadonly();
      if (!canConvert()) return 'unavailable';
      const changes: ChangeSpec[] = [];
      const result = await scanIndentation(state, languageId, canConvert, (indent, from) => {
        if (!indent || (insertSpaces && !indent.includes('\t'))) return;
        const columns = countColumn(indent, state.tabSize);
        const replacement = insertSpaces
          ? ' '.repeat(columns)
          : '\t'.repeat(Math.floor(columns / state.tabSize)) + ' '.repeat(columns % state.tabSize);
        if (replacement !== indent) changes.push({ from, to: from + indent.length, insert: replacement });
      });
      if (result !== 'done') return result;
      if (!canConvert()) return 'unavailable';
      if (!changes.length) return 'unchanged';
      view.dispatch({ changes, annotations: isolateHistory.of('full'), userEvent: 'input.indent.convert' });
      return 'changed';
    },
    async detect() {
      const { state } = view;
      const languageId = getLanguage();
      const isCurrent = () => stillCurrent(state, languageId);
      if (!isCurrent()) return 'unavailable';
      const limit = Math.min(detectionLimit, state.doc.line(Math.min(detectionLines, state.doc.lines)).to);
      // Use a whole line so an incomplete prefix cannot become a detection signal.
      const lastLine = state.doc.lineAt(limit);
      if (lastLine.to > limit && lastLine.number === 1) return null;
      const to = lastLine.to > limit ? state.doc.line(lastLine.number - 1).to : limit;
      let spaces = 0;
      let tabs = 0;
      let previous: number | undefined = 0;
      const widths = new Map<number, number>();
      const result = await scanIndentation(state, languageId, isCurrent, indent => {
        if (indent.includes('\t')) {
          if (indent.startsWith('\t')) tabs++;
          previous = undefined;
          return;
        }
        if (indent) spaces++;
        const increase = indent.length - (previous ?? indent.length);
        if (increase >= 1 && increase <= 8) widths.set(increase, (widths.get(increase) ?? 0) + 1);
        previous = indent.length;
      }, to);
      if (result !== 'done') return result;
      if (!isCurrent()) return 'unavailable';
      if (tabs === spaces) return null;
      if (tabs > spaces) return { insertSpaces: false };
      const candidates = [...widths].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
      const preferred = candidates[0];
      // Larger tied multiples can be skipped levels of the same indentation unit.
      const tabSize = preferred && !candidates.some(([width, count]) => count === preferred[1] && width % preferred[0])
        ? preferred[0] : undefined;
      return tabSize ? { insertSpaces: true, tabSize } : { insertSpaces: true };
    },
  };
}
