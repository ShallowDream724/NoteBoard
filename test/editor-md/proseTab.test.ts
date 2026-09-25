import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { MarkdownTypingKeys, handleProseTab } from '../../src/features/editor-md/typingAssist';
import { useSettingsStore } from '../../src/stores/settingsStore';
import { nativeTestEditor } from './nativeTestEditor';
import { DocumentCapabilityGuard, transactionAddedCapability } from '../../src/features/document-format/capabilityGuard';

function create(content: string) { return nativeTestEditor(new Editor({ extensions: [...buildDocumentExtensions(), MarkdownTypingKeys], content })); }
function tab(editor: Editor, shiftKey = false) { const event = new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', shiftKey, bubbles: true, cancelable: true }); editor.view.dom.dispatchEvent(event); return event; }

describe('visual editor Tab semantics', () => {
  it('inserts whitespace at the prose selection using current settings', () => {
    const editor = create('<p>hello</p>'), saved = useSettingsStore.getState().settings;
    try {
      useSettingsStore.setState({ settings: { ...saved, editor: { ...saved.editor, tabSize: 4, insertSpaces: true } } });
      editor.commands.setTextSelection({ from: 2, to: 4 });
      expect(tab(editor).defaultPrevented).toBe(true); expect(editor.state.doc.textContent).toBe('h    lo');
      useSettingsStore.setState({ settings: { ...saved, editor: { ...saved.editor, tabSize: 8, insertSpaces: false } } });
      tab(editor); expect(editor.state.doc.textContent).toBe('h    \tlo');
    } finally { useSettingsStore.setState({ settings: saved }); editor.destroy(); }
  });

  it('indents headings and selected dividers with independent reversible steps', () => {
    const editor = create('<h2>heading</h2><hr>');
    try {
      editor.commands.setTextSelection(3); tab(editor);
      expect(editor.state.doc.firstChild!.attrs.indent).toBe(1);
      expect(editor.state.doc.firstChild!.textContent).toBe('heading');
      tab(editor, true); expect(editor.state.doc.firstChild!.attrs.indent).toBe(0);
      editor.commands.undo(); expect(editor.state.doc.firstChild!.attrs.indent).toBe(1);
      const pos = editor.state.doc.firstChild!.nodeSize;
      editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
      tab(editor); expect(editor.state.doc.nodeAt(pos)!.attrs.indent).toBe(1);
      tab(editor, true); expect(editor.state.doc.nodeAt(pos)!.attrs.indent).toBe(0);
    } finally { editor.destroy(); }
  });

  it('retains table navigation, list nesting and code ownership', () => {
    const table = create('<table><tr><td>A</td><td>B</td></tr></table>');
    const list = create('<ul><li><p>one</p></li><li><p>two</p></li></ul>');
    const code = create('<pre><code>let x</code></pre>');
    try {
      table.commands.setTextSelection(4); const first = table.state.selection.from;
      expect(handleProseTab(table)).toBe(false); tab(table);
      expect(table.state.selection.from).toBeGreaterThan(first); expect(table.state.selection.$from.parent.textContent).toBe('B');
      tab(table, true); expect(table.state.selection.$from.parent.textContent).toBe('A');
      list.commands.setTextSelection(10); expect(handleProseTab(list)).toBe(false); tab(list);
      expect(list.state.doc.firstChild!.childCount).toBe(1);
      expect(list.state.doc.firstChild!.firstChild!.lastChild!.type.name).toBe('bulletList');
      tab(list, true); expect(list.state.doc.firstChild!.childCount).toBe(2);
      code.commands.setTextSelection(3); expect(handleProseTab(code)).toBe(false); expect(code.state.doc.textContent).toBe('let x');
    } finally { table.destroy(); list.destroy(); code.destroy(); }
  });

  it('requires the existing alignment capability for heading Tab and divider indent', () => {
    const editor = new Editor({ extensions: [...buildDocumentExtensions(), MarkdownTypingKeys, DocumentCapabilityGuard], content: '<h2>heading</h2><hr>' });
    try {
      editor.commands.setTextSelection(3); const before = editor.state.doc;
      expect(tab(editor).defaultPrevented).toBe(true); expect(editor.state.doc.eq(before)).toBe(true);
      const pos = before.firstChild!.nodeSize, tr = editor.state.tr.setNodeAttribute(pos, 'indent', 1);
      expect(transactionAddedCapability(tr)).toBe('alignment');
      editor.view.dispatch(tr); expect(editor.state.doc.eq(before)).toBe(true);
    } finally { editor.destroy(); }
  });
});
