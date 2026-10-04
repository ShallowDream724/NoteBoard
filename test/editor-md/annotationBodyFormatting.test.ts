import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { EditorView } from '@tiptap/pm/view';
import { toggleMark } from '@tiptap/pm/commands';
import { undo, redo, undoDepth } from '@tiptap/pm/history';
import { buildDocumentExtensions } from '@/features/editor-md/documentExtensions';
import { createAnnotationBodyView } from '@/features/editor-md/annotations/bodyView';
import { canStyleDraftMark, clearDraftTextFormatting, draftMarkStatus, runDraftCommand, setDraftColor, setDraftLink, validDraftLink } from '@/features/editor-md/annotations/bodyFormatting';

let editor: Editor, view: EditorView;
beforeEach(() => {
  vi.spyOn(EditorView.prototype, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });
  editor = new Editor({ extensions: buildDocumentExtensions(), content: '<p>Parent text</p>' });
  const host = document.createElement('div'); document.body.append(host);
  const body = editor.schema.nodes.annotationBody.create({ id: 'draft' }, editor.schema.nodes.paragraph.create(null, editor.schema.text('Draft text')));
  view = createAnnotationBodyView(host, editor, body, true);
});
afterEach(() => { view.destroy(); editor.destroy(); document.body.replaceChildren(); vi.restoreAllMocks(); });
const select = (from: number, to = from) => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));

it('styles only the draft selection and makes each visual action independently undoable', () => {
  const parent = editor.state.doc, initial = view.state.doc;
  select(1, 6);
  expect(runDraftCommand(view, toggleMark(view.state.schema.marks.underline))).toBe(true);
  expect(draftMarkStatus(view.state, 'underline')).toBe(true);
  expect(setDraftColor(view, 'textColor', '#2563eb')).toBe(true);
  expect(setDraftColor(view, 'highlight', '#fef08a')).toBe(true);
  expect(view.state.selection.from).toBe(1); expect(view.state.selection.to).toBe(6);
  expect(undoDepth(view.state)).toBe(3); expect(editor.state.doc).toBe(parent);
  undo(view.state, view.dispatch); expect(draftMarkStatus(view.state, 'highlight')).toBe(false);
  undo(view.state, view.dispatch); expect(draftMarkStatus(view.state, 'textColor')).toBe(false);
  undo(view.state, view.dispatch); expect(view.state.doc.eq(initial)).toBe(true);
  redo(view.state, view.dispatch); expect(draftMarkStatus(view.state, 'underline')).toBe(true);
});

it('reports mixed formatting and follows the shared schema for inline and block code', () => {
  select(1, 6); runDraftCommand(view, toggleMark(view.state.schema.marks.bold));
  select(1, 11); expect(draftMarkStatus(view.state, 'bold')).toBe('mixed');
  runDraftCommand(view, toggleMark(view.state.schema.marks.code));
  expect(draftMarkStatus(view.state, 'code')).toBe(true);
  // This application's inline code deliberately allows presentation marks.
  select(3); expect(canStyleDraftMark(view.state, 'bold')).toBe(true);
  expect(setDraftColor(view, 'textColor', '#2563eb')).toBe(true);
  view.dispatch(view.state.tr.replaceWith(0, view.state.doc.firstChild!.nodeSize,
    view.state.schema.nodes.codeBlock.create(null, view.state.schema.text('Code text'))));
  select(3);
  expect(canStyleDraftMark(view.state, 'bold')).toBe(false);
  expect(setDraftColor(view, 'textColor', '#2563eb')).toBe(false);
});

it('clears text presentation while preserving the selected link and unrelated text', () => {
  select(1, 6); setDraftLink(view, 'https://example.com');
  runDraftCommand(view, toggleMark(view.state.schema.marks.bold)); setDraftColor(view, 'highlight', '#fef08a');
  expect(runDraftCommand(view, clearDraftTextFormatting)).toBe(true);
  expect(draftMarkStatus(view.state, 'bold')).toBe(false); expect(draftMarkStatus(view.state, 'highlight')).toBe(false);
  expect(draftMarkStatus(view.state, 'link')).toBe(true); expect(view.state.doc.textContent).toBe('Draft text');
  expect(clearDraftTextFormatting(view.state)).toBe(false);
});

it('clears the current paragraph at a caret and removes future typing marks', () => {
  select(1, 6); runDraftCommand(view, toggleMark(view.state.schema.marks.italic));
  select(3); expect(clearDraftTextFormatting(view.state)).toBe(true);
  runDraftCommand(view, clearDraftTextFormatting);
  expect(view.state.doc.rangeHasMark(1, 11, view.state.schema.marks.italic)).toBe(false);
  expect(draftMarkStatus(view.state, 'italic')).toBe(false);
});

it('edits and removes the whole existing link under the caret even across styled fragments', () => {
  select(1, 11); expect(setDraftLink(view, './other.nb')).toBe(true);
  select(4, 7); runDraftCommand(view, toggleMark(view.state.schema.marks.bold));
  select(6); expect(setDraftLink(view, 'https://example.org')).toBe(true);
  view.state.doc.firstChild!.forEach(node => expect(node.marks.find(mark => mark.type.name === 'link')?.attrs.href).toBe('https://example.org'));
  expect(setDraftLink(view, null)).toBe(true);
  expect(view.state.doc.rangeHasMark(1, 11, view.state.schema.marks.link)).toBe(false);
  expect(setDraftLink(view, 'https://example.com')).toBe(false);
});

it('rejects malformed colors and executable links before mutating draft history', () => {
  select(1, 6); const initial = view.state.doc;
  expect(setDraftColor(view, 'highlight', 'red;display:none')).toBe(false);
  expect(setDraftLink(view, 'javascript:alert(1)')).toBe(false);
  expect(validDraftLink('java\nscript:alert(1)')).toBe(false);
  expect(validDraftLink('https://example.com')).toBe(true); expect(validDraftLink('./相对路径.nb')).toBe(true);
  expect(view.state.doc).toBe(initial); expect(undoDepth(view.state)).toBe(0);
});
