import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { buildDocumentExtensions } from '@/features/editor-md/documentExtensions';
import { MarkdownTypingKeys } from '@/features/editor-md/typingAssist';
import { TextStyleKeys } from '@/features/editor-md/textStyleShortcuts';
import { sourceTypingAssist } from '@/features/editor-md/sourceTypingAssist';
import { buildLongTextExtensions } from '@/features/bitable/BitableRichTextEditor';
import { setShortcutOverrides } from '@/core/shortcutBindings';

const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); setShortcutOverrides({}); });
const press = (dom: HTMLElement, remapped = false) => {
  const event = new KeyboardEvent('keydown', { key: remapped ? 'l' : '\\', code: remapped ? 'KeyL' : 'Backslash', ctrlKey: true, shiftKey: remapped, bubbles: true, cancelable: true });
  dom.dispatchEvent(event); return event;
};
describe('one clear-style shortcut across editing scopes', () => {
  it.each(['document', 'caption', 'bitable'])('clears actual %s editor text and retains links, supporting remapping and undo', kind => {
    const extensions = kind === 'document' ? [...buildDocumentExtensions(), MarkdownTypingKeys]
      : kind === 'bitable' ? buildLongTextExtensions() : [StarterKit, TextStyleKeys];
    const editor = new Editor({ extensions, content: '<p><a href="https://example.com"><b><i>text</i></b></a></p><p>tail</p>' }); editors.push(editor);
    editor.commands.setTextSelection({ from: 1, to: 5 }); const before = editor.state.doc;
    expect(press(editor.view.dom).defaultPrevented).toBe(true);
    expect(editor.state.doc.firstChild!.firstChild!.marks.map(mark => mark.type.name)).toEqual(['link']);
    editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
    setShortcutOverrides({ 'markdown.clearStyles': ['Ctrl+Shift+L'] });
    expect(press(editor.view.dom).defaultPrevented).toBe(true); expect(editor.state.doc.eq(before)).toBe(true);
    expect(press(editor.view.dom, true).defaultPrevented).toBe(true);
    expect(editor.state.doc.firstChild!.firstChild!.marks.map(mark => mark.type.name)).toEqual(['link']);
  });
  it('clears source syntax through the same command while retaining link destinations', () => {
    const view = new EditorView({ state: EditorState.create({ doc: '**text** [link](https://example.com)', selection: { anchor: 0, head: 34 }, extensions: [markdown(), sourceTypingAssist] }) });
    try {
      expect(press(view.contentDOM).defaultPrevented).toBe(true);
      expect(view.state.doc.toString()).toBe('text [link](https://example.com)');
    } finally { view.destroy(); }
  });
  it('ignores composition and already-consumed events', () => {
    const editor = new Editor({ extensions: [StarterKit, TextStyleKeys], content: '<p><b>text</b></p>' }); editors.push(editor);
    editor.commands.setTextSelection({ from: 1, to: 5 }); const before = editor.state.doc;
    const event = new KeyboardEvent('keydown', { key: '\\', code: 'Backslash', ctrlKey: true, bubbles: true, cancelable: true, isComposing: true });
    editor.view.dom.dispatchEvent(event); expect(event.defaultPrevented).toBe(false); expect(editor.state.doc.eq(before)).toBe(true);
  });
});
