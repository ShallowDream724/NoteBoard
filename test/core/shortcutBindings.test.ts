import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { SHORTCUTS } from '../../src/core/shortcutCatalog';
import { commandBindings, normalizeShortcut, setShortcutOverrides, shortcutConflicts, shortcutValidation } from '../../src/core/shortcutBindings';
import { customCodeMirrorShortcuts } from '../../src/core/editor/customShortcuts';
import { initShortcuts, registerShortcut } from '../../src/core/shortcuts';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { MarkdownTypingKeys } from '../../src/features/editor-md/typingAssist';
import { sourceTypingAssist } from '../../src/features/editor-md/sourceTypingAssist';

afterEach(() => setShortcutOverrides({}));
function press(target: HTMLElement, key: string, code: string, extra: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, code, ctrlKey: true, bubbles: true, cancelable: true, ...extra });
  target.dispatchEvent(event); return event;
}
describe('custom command bindings', () => {
  it('catalog defaults are canonical, unique within their contexts, and valid in settings', () => {
    expect(new Set(SHORTCUTS.map(item => item.id)).size).toBe(SHORTCUTS.length);
    for (const command of SHORTCUTS) for (const binding of command.defaults) {
      expect(normalizeShortcut(binding), command.id).toBe(binding);
      expect(shortcutValidation(binding), binding).toBeNull();
      expect(shortcutConflicts(command.id, binding, {}), binding).toEqual([]);
    }
    expect(shortcutConflicts('markdown.heading1', 'Ctrl+S').map(item => item.id)).toContain('file.save');
    expect(shortcutConflicts('code.comment', 'Ctrl+B').map(item => item.id)).not.toContain('markdown.bold');
  });
  it('updates registered commands live, suppresses old bindings, and restores defaults', () => {
    let count = 0; const stop = initShortcuts(), unregister = registerShortcut({ id: 'file.save', key: 'Ctrl+S', scope: 'global', description: 'save', action: () => count++ });
    try {
      setShortcutOverrides({ 'file.save': ['Ctrl+Alt+S'] });
      press(document.body, 's', 'KeyS'); expect(count).toBe(0);
      press(document.body, 's', 'KeyS', { altKey: true }); expect(count).toBe(1);
      setShortcutOverrides({ 'file.save': [] }); press(document.body, 's', 'KeyS', { altKey: true }); expect(count).toBe(1);
      setShortcutOverrides({ 'file.save': null }); press(document.body, 's', 'KeyS'); expect(count).toBe(2);
      expect(commandBindings('file.save')).toEqual(['Ctrl+S']);
    } finally { unregister(); stop(); }
  });
  it('remaps visual formatting with physical keys and retires all heading aliases', () => {
    const editor = new Editor({ extensions: [...buildDocumentExtensions(), MarkdownTypingKeys], content: '<p>Text</p>' });
    try {
      setShortcutOverrides({ 'markdown.heading1': ['Ctrl+Alt+9'], 'markdown.underline': ['Ctrl+Alt+U'] });
      press(editor.view.dom, '1', 'Digit1'); expect(editor.state.doc.firstChild?.type.name).toBe('paragraph');
      press(editor.view.dom, '1', 'Digit1', { altKey: true }); expect(editor.state.doc.firstChild?.type.name).toBe('paragraph');
      press(editor.view.dom, 'Process', 'Digit9', { altKey: true }); expect(editor.state.doc.firstChild?.attrs.level).toBe(1);
      editor.commands.setTextSelection({ from: 1, to: 5 });
      press(editor.view.dom, 'u', 'KeyU'); expect(editor.isActive('underline')).toBe(false);
      press(editor.view.dom, 'u', 'KeyU', { altKey: true }); expect(editor.isActive('underline')).toBe(true);
    } finally { editor.destroy(); }
  });
  it('source formatting and links execute remapped commands', () => {
    const view = new EditorView({ state: EditorState.create({ doc: 'Text', selection: { anchor: 0, head: 4 }, extensions: [sourceTypingAssist, keymap.of(defaultKeymap)] }) });
    try {
      setShortcutOverrides({ 'markdown.bold': ['Ctrl+Alt+B'], 'markdown.link': ['Ctrl+Alt+K'] });
      press(view.contentDOM, 'b', 'KeyB'); expect(view.state.doc.toString()).toBe('Text');
      press(view.contentDOM, 'b', 'KeyB', { altKey: true }); expect(view.state.doc.toString()).toBe('**Text**');
      press(view.contentDOM, 'k', 'KeyK', { altKey: true }); expect(view.state.doc.toString()).toBe('**[Text](https://)**');
    } finally { view.destroy(); }
  });
  it('CodeMirror remapped undo executes the existing history and consumes a boundary no-op', () => {
    const view = new EditorView({ state: EditorState.create({ doc: 'a', extensions: [customCodeMirrorShortcuts('code'), history(), keymap.of([...defaultKeymap, ...historyKeymap])] }) });
    try {
      setShortcutOverrides({ 'edit.undo': ['Ctrl+Alt+U'] });
      view.dispatch({ changes: { from: 1, insert: 'b' } });
      press(view.contentDOM, 'z', 'KeyZ'); expect(view.state.doc.toString()).toBe('ab');
      press(view.contentDOM, 'u', 'KeyU', { altKey: true }); expect(view.state.doc.toString()).toBe('a');
      expect(press(view.contentDOM, 'u', 'KeyU', { altKey: true }).defaultPrevented).toBe(true);
    } finally { view.destroy(); }
  });
});
