import { Editor } from '@tiptap/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { initializeEditorDocument, serializeEditorDocument } from '../../src/features/editor-md/editorDocumentCodec';
import { buildExtensions } from '../../src/features/editor-md/extensions';

const editors: Editor[] = [];

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

afterEach(() => {
  editors.splice(0).forEach(editor => editor.destroy());
  vi.unstubAllGlobals();
});

function openMarkdown(source: string) {
  const editor = new Editor({
    extensions: buildExtensions('source-fidelity'),
    content: '',
    onBeforeCreate: ({ editor }) => initializeEditorDocument(editor, source, 'markdown'),
  });
  editors.push(editor);
  return editor;
}

function selectText(editor: Editor, search: string) {
  let from = -1;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text?.includes(search)) return;
    from = pos + node.text.indexOf(search);
  });
  expect(from, `locate "${search}" in the visual editor`).toBeGreaterThanOrEqual(0);
  editor.commands.setTextSelection({ from, to: from + search.length });
}

function pressEnter(editor: Editor) {
  editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

const source = [
  '<release_notes>', '', '## Overview', '', '- Check the status.', '', '</release_notes>', '',
  '<review_log>', '- Review this change.', '</review_log>', '', '', '',
  '| Item | Description |', '| --- | --- |', '| **Draft** | Keep this text. |', '',
  'Inspect the files in', 'one call using `files=[{"path": ...}, ...]`.', '',
  'The last paragraph.',
].join('\n');

it('retains the emphasis spelling on either side of a paragraph split', () => {
  const original = '__First__, then split here, with _more_ later.';
  const editor = openMarkdown(original);
  selectText(editor, 'here');
  editor.commands.setTextSelection(editor.state.selection.to);
  editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  expect(serializeEditorDocument(editor)).toBe(original.replace('here,', 'here\n\n,'));
});

it('opens the pipe table, emphasis, and bracketed inline code as editable Markdown', () => {
  const editor = openMarkdown(source);
  selectText(editor, 'Draft');
  expect(editor.isActive('table')).toBe(true);
  expect(editor.isActive('bold')).toBe(true);
  selectText(editor, 'files=[{"path": ...}, ...]');
  expect(editor.isActive('code')).toBe(true);
});

it.each([
  ['status', 'result'],
  ['Draft', 'Released'],
  ['one call', 'a single call'],
  ['"path"', '"name"'],
])('changes only the selected Markdown text "%s" when editing visually', (before, after) => {
  const editor = openMarkdown(source);
  expect(serializeEditorDocument(editor)).toBe(source);
  selectText(editor, before);
  editor.view.dispatch(editor.state.tr.insertText(after));
  expect(serializeEditorDocument(editor)).toBe(source.replace(before, after));
});

it.each(['files=[{"path": ...}, ...]', 'The last paragraph.'])('preserves source around a paragraph added after "%s" with Enter', anchor => {
  const editor = openMarkdown(source);
  selectText(editor, anchor);
  editor.commands.setTextSelection(editor.state.selection.$to.end());
  pressEnter(editor);
  expect(editor.state.selection.$from.parent.textContent).toBe('');
  editor.view.dispatch(editor.state.tr.insertText('The next paragraph.'));
  const lineEnd = source.indexOf('\n', source.indexOf(anchor));
  const insertAt = lineEnd === -1 ? source.length : lineEnd;
  expect(serializeEditorDocument(editor)).toBe(source.slice(0, insertAt) + '\n\nThe next paragraph.' + source.slice(insertAt));
});

it('continues typing in a file with a trailing blank paragraph after saving a text edit', () => {
  const original = source + '\n\n';
  const editor = openMarkdown(original);
  selectText(editor, 'Overview');
  editor.view.dispatch(editor.state.tr.insertText('Summary'));
  const edited = original.replace('Overview', 'Summary');
  expect(serializeEditorDocument(editor)).toBe(edited);
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  pressEnter(editor);
  editor.view.dispatch(editor.state.tr.insertText('Continued.'));
  expect(serializeEditorDocument(editor)).toBe(edited + '\n\nContinued.');
});
