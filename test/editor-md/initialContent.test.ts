import { expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { getMarkdownManager, initializeMarkdownContent, parseMarkdown, serializeMarkdown } from '../../src/features/editor-md/serialize';

it.each(['# First\n\n$x^2$\n\n| A | B |\n| --- | --- |\n| 1 | 2 |', '', '   \n'])('constructs the initial document once and skips redundant replacement: %s', markdown => {
  let parseCalls = 0;
  const editor = new Editor({
    extensions: buildDocumentExtensions(), content: '',
    onBeforeCreate: ({ editor }) => {
      const manager = getMarkdownManager(editor)!;
      const original = manager.parse!.bind(manager);
      manager.parse = (...args) => { parseCalls++; return original(...args); };
      initializeMarkdownContent(editor, markdown);
    },
  });
  try {
    const doc = editor.state.doc;
    const before = serializeMarkdown(editor);
    expect(doc.childCount).toBeGreaterThan(0);
    if (markdown.trim()) expect(doc.firstChild?.type.name).toBe('heading');
    const transaction = vi.fn(); editor.on('transaction', transaction);
    parseMarkdown(editor, markdown);
    expect(editor.state.doc).toBe(doc);
    expect(transaction).not.toHaveBeenCalled();
    expect(parseCalls).toBe(markdown.trim() ? 1 : 0);
    editor.commands.insertContent('changed');
    parseMarkdown(editor, markdown);
    expect(serializeMarkdown(editor)).toBe(before);
  } finally { editor.destroy(); }
});

it('keeps the original text when initial parsed JSON is invalid for the schema', () => {
  const markdown = '# keep this original text';
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const editor = new Editor({ extensions: buildDocumentExtensions(), content: '', onBeforeCreate: ({ editor }) => {
    const manager = getMarkdownManager(editor)!;
    manager.parse = () => ({ type: 'unknown-node' } as unknown as ReturnType<Editor['getJSON']>);
    initializeMarkdownContent(editor, markdown);
  } });
  try {
    expect(editor.state.doc.textContent).toBe(markdown);
    expect(editor.state.doc.firstChild?.type.name).toBe('paragraph');
    parseMarkdown(editor, markdown);
    expect(editor.state.doc.textContent).toBe(markdown);
  } finally { editor.destroy(); error.mockRestore(); }
});

it('rebinds the exact source when history keeps the same document tree', () => {
  const editor = new Editor({ extensions: buildDocumentExtensions() });
  try {
    parseMarkdown(editor, '**same**\n');
    const doc = editor.state.doc;
    expect(serializeMarkdown(editor)).toBe('**same**\n');
    parseMarkdown(editor, '__same__\r\n', 'history');
    expect(editor.state.doc).toBe(doc);
    expect(serializeMarkdown(editor)).toBe('__same__\r\n');
  } finally { editor.destroy(); }
});

it('keeps source bytes through synchronizing a file with an unavailable parser', () => {
  const editor = new Editor({ extensions: buildDocumentExtensions() });
  const manager = getMarkdownManager(editor)!;
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const source = '\r\n__original__   \r\n';
  try {
    manager.parse = () => { throw new Error('parser unavailable'); };
    parseMarkdown(editor, source);
    expect(editor.state.doc.textContent).toBe(source);
    expect(serializeMarkdown(editor)).toBe(source);
  } finally { editor.destroy(); error.mockRestore(); }
});
