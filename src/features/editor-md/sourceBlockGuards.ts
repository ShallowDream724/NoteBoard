import { syntaxTree } from '@codemirror/language';
import { ChangeSet, type EditorState } from '@codemirror/state';
import type { MarkdownToken } from '@tiptap/core';
import { documentParser } from './documentExtensions';
import { readMath } from './mathSyntax';
import { inlineMathCarrier } from './inlineMathCarrier';

export interface SourceParagraph { from: number; to: number; quoted: boolean; quoteDepth: number; listIndent: number }
const containers = new Set(['blockquote', 'list', 'githubAlert']);
const punctuation = /[!#$%&*+,\-./:;<=>?@\\^_`{|}~]/;

function childBlocks(token: MarkdownToken): MarkdownToken[] {
  if (!containers.has(token.type ?? '')) return [];
  return token.items?.flatMap(item => item.tokens ?? []) ?? token.tokens ?? [];
}
function ownerTypes(tokens: MarkdownToken[], result = new Set<string>()) {
  for (const token of tokens) {
    if (token.type && token.type !== 'space') result.add(token.type);
    ownerTypes(childBlocks(token), result);
  }
  return result;
}
const newlines = (text: string) => { let count = 0; for (const char of text) if (char === '\n') count++; return count; };

/** Classify only affected paragraphs with the application's existing block
 * grammar. Contextual Setext/table/Callout ownership never needs another list
 * of delimiter regexes. No full-document tree or persistent cache is created. */
export function guardContextualBlocks(state: EditorState, edits: ChangeSet, paragraphs: Iterable<SourceParagraph>, touched: Map<number, number>): ChangeSet {
  const next = edits.apply(state.doc), tree = syntaxTree(state), guards: { from: number; to?: number; insert: string }[] = [];
  const protectedLines = new Set<number>(), lexer = documentParser().manager.instance;
  for (const context of paragraphs) {
    const first = state.doc.lineAt(context.from), last = state.doc.lineAt(context.to);
    const prefixes = new Map<number, number>(), math: { from: number; to: number }[] = [];
    tree.iterate({ from: context.from, to: context.to, enter(node) {
      if (['QuoteMark', 'ListMark'].includes(node.name)) { const line = state.doc.lineAt(node.from); prefixes.set(line.number, Math.max(prefixes.get(line.number) ?? 0, node.to)); }
      if (node.name === 'NBMath') math.push({ from: node.from, to: node.to });
    } });
    const lines: { number: number; from: number; to: number }[] = [];
    for (let number = first.number; number <= last.number; number++) {
      const line = state.doc.line(number); let from = Math.max(line.from, context.from, prefixes.get(number) ?? 0);
      // An opaque math span can cover continuation QuoteMarks in the inline
      // tree. Recover only the known ancestor quote prefixes, not TeX's own >.
      if (number !== first.number && context.quoteDepth) {
        let at = line.from;
        for (let depth = 0; depth < context.quoteDepth; depth++) {
          const prefixStart = at;
          let spaces = 0; while (spaces < 3 && state.doc.sliceString(at, at + 1) === ' ') { at++; spaces++; }
          if (state.doc.sliceString(at, at + 1) !== '>') { at = prefixStart; break; }
          at++; if (/[ \t]/.test(state.doc.sliceString(at, at + 1))) at++;
        }
        from = Math.max(from, at);
      }
      if (from === prefixes.get(number) && /[ \t]/.test(state.doc.sliceString(from, from + 1))) from++;
      // Lists de-indent continuation content before invoking their block parser.
      // Use the original AST content column, including nested/quoted lists.
      if (number !== first.number) while (from < line.from + context.listIndent && /[ \t]/.test(state.doc.sliceString(from, from + 1))) from++;
      lines.push({ number, from, to: Math.min(line.to, context.to) });
    }
    const project = (after: boolean) => lines.map(line => (context.quoted ? '> ' : '') + (after
      ? next.sliceString(edits.mapPos(line.from, -1), edits.mapPos(line.to, 1)) : state.doc.sliceString(line.from, line.to))).join('\n');
    const before = ownerTypes(lexer.lexer(project(false)) as MarkdownToken[]), after = lexer.lexer(project(true)) as MarkdownToken[];
    const visit = (tokens: MarkdownToken[], firstLine = 0) => {
      let lineIndex = firstLine;
      for (const token of tokens) {
        const raw = token.raw ?? '';
        if (token.type && token.type !== 'space' && !before.has(token.type)) {
          const delimiter = token.type === 'table' ? lineIndex + 1
            : token.type === 'heading' && !/^ {0,3}#/.test(raw) ? lineIndex + newlines(raw.trimEnd()) : lineIndex;
          const line = lines[delimiter];
          if (token.type === 'mathBlock' && line) {
            const endLine = lines[Math.min(lines.length - 1, lineIndex + newlines(raw.trimEnd()))];
            const atom = math.find(atom => atom.from >= line.from && atom.to <= endLine.to);
            const atomRaw = atom && lines.filter(line => line.to >= atom.from && line.from <= atom.to)
              .map(line => state.doc.sliceString(Math.max(line.from, atom.from), Math.min(line.to, atom.to))).join('\n');
            const source = atomRaw && readMath(atomRaw);
            if (atom && source) {
              guards.push({ from: edits.mapPos(atom.from, -1), to: edits.mapPos(atom.to, 1), insert: inlineMathCarrier(source) });
              for (let number = line.number; number <= endLine.number; number++) protectedLines.add(number);
              lineIndex += newlines(raw); continue;
            }
          }
          if (line && touched.has(line.number) && !protectedLines.has(line.number)) {
            const from = edits.mapPos(line.from, -1), to = edits.mapPos(line.to, 1), text = next.sliceString(from, to);
            // Only an unescaped opener/separator is eligible. Brackets and
            // parentheses are omitted because escaping them creates TeX fences.
            let escaped = false;
            for (let at = 0; at < text.length; at++) {
              const char = text[at];
              if (char === '\\') { escaped = !escaped; continue; }
              if (!escaped && punctuation.test(char)) { guards.push({ from: from + at, insert: '\\' }); protectedLines.add(line.number); break; }
              escaped = false;
            }
          }
        }
        visit(childBlocks(token), lineIndex);
        lineIndex += newlines(raw);
      }
    };
    visit(after);
  }
  return guards.length ? edits.compose(ChangeSet.of(guards.sort((a, b) => a.from - b.from), next.length)) : edits;
}
