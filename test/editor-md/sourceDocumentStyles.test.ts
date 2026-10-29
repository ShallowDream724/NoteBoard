import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo } from '@codemirror/commands';
import { applySourceTextStyle, sourceTextStyle } from '../../src/features/document-style/sourceDocumentStyle';
import { parseMarkdownDocument } from '../../src/features/editor-md/documentExtensions';
import { clearSourceTextFormatting, formatSourceMark } from '../../src/features/editor-md/sourceFormatting';

describe('source document styles', () => {
  for (const eol of ['', '\n', '\r\n', '\r\n\r\n']) it(`authors readable source styles with an independent undo (${JSON.stringify(eol)})`, () => {
    const source = 'A **bold** and plain.' + eol;
    const view = new EditorView({ state: EditorState.create({ doc: source, selection: { anchor: 15, head: 20 }, extensions: [history()] }) });
    try {
      // CodeMirror represents line endings internally as LF. Retain that exact body.
      const original = view.state.doc.toString();
      expect(applySourceTextStyle(view, { color: '#dc2626', background: '#fef08a' })).toBe(true);
      const styled = view.state.doc.toString();
      expect(styled).toContain('\\color[#dc2626]{'); expect(styled).toContain('\\bg[#fef08a]{');
      expect(styled).not.toContain('noteboard-styles');
      expect(parseMarkdownDocument(styled).textContent).toBe(parseMarkdownDocument(original).textContent);
      expect(sourceTextStyle(view)).toEqual({ color: '#dc2626', background: '#fef08a' });
      expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe(original);
    } finally { view.destroy(); }
  });
  it('reads legacy HTML payloads and removes only the requested semantic styles', () => {
    const styled = '<span data-text-color="#dc2626"><mark data-color="#fef08a"><u>plain</u></mark></span>';
    const from = styled.indexOf('plain');
    const view = new EditorView({ state: EditorState.create({ doc: styled, selection: { anchor: from, head: from + 5 } }) });
    try {
      expect(sourceTextStyle(view, true)).toEqual({ color: '#dc2626', background: '#fef08a' });
      expect(parseMarkdownDocument(styled.replaceAll('\n', '\r\n')).toJSON()).toEqual(parseMarkdownDocument(styled).toJSON());
      expect(applySourceTextStyle(view, { color: null, background: null })).toBe(true);
      expect(parseMarkdownDocument(view.state.doc.toString()).firstChild!.firstChild!.marks.map(mark => mark.type.name)).toEqual(['underline']);
      expect(formatSourceMark(view, 'underline')).toBe(true);
      expect(view.state.doc.toString()).toBe('plain');
    } finally { view.destroy(); }
  });
  it('formats repeated labels by spans while leaving code, formulas, URLs and parameters alone', () => {
    const source = 'same [same](https://example.com/same) `same` $same$ \\color[#123456]{same}';
    const at = source.lastIndexOf('same'), view = new EditorView({ state: EditorState.create({ doc: source, selection: { anchor: at, head: at + 4 } }) });
    try {
      expect(applySourceTextStyle(view, { color: '#dc2626' })).toBe(true);
      expect(view.state.doc.toString()).toBe(source.slice(0, source.lastIndexOf('\\color')) + '\\color[#dc2626]{same}');
      for (const token of ['https://example.com/same', '`same`', '$same$', '#dc2626']) {
        const current = view.state.doc.toString(), from = current.indexOf(token) + 1;
        view.dispatch({ selection: { anchor: from, head: from + 2 } });
        expect(applySourceTextStyle(view, { background: '#fef08a' })).toBe(false);
        expect(view.state.doc.toString()).toBe(current);
      }
    } finally { view.destroy(); }
  });
  it('clears visual DSL styles while keeping annotation and concealment semantics', () => {
    const source = '\\note{\\blur{\\color[#dc2626]{\\u{answer}}}}{explanation}';
    const at = source.indexOf('answer'), view = new EditorView({ state: EditorState.create({ doc: source, selection: { anchor: at, head: at + 6 } }) });
    try {
      expect(clearSourceTextFormatting(view)).toBe(true);
      const doc = parseMarkdownDocument(view.state.doc.toString());
      const marks: string[] = []; doc.descendants(node => { if (node.isText && node.text === 'answer') marks.push(...node.marks.map(mark => mark.type.name)); });
      expect(marks.sort()).toEqual(['annotationReference', 'conceal']);
      expect(doc.textContent).toContain('explanation');
    } finally { view.destroy(); }
  });
  it('does not parse on toolbar reads after a source edit', () => {
    const view = new EditorView({ state: EditorState.create({ doc: 'plain', selection: { anchor: 0, head: 5 } }) });
    try {
      expect(sourceTextStyle(view)).toBeNull(); expect(sourceTextStyle(view, true)).toEqual({ color: null, background: null });
      view.dispatch({ changes: { from: 5, insert: ' text' } });
      expect(sourceTextStyle(view)).toBeNull();
    } finally { view.destroy(); }
  });
  it('keeps declarative block title parameters unchanged when clearing formatting', () => {
    const source = '::: fold "**title**"\nbody\n:::', at = source.indexOf('**title**');
    const view = new EditorView({ state: EditorState.create({ doc: source, selection: { anchor: at, head: at + 9 } }) });
    try {
      expect(clearSourceTextFormatting(view)).toBe(false);
      expect(applySourceTextStyle(view, { color: '#dc2626' })).toBe(false);
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });
});
