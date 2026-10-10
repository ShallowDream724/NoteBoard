import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { MarkdownTypingKeys } from '../../src/features/editor-md/typingAssist';
import { completeAlert } from '../../src/features/editor-md/alertCommands';
import { formatSourceMark, setSourceHeading } from '../../src/features/editor-md/sourceFormatting';
import { initShortcuts } from '../../src/core/shortcuts';
import { sourceTypingAssist } from '../../src/features/editor-md/sourceTypingAssist';
import { installMediaGestureBoundary } from '../../src/core/mediaGestures';
import { setShortcutOverrides } from '../../src/core/shortcutBindings';

describe('Markdown interactive conveniences', () => {
  it.each(['<h3>heading</h3>', '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>task</p></li></ul>'])('Ctrl+0 restores %s through the real document event boundary', content => {
    const host = document.body.appendChild(document.createElement('div'));
    const editor = new Editor({ element: host, extensions: [...buildDocumentExtensions(), MarkdownTypingKeys], content });
    const dispose = installMediaGestureBoundary(document);
    try {
      let pos = 0;
      editor.state.doc.descendants((node, at) => { if (node.isTextblock) { pos = at + 1; return false; } });
      editor.commands.setTextSelection(pos);
      const initial = editor.state.doc;
      const event = new KeyboardEvent('keydown', { key: '0', code: 'Digit0', ctrlKey: true, bubbles: true, cancelable: true });
      editor.view.dom.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(editor.state.doc.firstChild?.type.name).toBe('paragraph');
      expect(editor.state.doc.textContent).toBe(initial.textContent);
      const restored = editor.state.doc;
      editor.commands.undo(); expect(editor.state.doc.eq(initial)).toBe(true);
      editor.commands.redo(); expect(editor.state.doc.eq(restored)).toBe(true);
    } finally { dispose(); editor.destroy(); host.remove(); }
  });

  it('zoom fallback permits remapped editor keys while respecting already-consumed events', () => {
    const host = document.body.appendChild(document.createElement('div'));
    const editor = new Editor({ element: host, extensions: [...buildDocumentExtensions(), MarkdownTypingKeys], content: '<h2>heading</h2>' });
    const dispose = installMediaGestureBoundary(document);
    setShortcutOverrides({ 'markdown.heading0': ['Ctrl+Alt+0'] });
    try {
      editor.commands.setTextSelection(2);
      const blocked = new KeyboardEvent('keydown', { key: '0', code: 'Digit0', ctrlKey: true, altKey: true, bubbles: true, cancelable: true });
      blocked.preventDefault(); editor.view.dom.dispatchEvent(blocked);
      expect(editor.state.doc.firstChild?.type.name).toBe('heading');
      const event = new KeyboardEvent('keydown', { key: '0', code: 'Digit0', ctrlKey: true, altKey: true, bubbles: true, cancelable: true });
      editor.view.dom.dispatchEvent(event);
      expect(editor.state.doc.firstChild?.type.name).toBe('paragraph'); expect(event.defaultPrevented).toBe(true);
      const outside = new KeyboardEvent('keydown', { key: '0', ctrlKey: true, bubbles: true, cancelable: true });
      document.body.dispatchEvent(outside); expect(outside.defaultPrevented).toBe(true);
    } finally { setShortcutOverrides({}); dispose(); editor.destroy(); host.remove(); }
  });

  it('Ctrl+0 is delivered to the Markdown source editor before browser zoom is cancelled', () => {
    const host = document.body.appendChild(document.createElement('div'));
    const source = new EditorView({ parent: host, state: EditorState.create({ doc: '### heading', extensions: [sourceTypingAssist] }) });
    const dispose = installMediaGestureBoundary(document);
    try {
      source.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: '0', code: 'Digit0', ctrlKey: true, bubbles: true, cancelable: true }));
      expect(source.state.doc.toString()).toBe('heading');
    } finally { dispose(); source.destroy(); host.remove(); }
  });
  it('Backspace removes the empty paragraph after a divider without undoing the divider input rule', () => {
    const editor = new Editor({ extensions: [...buildDocumentExtensions(), MarkdownTypingKeys], content: '<p>before</p><p>***</p><p>after</p>' });
    try {
      editor.commands.setTextSelection(12);
      const press = (key: string) => editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      press('Enter');
      expect(editor.state.doc.child(1).type.name).toBe('horizontalRule');
      expect(editor.state.selection.$from.parent.textContent).toBe('');
      press('Backspace');
      expect(editor.state.doc.child(1).type.name).toBe('horizontalRule');
      expect(editor.state.doc.childCount).toBe(3);
      expect(editor.state.doc.child(2).textContent).toBe('after');
      expect(editor.state.doc.textContent).not.toContain('*');
      editor.commands.undo();
      expect(editor.state.doc.child(1).type.name).toBe('horizontalRule');
      expect(editor.state.doc.childCount).toBe(4);
      editor.commands.redo();
      expect(editor.state.doc.childCount).toBe(3);
    } finally { editor.destroy(); }
  });

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
  for (const [text, expected, language] of [['···', 'codeBlock', null], ['···python', 'codeBlock', 'python'], ['···c++', 'codeBlock', 'c++'], ['text···', 'paragraph', null], ['...', 'paragraph', null], ['···text···', 'paragraph', null]] as [string, string, string | null][]) {
    it(`only independent middle-dot fence converts: ${text}`, () => {
      const editor = new Editor({ extensions: [...buildDocumentExtensions(), MarkdownTypingKeys], content: `<p>${text}</p>` });
      try {
        expect(editor.state.doc.firstChild?.type.name).toBe('paragraph'); // Loading is never a conversion.
        editor.commands.setTextSelection(text.length + 1);
        editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
        expect(editor.state.doc.firstChild?.type.name).toBe(expected);
        if (expected === 'codeBlock') expect(editor.state.doc.firstChild?.attrs.language).toBe(language);
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
  it('source underline toggles but highlight never creates private source metadata', () => {
    const view = new EditorView({ state: EditorState.create({ doc: 'text', selection: { anchor: 0, head: 4 } }) });
    try {
      formatSourceMark(view, 'underline'); expect(view.state.doc.toString()).toBe('<u>text</u>');
      formatSourceMark(view, 'underline'); expect(view.state.doc.toString()).toBe('text');
      expect(formatSourceMark(view, 'highlight', '#fef08a')).toBe(false);
      expect(view.state.doc.toString()).toBe('text');
      formatSourceMark(view, 'highlight', undefined, true); expect(view.state.doc.toString()).toBe('text');
      setSourceHeading(view, 2); expect(view.state.doc.toString()).toBe('## text');
      setSourceHeading(view, 0); expect(view.state.doc.toString()).toBe('text');
    } finally { view.destroy(); }
  });
});
