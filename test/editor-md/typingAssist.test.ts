import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { buildDocumentExtensions, parseMarkdownDocument } from '../../src/features/editor-md/documentExtensions';
import { MarkdownTypingKeys } from '../../src/features/editor-md/typingAssist';
import { completeAlert } from '../../src/features/editor-md/alertCommands';
import { formatSourceMark, setSourceHeading } from '../../src/features/editor-md/sourceFormatting';
import { initShortcuts } from '../../src/core/shortcuts';
import { sourceTypingAssist } from '../../src/features/editor-md/sourceTypingAssist';

describe('Markdown interactive conveniences', () => {
  it('physical Ctrl digits work in both editors even when the input language changes event.key', () => {
    const editor = new Editor({ extensions: [...buildDocumentExtensions(), MarkdownTypingKeys], content: '<p>heading</p>' });
    const source = new EditorView({ state: EditorState.create({ doc: 'heading', extensions: [sourceTypingAssist] }) });
    const dispose = initShortcuts();
    try {
      for (const level of [1, 2, 3, 4, 5, 6, 0]) {
        for (const dom of [editor.view.dom, source.contentDOM]) {
          const event = new KeyboardEvent('keydown', { key: level === 0 ? '0' : 'Process', code: `Digit${level}`, ctrlKey: true, bubbles: true, cancelable: true });
          dom.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
        }
        expect(editor.state.doc.firstChild?.type.name).toBe(level ? 'heading' : 'paragraph');
        if (level) expect(editor.state.doc.firstChild?.attrs.level).toBe(level);
        expect(source.state.doc.toString()).toBe(level ? `${'#'.repeat(level)} heading` : 'heading');
      }
      const composing = new KeyboardEvent('keydown', { key: 'Process', code: 'Digit1', ctrlKey: true, isComposing: true, bubbles: true, cancelable: true });
      editor.view.dom.dispatchEvent(composing); expect(editor.state.doc.firstChild?.type.name).toBe('paragraph');
    } finally { dispose(); editor.destroy(); source.destroy(); }
  });
  it('browser shortcut fallback runs after the focused editor', () => {
    const host = document.createElement('div'); document.body.append(host);
    const editor = new Editor({ element: host, extensions: buildDocumentExtensions(), content: '<p>hello</p>' });
    const dispose = initShortcuts();
    try {
      editor.commands.setTextSelection({ from: 1, to: 6 });
      const event = new KeyboardEvent('keydown', { key: 'u', code: 'KeyU', ctrlKey: true, bubbles: true, cancelable: true });
      editor.view.dom.dispatchEvent(event);
      expect(editor.isActive('underline')).toBe(true);
      expect(event.defaultPrevented).toBe(true);
      const fallback = new KeyboardEvent('keydown', { key: 'u', ctrlKey: true, bubbles: true, cancelable: true });
      document.body.dispatchEvent(fallback); expect(fallback.defaultPrevented).toBe(true);
    } finally { dispose(); editor.destroy(); host.remove(); }
  });
  for (const [text, expected] of [['···', 'codeBlock'], ['text···', 'paragraph'], ['...', 'paragraph'], ['···text···', 'paragraph']]) {
    it(`only independent middle-dot fence converts: ${text}`, () => {
      const editor = new Editor({ extensions: [...buildDocumentExtensions(), MarkdownTypingKeys], content: `<p>${text}</p>` });
      try {
        expect(editor.state.doc.firstChild?.type.name).toBe('paragraph'); // Loading is never a conversion.
        editor.commands.setTextSelection(text.length + 1);
        editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
        expect(editor.state.doc.firstChild?.type.name).toBe(expected);
        if (text === '···') {
          editor.commands.undo();
          expect(editor.state.doc.firstChild?.type.name).toBe('paragraph');
          expect(editor.state.doc.textContent).toBe('···');
        }
      } finally { editor.destroy(); }
    });
  }
  it('callout completion preserves sibling content and enters its empty body', () => {
    const editor = new Editor({ extensions: buildDocumentExtensions(), content: '<p>before</p><blockquote><p>[!]</p></blockquote><p>after</p>' });
    try {
      editor.commands.setTextSelection(13);
      expect(completeAlert(editor, 'warning')).toBe(true);
      expect(editor.state.doc.child(0).textContent).toBe('before');
      expect(editor.state.doc.child(1).attrs.kind).toBe('warning');
      expect(editor.state.doc.child(2).textContent).toBe('after');
      expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
      expect(editor.state.selection.$from.node(-1).type.name).toBe('githubAlert');
    } finally { editor.destroy(); }
  });
  it('source underline toggles and colored marks replace their wrapper without nesting', () => {
    const view = new EditorView({ state: EditorState.create({ doc: 'text', selection: { anchor: 0, head: 4 } }) });
    try {
      formatSourceMark(view, 'underline'); expect(view.state.doc.toString()).toBe('<u>text</u>');
      formatSourceMark(view, 'underline'); expect(view.state.doc.toString()).toBe('text');
      formatSourceMark(view, 'highlight', '#fef08a'); formatSourceMark(view, 'highlight', '#bfdbfe');
      expect(view.state.doc.toString()).toContain('text\n\n<!-- noteboard-styles ');
      expect(parseMarkdownDocument(view.state.doc.toString()).firstChild?.firstChild?.marks[0]?.attrs.color).toBe('#bfdbfe');
      formatSourceMark(view, 'highlight', undefined, true); expect(view.state.doc.toString()).toBe('text');
      setSourceHeading(view, 2); expect(view.state.doc.toString()).toBe('## text');
      setSourceHeading(view, 0); expect(view.state.doc.toString()).toBe('text');
    } finally { view.destroy(); }
  });
});
