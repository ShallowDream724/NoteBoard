import { describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { OrderedList, TaskList } from '@tiptap/extension-list';
import { marked } from 'marked';
import { buildDocumentExtensions, parseMarkdownDocument } from '../../src/features/editor-md/documentExtensions';

const tokenizerCounts = (lexer: typeof marked) => Object.fromEntries(
  ['block', 'inline', 'startBlock', 'startInline'].map(name => [name,
    (lexer.defaults.extensions as Record<string, unknown[]> | undefined)?.[name]?.length ?? 0]),
);

describe('document lexer ownership and bounded probes', () => {
  it('editor creation, destruction and pure parsing never append tokenizers to another owner', () => {
    const globalCounts = tokenizerCounts(marked);
    const first = new Editor({ extensions: buildDocumentExtensions() });
    try {
      const firstLexer = first.storage.markdown.manager.instance;
      const firstCounts = tokenizerCounts(firstLexer);
      expect(firstLexer).not.toBe(marked);
      for (let i = 0; i < 5; i++) {
        const editor = new Editor({ extensions: buildDocumentExtensions() });
        try {
          const lexer = editor.storage.markdown.manager.instance;
          expect(lexer).not.toBe(firstLexer);
          expect(lexer).not.toBe(marked);
          expect(tokenizerCounts(lexer)).toEqual(firstCounts);
          parseMarkdownDocument(`paragraph ${i}\n\n$x$`);
          expect(tokenizerCounts(firstLexer)).toEqual(firstCounts);
        } finally { editor.destroy(); }
      }
      expect(tokenizerCounts(marked)).toEqual(globalCounts);
    } finally { first.destroy(); }
  });

  it('ordinary paragraphs do not enter list tokenizers that split the remaining document', () => {
    const ordered = vi.spyOn(OrderedList.config.markdownTokenizer!, 'tokenize');
    const task = vi.spyOn(TaskList.config.markdownTokenizer!, 'tokenize');
    try {
      const source = Array.from({ length: 400 }, (_, i) => `paragraph ${i} **body**`).join('\n\n');
      expect(parseMarkdownDocument(source).childCount).toBe(400);
      expect(ordered).not.toHaveBeenCalled();
      expect(task).not.toHaveBeenCalled();
    } finally { ordered.mockRestore(); task.mockRestore(); }
  });

  it.each([
    ['1. one\n2. two', 'orderedList', 'one'],
    ['a. alpha\nb. beta', 'orderedList', 'alpha'],
    ['I. first\nII. second', 'orderedList', 'first'],
    ['  1) one\n  2) two', 'orderedList', 'one'],
    ['- [ ] one\n- [x] two\n  - [ ] nested', 'taskList', 'nested'],
  ])('candidate list prefixes preserve the upstream grammar: %s', (source, type, text) => {
    const doc = parseMarkdownDocument(source);
    expect(doc.firstChild?.type.name).toBe(type);
    expect(doc.textContent).toContain(text);
    expect(doc.firstChild?.childCount).toBe(2);
  });

  it.each(['', '\n', '\n \t\n'])('math and alerts still interrupt paragraphs across %j boundaries', boundary => {
    const source = `before\n${boundary}$$\nx+1\n$$\n\nafter\n${boundary}> [!NOTE]\n> note`;
    const types: string[] = [];
    parseMarkdownDocument(source).forEach(node => types.push(node.type.name));
    expect(types).toEqual(['paragraph', 'mathBlock', 'paragraph', 'githubAlert']);
  });
});
