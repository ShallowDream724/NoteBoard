import { Editor } from '@tiptap/core';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { buildDocumentExtensions, parseMarkdownDocument, materializeDocument } from '../../src/features/editor-md/documentExtensions';
import { sourceFormattingGrammar } from '../../src/features/editor-md/sourceFormattingGrammar';
import { closeHistory } from '@tiptap/pm/history';
import { InlineFormattingInput } from '../../src/features/editor-md/inlineFormattingInput';
import { supportsAutomaticMarks, DocumentCapabilityGuard } from '../../src/features/document-format/capabilityGuard';

vi.stubGlobal('ClipboardEvent', class extends Event { clipboardData = null; });
afterAll(() => vi.unstubAllGlobals());

const cases = [
  ['**', ['bold'], 'StrongEmphasis'], ['*', ['italic'], 'Emphasis'], ['***', ['bold', 'italic'], 'StrongEmphasis'],
  ['__', ['bold'], 'StrongEmphasis'], ['_', ['italic'], 'Emphasis'], ['___', ['bold', 'italic'], 'StrongEmphasis'],
  ['~~', ['strike'], 'Strikethrough'], ['==', ['highlight'], 'NBHighlight'], ['++', ['underline'], 'NBUnderline'],
] as const;
function input(editor: Editor, text: string) {
  const { from, to } = editor.state.selection;
  const handled = editor.view.someProp('handleTextInput', handler => handler(editor.view, from, to, text, () => editor.state.tr.insertText(text)));
  if (!handled) editor.view.dispatch(editor.state.tr.insertText(text, from, to));
}
function marks(source: string) {
  const result: { text: string; marks: string[] }[] = [];
  parseMarkdownDocument(source).descendants(node => { if (node.isText) result.push({ text: node.text!, marks: node.marks.map(mark => mark.type.name) }); });
  return result;
}

describe('one CJK formatting grammar', () => {
  it.each(cases)('reads and round-trips adjacent punctuation with %s', (delimiter, expected) => {
    const source = `所以，${delimiter}得到两种分子。${delimiter}这就是来源。`;
    expect(marks(source)).toContainEqual({ text: '得到两种分子。', marks: expect.arrayContaining([...expected]) });
    const original = parseMarkdownDocument(source);
    expect(parseMarkdownDocument(materializeDocument(original.toJSON()).markdown).toJSON()).toEqual(original.toJSON());
  });
  it.each(cases)('source highlighting agrees for %s', (delimiter, _marks, node) => {
    const source = `所以，${delimiter}得到两种分子。${delimiter}这就是来源。`;
    const state = EditorState.create({ doc: source, extensions: [markdown({ extensions: sourceFormattingGrammar })] });
    expect(syntaxTree(state).toString()).toContain(node);
  });
  it.each(cases)('typing agrees for %s and leaves following Chinese outside', (delimiter, expected) => {
    const editor = new Editor({ extensions: buildDocumentExtensions(), content: '<p>所以，</p>' });
    try {
      editor.commands.setTextSelection(4);
      // Start with the source before the final keystroke, including nested runs.
      editor.view.dispatch(editor.state.tr.insertText(delimiter + '得到两种分子。' + delimiter.slice(0, -1)));
      input(editor, delimiter.at(-1)!);
      expect(editor.state.doc.textContent).toBe('所以，得到两种分子。');
      expect(editor.state.doc.firstChild!.lastChild!.marks.map(mark => mark.type.name)).toEqual(expect.arrayContaining([...expected]));
      input(editor, '这就是来源。');
      expect(editor.state.doc.firstChild!.lastChild!.marks).toHaveLength(0);
    } finally { editor.destroy(); }
  });
  it.each(cases)('pasting agrees for %s', (delimiter, expected) => {
    const editor = new Editor({ extensions: buildDocumentExtensions(), content: '<p></p>' });
    try {
      editor.view.pasteText(`所以，${delimiter}得到两种分子。${delimiter}这就是来源。`);
      expect(editor.state.doc.textContent).toBe('所以，得到两种分子。这就是来源。');
      expect(editor.state.doc.firstChild!.child(1).marks.map(mark => mark.type.name)).toEqual(expect.arrayContaining([...expected]));
    } finally { editor.destroy(); }
  });
  it.each(cases)('continuous typing and history preserve %s', (delimiter, expected) => {
    const editor = new Editor({ extensions: buildDocumentExtensions(), content: '<p></p>' });
    try {
      for (const character of `所以，${delimiter}得到两种分子。${delimiter}`) input(editor, character);
      const json = editor.getJSON();
      expect(editor.state.doc.textContent).toBe('所以，得到两种分子。');
      expect(editor.state.doc.firstChild!.lastChild!.marks.map(mark => mark.type.name)).toEqual(expect.arrayContaining([...expected]));
      editor.commands.undo(); expect(editor.getJSON()).not.toEqual(json); editor.commands.redo();
      expect(editor.getJSON()).toEqual(json);
    } finally { editor.destroy(); }
  });
  it.each(['中文**“引用”**中文', '中文_斜体。_中文', '𠮷__词。__𠮷', '日本語**文。**です', '한국어**글。**다'])('recognizes CJK boundaries: %s', source => {
    expect(marks(source).some(node => node.marks.length)).toBe(true);
  });
  it.each(['foo_bar_baz', 'a__b__c', String.raw`\*\*中文。\*\*`, '`**中文。**`', '$a_{**中文。**}$', '[链接](https://example.com/a_中文_b)'])('protects non-formatting contexts: %s', source => {
    expect(marks(source).flatMap(node => node.marks)).not.toContain('bold');
    expect(marks(source).flatMap(node => node.marks)).not.toContain('italic');
  });
  it('keeps the upstream delimiter-run rules and nested code', () => {
    expect(marks('***中文。***中文 **a `*code*` b。**尾')).toEqual(expect.arrayContaining([
      { text: '中文。', marks: expect.arrayContaining(['bold', 'italic']) },
      { text: '*code*', marks: expect.arrayContaining(['bold', 'code']) },
    ]));
  });
  it.each(['==', '++'])('protects code delimiters inside %s', delimiter => {
    const result = marks(`前${delimiter}甲。 \`${delimiter}\` 乙。${delimiter}后`);
    expect(result).toContainEqual({ text: delimiter, marks: expect.arrayContaining(['code', delimiter === '==' ? 'highlight' : 'underline']) });
    expect(result.at(-1)).toEqual({ text: '后', marks: [] });
  });
  it('protects formula delimiters inside emphasis', () => {
    const doc = parseMarkdownDocument('前**甲。 $x**y$ 乙。**后');
    expect(doc.firstChild!.child(2).type.name).toBe('mathInline');
    expect(doc.firstChild!.child(2).attrs.latex).toBe('x**y');
    expect(doc.firstChild!.lastChild!.text).toBe('后');
  });
  it('undo restores the content and marks before completing the closing delimiter', () => {
    const editor = new Editor({ extensions: buildDocumentExtensions(), content: '<p>所以，**中文。*</p>' });
    try {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      editor.view.dispatch(closeHistory(editor.state.tr));
      const before = editor.getJSON(); input(editor, '*');
      expect(editor.state.doc.textContent).toBe('所以，中文。');
      editor.commands.undo(); expect(editor.getJSON()).toEqual(before);
      editor.commands.redo(); expect(editor.state.doc.firstChild!.lastChild!.marks.map(mark => mark.type.name)).toContain('bold');
    } finally { editor.destroy(); }
  });
  it('retains literal keystrokes when the document format cannot automatically apply a mark', () => {
    const editor = new Editor({ extensions: [...buildDocumentExtensions({ inlineFormattingInput: InlineFormattingInput.configure({ canApply: supportsAutomaticMarks }) }), DocumentCapabilityGuard], content: '<p></p>' });
    try {
      for (const character of '==中文。==') input(editor, character);
      expect(editor.state.doc.textContent).toBe('==中文。==');
      expect(editor.state.doc.firstChild!.firstChild!.marks).toHaveLength(0);
    } finally { editor.destroy(); }
  });
  it('finds a nearby mark at the end of a very long single text node', () => {
    const prefix = '正文'.repeat(20000);
    const editor = new Editor({ extensions: buildDocumentExtensions(), content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: prefix + '**中文。*' }] }] } });
    try {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1); input(editor, '*');
      expect(editor.state.doc.textContent).toBe(prefix + '中文。');
      expect(editor.state.doc.firstChild!.lastChild!.marks.map(mark => mark.type.name)).toContain('bold');
    } finally { editor.destroy(); }
  });
});
