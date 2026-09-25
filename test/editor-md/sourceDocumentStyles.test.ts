import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo } from '@codemirror/commands';
import { applySourceTextStyle, sourceTextStyle } from '../../src/features/document-style/sourceDocumentStyle';
import { documentParser, parseMarkdownDocument } from '../../src/features/editor-md/documentExtensions';

describe('source document styles', () => {
  for (const eol of ['', '\n', '\r\n', '\r\n\r\n']) it(`does not author private source styles (${JSON.stringify(eol)})`, () => {
    const source = 'A **bold** and plain.' + eol;
    const view = new EditorView({ state: EditorState.create({ doc: source, selection: { anchor: 15, head: 20 }, extensions: [history()] }) });
    try {
      // CodeMirror represents line endings internally as LF. Retain that exact body.
      const original = view.state.doc.toString();
      expect(applySourceTextStyle(view, { color: '#dc2626', background: '#fef08a' })).toBe(false);
      expect(view.state.doc.toString()).toBe(original);
      expect(view.state.selection.main.from).toBe(15); expect(view.state.selection.main.to).toBe(20);
      expect(sourceTextStyle(view, true)).toEqual({ color: null, background: null });
      expect(undo(view)).toBe(false);
    } finally { view.destroy(); }
  });
  it('continues to read existing style annotations without changing them', () => {
    const styled = documentParser().manager.serialize({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'plain', marks: [{ type: 'textColor', attrs: { color: '#dc2626' } }, { type: 'highlight', attrs: { color: '#fef08a' } }] }] }] });
    const view = new EditorView({ state: EditorState.create({ doc: styled, selection: { anchor: 0, head: 5 } }) });
    try {
      applySourceTextStyle(view, { color: '#dc2626' });
      applySourceTextStyle(view, { background: '#fef08a' });
      expect(styled.match(/<!-- noteboard-styles /g)).toHaveLength(1);
      expect(sourceTextStyle(view, true)).toEqual({ color: '#dc2626', background: '#fef08a' });
      expect(parseMarkdownDocument(styled.replaceAll('\n', '\r\n')).toJSON()).toEqual(parseMarkdownDocument(styled).toJSON());
      applySourceTextStyle(view, { color: null, background: null });
      expect(view.state.doc.toString()).toBe(styled);
    } finally { view.destroy(); }
  });
});
