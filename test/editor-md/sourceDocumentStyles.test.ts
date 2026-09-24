import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo } from '@codemirror/commands';
import { applySourceTextStyle, sourceTextStyle } from '../../src/features/document-style/sourceDocumentStyle';
import { documentParser, parseMarkdownDocument } from '../../src/features/editor-md/documentExtensions';
import { presentationBody } from '../../src/features/document-style/presentationMetadata';

describe('source document styles', () => {
  for (const eol of ['', '\n', '\r\n', '\r\n\r\n']) it(`preserves source spelling and applies both colors in one undo (${JSON.stringify(eol)})`, () => {
    const source = 'A **bold** and plain.' + eol;
    const view = new EditorView({ state: EditorState.create({ doc: source, selection: { anchor: 15, head: 20 }, extensions: [history()] }) });
    try {
      // CodeMirror represents line endings internally as LF. Retain that exact body.
      const original = view.state.doc.toString();
      expect(applySourceTextStyle(view, { color: '#dc2626', background: '#fef08a' })).toBe(true);
      const styled = view.state.doc.toString();
      expect(presentationBody(styled, documentParser().manager.instance)).toBe(original);
      expect(view.state.selection.main.from).toBe(15); expect(view.state.selection.main.to).toBe(20);
      const colors: string[] = [];
      parseMarkdownDocument(styled).descendants(node => { if (node.text === 'plain') colors.push(...node.marks.map(mark => mark.attrs.color)); });
      expect(colors.sort()).toEqual(['#dc2626', '#fef08a']);
      expect(sourceTextStyle(view, true)).toEqual({ color: '#dc2626', background: '#fef08a' });
      expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe(original);
    } finally { view.destroy(); }
  });
  it('replaces an existing footer, clears styles, and reads CRLF annotations', () => {
    const view = new EditorView({ state: EditorState.create({ doc: 'plain', selection: { anchor: 0, head: 5 } }) });
    try {
      applySourceTextStyle(view, { color: '#dc2626' });
      applySourceTextStyle(view, { background: '#fef08a' });
      const styled = view.state.doc.toString();
      expect(styled.match(/<!-- noteboard-styles /g)).toHaveLength(1);
      expect(parseMarkdownDocument(styled.replaceAll('\n', '\r\n')).toJSON()).toEqual(parseMarkdownDocument(styled).toJSON());
      applySourceTextStyle(view, { color: null, background: null });
      expect(view.state.doc.toString()).toBe('plain');
    } finally { view.destroy(); }
  });
});
