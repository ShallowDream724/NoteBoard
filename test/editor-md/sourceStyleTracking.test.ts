import { Editor } from '@tiptap/core';
import { EditorState } from '@codemirror/state';
import { expect, it, vi } from 'vitest';
import { buildDocumentExtensions, documentParser, parseMarkdownDocument } from '../../src/features/editor-md/documentExtensions';
import { serializeMarkdown } from '../../src/features/editor-md/serialize';
import { applyTextStyle, setParagraphPresentation } from '../../src/features/document-style/documentStyles';
import { sourceStylesField, readStyledSource, resetSourceStyles } from '../../src/features/document-style/sourceStyleTracking';
import { buildStyleSpans, replaceStyleSpans, spanValueAt, styleSpans, type SpanTree } from '../../src/features/document-style/styleSpanTree';
import { nativeTestEditor } from './nativeTestEditor';

function seed() {
  const editor = new Editor({ extensions: buildDocumentExtensions(), content: '<p>before</p><p>red words</p><p>after</p>' });
  nativeTestEditor(editor);
  editor.commands.setTextSelection({ from: 9, to: 18 });
  applyTextStyle(editor, { color: '#dc2626', background: '#fef08a' });
  setParagraphPresentation(editor, { textAlign: 'center' });
  const content = serializeMarkdown(editor); editor.destroy(); return content;
}
it('tracks source insert/delete and block splits while retaining paired styles and body spelling', () => {
  const initial = seed(); let state = EditorState.create({ doc: initial, extensions: [sourceStylesField] });
  const at = initial.indexOf('red words') + 4;
  state = state.update({ changes: { from: at, insert: 'new ' } }).state;
  const content = readStyledSource(state), doc = parseMarkdownDocument(content);
  expect(content.startsWith('before\n\nred new words\n\nafter')).toBe(true);
  expect(doc.child(1).textContent).toBe('red new words');
  expect(doc.child(1).attrs.textAlign).toBe('center');
  expect(doc.child(1).firstChild?.marks.map(mark => mark.attrs.color).sort()).toEqual(['#dc2626','#fef08a']);
  state = state.update({ changes: { from: at, to: at + 4, insert: '\n\n' } }).state;
  const split = parseMarkdownDocument(readStyledSource(state));
  for (const index of [1, 2]) {
    expect(split.child(index).attrs.textAlign).toBe('center');
    expect(split.child(index).firstChild?.marks.map(mark => mark.attrs.color).sort()).toEqual(['#dc2626','#fef08a']);
  }
  // App history restores its materialized source entry and explicitly resets the field.
  state = state.update({ changes: { from: 0, to: state.doc.length, insert: initial }, effects: resetSourceStyles.of(null) }).state;
  expect(readStyledSource(state)).toBe(initial);
});
it('retains inline and display formula colors through source edits inside TeX and surrounding text', () => {
  const editor = new Editor({ extensions: buildDocumentExtensions(), content: { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'red ' }, { type: 'mathInline', attrs: { latex: 'x+1', delimiter: '$' } }, { type: 'text', text: ' words' }] },
    { type: 'mathBlock', attrs: { latex: 'y+1', delimiter: '$$' } },
  ] } });
  try {
    nativeTestEditor(editor);
    editor.commands.selectAll(); applyTextStyle(editor, { color: '#dc2626', background: '#fef08a' });
    const initial = serializeMarkdown(editor);
    let state = EditorState.create({ doc: initial, extensions: [sourceStylesField] });
    for (const [needle, insert] of [['red', ' new'], ['x+', '2'], ['y+', '3']]) {
      const at = state.doc.toString().indexOf(needle) + needle.length;
      state = state.update({ changes: { from: at, insert } }).state;
    }
    const doc = parseMarkdownDocument(readStyledSource(state));
    const inline = doc.child(0).child(1), block = doc.child(1);
    expect(inline.attrs.latex).toBe('x+21');
    expect(inline.marks.map(mark => mark.attrs.color).sort()).toEqual(['#dc2626','#fef08a']);
    expect(block.attrs).toMatchObject({ latex: 'y+31', textColor: '#dc2626', background: '#fef08a' });
    doc.check();
  } finally { editor.destroy(); }
});
it('does not parse or serialize on source keystrokes and materializes each immutable snapshot once', () => {
  const initial = seed(); let state = EditorState.create({ doc: initial, extensions: [sourceStylesField] });
  const manager = documentParser().manager, parse = vi.spyOn(manager, 'parse'), serialize = vi.spyOn(manager, 'serialize');
  try {
    const at = initial.indexOf('red words') + 3;
    for (let index = 0; index < 100; index++) state = state.update({ changes: { from: at, insert: 'x' } }).state;
    expect(parse).not.toHaveBeenCalled(); expect(serialize).not.toHaveBeenCalled();
    const content = readStyledSource(state); expect(content).toContain('x'.repeat(100));
    const calls = [parse.mock.calls.length, serialize.mock.calls.length];
    expect(readStyledSource(state)).toBe(content); expect([parse.mock.calls.length, serialize.mock.calls.length]).toEqual(calls);
  } finally { parse.mockRestore(); serialize.mockRestore(); }
});
it('preserves plain text when the annotation itself is deliberately edited', () => {
  const initial = seed(); let state = EditorState.create({ doc: initial, extensions: [sourceStylesField] });
  const from = initial.indexOf('<!-- noteboard-styles ');
  state = state.update({ changes: { from, to: state.doc.length, insert: '<!-- custom -->' } }).state;
  expect(readStyledSource(state)).toBe(state.doc.toString());
});
it('edits a 100,000-run style rope with logarithmic structural copying', () => {
  const value = { color: '#dc2626' };
  const tree = buildStyleSpans(200000, Array.from({ length: 100000 }, (_, i) => ({ from: i * 2, to: i * 2 + 1, value })))!;
  const old = new Set<SpanTree<typeof value>>();
  function collect(node: SpanTree<typeof value> | null, set: Set<SpanTree<typeof value>>) { if (!node) return; set.add(node); if (node.left) { collect(node.left, set); collect(node.right, set); } }
  collect(tree, old);
  const next = replaceStyleSpans(tree, 100001, 100001, 1)!;
  const fresh = new Set<SpanTree<typeof value>>(); collect(next, fresh);
  expect([...fresh].filter(node => !old.has(node)).length).toBeLessThan(200);
  expect(next.height).toBeLessThan(22); expect(next.length).toBe(200001);
  expect(spanValueAt(next, 100000)).toBe(value); expect(spanValueAt(next, 100001)).toBe(value);
  expect([...styleSpans(next)]).toHaveLength(100000);
  // Original snapshots remain valid for history/materialization.
  expect(tree.length).toBe(200000); expect(spanValueAt(tree, 100001)).toBeNull();
});
