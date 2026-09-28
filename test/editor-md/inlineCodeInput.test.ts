import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { codeSpanInInput } from '../../src/features/editor-md/inlineCodeInput';

function type(editor: Editor, text: string): boolean {
  const { from, to } = editor.state.selection;
  const handled = editor.view.someProp('handleTextInput', handler => handler(editor.view, from, to, text, () => editor.state.tr.insertText(text)));
  if (!handled) editor.view.dispatch(editor.state.tr.insertText(text, from, to));
  return !!handled;
}

describe('inline code typing', () => {
  it('formats when a closing backtick is typed and leaves subsequent prose outside the mark', () => {
    const editor = new Editor({ extensions: buildDocumentExtensions(), content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Before ' }] }] } });
    try {
      editor.commands.setTextSelection(8);
      for (const char of '`code') expect(type(editor, char)).toBe(false);
      expect(editor.state.doc.firstChild?.textContent).toBe('Before `code');
      expect(type(editor, '`')).toBe(true);
      expect(editor.state.doc.firstChild?.textContent).toBe('Before code');
      expect(editor.state.doc.firstChild?.child(1).marks.some(mark => mark.type.name === 'code')).toBe(true);
      type(editor, ' after');
      expect(editor.state.doc.firstChild?.lastChild?.text).toBe(' after');
      expect(editor.state.doc.firstChild?.lastChild?.marks.some(mark => mark.type.name === 'code')).toBe(false);
    } finally { editor.destroy(); }
  });

  it('accepts uninterrupted input in an existing empty pair and preserves the caret inside code', () => {
    const editor = new Editor({ extensions: buildDocumentExtensions(), content: '<p>Before `` after</p>' });
    try {
      editor.commands.setTextSelection(9);
      expect(type(editor, 'a')).toBe(true);
      expect(editor.state.doc.firstChild?.textContent).toBe('Before a after');
      expect(editor.state.selection.from).toBe(9);
      editor.commands.undo();
      expect(editor.state.doc.firstChild?.textContent).toBe('Before `` after');
      editor.commands.redo();
      type(editor, 'b'); type(editor, 'c');
      expect(editor.state.doc.firstChild?.textContent).toBe('Before abc after');
      expect(editor.state.doc.firstChild?.child(1).text).toBe('abc');
      expect(editor.state.doc.firstChild?.child(1).marks.some(mark => mark.type.name === 'code')).toBe(true);
    } finally { editor.destroy(); }
  });

  it('keeps surrounding marks and text when completing a pair in mid-line', () => {
    const editor = new Editor({ extensions: buildDocumentExtensions(), content: '<p>left `ab` right</p>' });
    try {
      editor.commands.setTextSelection({ from: 7, to: 9 });
      editor.commands.setBold();
      editor.commands.setTextSelection(8);
      expect(type(editor, 'x')).toBe(true);
      expect(editor.state.doc.firstChild?.textContent).toBe('left axb right');
      const payload = [...(editor.state.doc.firstChild?.content.content ?? [])].filter(node => node.text?.includes('axb'));
      expect(payload).toHaveLength(1);
      expect(payload[0].marks.map(mark => mark.type.name)).toEqual(expect.arrayContaining(['bold', 'code']));
    } finally { editor.destroy(); }
  });

  it('converts a code span inside a multi-character input without losing its suffix', () => {
    const editor = new Editor({ extensions: buildDocumentExtensions(), content: '<p>before </p>' });
    try {
      editor.commands.setTextSelection(editor.state.doc.firstChild!.nodeSize - 1);
      expect(type(editor, ' `code` after')).toBe(true);
      expect(editor.state.doc.firstChild?.textContent).toBe('before code after');
      const code = [...(editor.state.doc.firstChild?.content.content ?? [])].find(node => node.text === 'code');
      expect(code?.marks.map(mark => mark.type.name)).toContain('code');
      expect(editor.state.selection.from).toBe(editor.state.doc.firstChild!.nodeSize - 1);
    } finally { editor.destroy(); }
  });

  it('waits for an IME composition to commit before converting a paired span', async () => {
    const editor = new Editor({ extensions: buildDocumentExtensions(), content: '<p>``</p>' });
    try {
      editor.commands.setTextSelection(2);
      editor.view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      editor.view.dispatch(editor.state.tr.insertText('中文'));
      expect(editor.state.doc.firstChild?.textContent).toBe('`中文`');
      editor.view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 30));
      expect(editor.state.doc.firstChild?.textContent).toBe('中文');
      expect(editor.state.doc.firstChild?.firstChild?.marks.map(mark => mark.type.name)).toContain('code');
    } finally { editor.destroy(); }
  });

  it('does not consume escaped delimiters or longer backtick runs', () => {
    expect(codeSpanInInput('\\`a`', 3)).toBeNull();
    expect(codeSpanInInput('``a``', 2)).toBeNull();
    expect(codeSpanInInput('`a`', 2)).toEqual({ start: 0, end: 3, content: 'a' });
    const editor = new Editor({ extensions: buildDocumentExtensions(), content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\\`abc' }] }] } });
    try {
      editor.commands.setTextSelection(editor.state.doc.firstChild!.nodeSize - 1);
      expect(type(editor, '`')).toBe(false);
      expect(editor.state.doc.firstChild?.textContent).toBe('\\`abc`');
      expect(editor.state.doc.firstChild?.firstChild?.marks.some(mark => mark.type.name === 'code')).toBe(false);
    } finally { editor.destroy(); }
  });
});
