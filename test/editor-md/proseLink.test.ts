import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { buildLongTextExtensions } from '../../src/features/bitable/BitableRichTextEditor';

const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); });
function editorFor(extensions: ReturnType<typeof buildDocumentExtensions>) {
  const editor = new Editor({ extensions, content: '<p><a href="https://example.com">link</a></p>' });
  editors.push(editor); return editor;
}
function type(editor: Editor, text: string, from: number, to = from) {
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));
  editor.view.dispatch(editor.state.tr.insertText(text));
}
function markedText(editor: Editor) {
  const values: string[] = [];
  editor.state.doc.descendants(node => { if (node.isText && node.marks.some(mark => mark.type.name === 'link')) values.push(node.text!); });
  return values.join('');
}

describe.each([['document and annotation schema', buildDocumentExtensions], ['table long text', buildLongTextExtensions]] as const)('%s link boundaries', (_name, extensions) => {
  it('types plain text at either boundary and keeps links while editing inside', () => {
    const editor = editorFor(extensions());
    type(editor, '后续', 5);
    expect(markedText(editor)).toBe('link');
    type(editor, '前', 1);
    expect(markedText(editor)).toBe('link');
    type(editor, '内', 4);
    expect(markedText(editor)).toBe('li内nk');
  });
  it('preserves a replacement inside the link and exits at its resulting end', () => {
    const editor = editorFor(extensions());
    type(editor, '中文', 2, 4);
    expect(markedText(editor)).toBe('l中文k');
    type(editor, '正文', 5);
    expect(markedText(editor)).toBe('l中文k');
  });
  it('honors an explicit stored link mark at the end', () => {
    const editor = editorFor(extensions());
    editor.commands.setTextSelection(5);
    editor.commands.setLink({ href: 'https://example.com/explicit' });
    editor.view.dispatch(editor.state.tr.insertText('明确链接'));
    expect(markedText(editor)).toBe('link明确链接');
  });
  it.each([[1, 5], [2, 5]])('preserves replacing linked text through its end (%i,%i)', (from, to) => {
    const editor = editorFor(extensions());
    type(editor, '新文字', from, to);
    expect(markedText(editor)).toBe(from === 1 ? '新文字' : 'l新文字');
    editor.view.dispatch(editor.state.tr.insertText('正文'));
    expect(markedText(editor)).toBe(from === 1 ? '新文字' : 'l新文字');
  });
  it('does not pull a mixed link/plain-text replacement into the link or override explicit unlink', () => {
    const editor = editorFor(extensions());
    type(editor, '正文', 5);
    type(editor, '替换', 3, 7);
    expect(markedText(editor)).toBe('li');
    editor.commands.setContent('<p><a href="https://example.com">link</a></p>');
    editor.commands.setTextSelection({ from: 1, to: 5 });
    editor.commands.unsetLink();
    editor.view.dispatch(editor.state.tr.insertText('无链接'));
    expect(markedText(editor)).toBe('');
  });
  it('keeps pasted links and automatic URL detection', () => {
    const editor = editorFor(extensions());
    editor.commands.setContent('<p></p>');
    editor.commands.insertContent('<a href="https://example.com/paste">粘贴</a>');
    editor.view.dispatch(editor.state.tr.insertText(' 后续'));
    expect(markedText(editor)).toBe('粘贴');
    editor.commands.setContent('<p></p>');
    type(editor, 'https://example.com ', 1);
    expect(markedText(editor)).toBe('https://example.com');
    type(editor, '正文', 21);
    expect(markedText(editor)).toBe('https://example.com');
  });
});
