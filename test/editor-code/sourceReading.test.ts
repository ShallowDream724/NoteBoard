import { javascript } from '@codemirror/lang-javascript';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import { sourceReadingExtension, sourceReadingPlugin } from '../../src/features/editor-code/sourceReading';

describe('long source line reading', () => {
  it('adds visual code boundaries without changing source, selection, or another view', async () => {
    const literal = 'const literal = "a;},[b";';
    const doc = `(()=>{const pattern=/[;{}]/;${literal}${'function render(){return literal;}'.repeat(18)}})();`;
    const contentChanged = vi.fn();
    const primary = new EditorView({ state: EditorState.create({
      doc,
      selection: { anchor: 3, head: 7 },
      extensions: [sourceReadingExtension, javascript(), EditorView.lineWrapping, EditorView.updateListener.of(update => {
        if (update.docChanged) contentChanged();
      })],
    }) });
    const secondary = new EditorView({ state: EditorState.create({
      doc: 'const x = 1;\n'.repeat(120),
      extensions: [sourceReadingExtension],
    }) });
    try {
      const reading = primary.plugin(sourceReadingPlugin)!;
      await vi.waitFor(() => expect(reading.getSnapshot()).toBe('available'));
      expect(secondary.plugin(sourceReadingPlugin)?.getSnapshot()).toBe('hidden');
      const source = primary.state.doc;
      const selection = primary.state.selection;
      reading.toggle('javascript');

      const breakPoints = Array.from(primary.contentDOM.querySelectorAll('.nb-source-reading-indent'), indent => primary.posAtDOM(indent));
      expect(breakPoints.length).toBeGreaterThan(10);
      expect(breakPoints.some(position => position > doc.indexOf(literal) && position < doc.indexOf(literal) + literal.length)).toBe(false);
      expect(primary.state.doc).toBe(source);
      expect(primary.state.selection).toBe(selection);
      expect(contentChanged).not.toHaveBeenCalled();
      expect(secondary.contentDOM.classList.contains('nb-source-reading')).toBe(false);

      reading.toggle('javascript');
      expect(primary.contentDOM.querySelector('.nb-source-reading-indent')).toBeNull();
      expect(primary.state.doc).toBe(source);
      expect(primary.contentDOM.classList.contains('cm-lineWrapping')).toBe(true);

      reading.toggle('javascript');
      primary.dispatch({ changes: { from: 0, insert: '/* real edit */' } });
      expect(reading.getSnapshot()).toBe('available');
      expect(primary.contentDOM.querySelector('.nb-source-reading-indent')).toBeNull();
      expect(contentChanged).toHaveBeenCalledTimes(1);
    } finally {
      primary.destroy();
      secondary.destroy();
    }
  });

  it('finds a newly long line outside the initial viewport and wraps only the opted-in file', async () => {
    const doc = 'let small = 0;\n'.repeat(5000);
    const createView = () => new EditorView({ state: EditorState.create({ doc, extensions: sourceReadingExtension }) });
    const view = createView();
    const other = createView();
    try {
      const reading = view.plugin(sourceReadingPlugin)!;
      expect(reading.getSnapshot()).toBe('hidden');
      const long = 'x'.repeat(500);
      view.dispatch({ changes: { from: doc.length, insert: long } });
      await vi.waitFor(() => expect(reading.getSnapshot()).toBe('available'));
      reading.toggle('plaintext');
      expect(view.state.doc.toString()).toBe(doc + long);
      expect(view.contentDOM.classList.contains('nb-source-reading-wrap')).toBe(true);
      expect(other.contentDOM.classList.contains('cm-lineWrapping')).toBe(false);

      reading.toggle('plaintext');
      expect(view.contentDOM.classList.contains('cm-lineWrapping')).toBe(false);
      view.dispatch({ changes: { from: doc.length, to: doc.length + long.length } });
      expect(reading.getSnapshot()).toBe('hidden');
    } finally {
      view.destroy();
      other.destroy();
    }
  });
});
