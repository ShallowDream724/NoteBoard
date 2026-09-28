import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { MathBlock, MathInline } from '../../src/features/editor-md/katexExtensions';

const editors: Editor[] = [];
const paragraph = (text = ''): JSONContent => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });
function create(content: JSONContent[]) {
  const editor = new Editor({ extensions: [StarterKit, MathInline, MathBlock], content: { type: 'doc', content },
    editorProps: { handleScrollToSelection: () => true } });
  editors.push(editor); document.body.append(editor.view.dom); return editor;
}
function key(editor: Editor, key: string) {
  return editor.view.someProp('handleKeyDown', handler => handler(editor.view, new KeyboardEvent('keydown', { key })));
}
function type(editor: Editor, text: string) {
  for (const char of text) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp('handleTextInput', handler => handler(editor.view, from, to, char, () => editor.state.tr.insertText(char)));
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(char));
  }
}
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('formula keyboard navigation', () => {
  it.each(['loaded', 'typed compact', 'typed opener'])('selects and leaves a %s block formula from either adjoining paragraph', creation => {
    const editor = create([paragraph('before'), creation === 'loaded' ? { type: 'mathBlock', attrs: { latex: 'x' } } : paragraph(), paragraph('after')]);
    if (creation !== 'loaded') {
      editor.commands.setTextSelection(9);
      type(editor, creation === 'typed compact' ? '$$x$$' : '$$');
      if (creation === 'typed opener') { key(editor, 'Enter'); editor.commands.updateAttributes('mathBlock', { latex: 'x' }); }
    }
    const before = editor.state.doc;
    expect(before.child(1).type.name).toBe('mathBlock');
    editor.commands.setTextSelection(7);
    expect(key(editor, 'ArrowDown')).toBe(true);
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect((editor.state.selection as NodeSelection).node.type.name).toBe('mathBlock');
    key(editor, 'ArrowDown');
    expect(editor.state.selection.$from.parent.textContent).toBe('after');
    expect(editor.state.selection.$from.parentOffset).toBe(0);
    key(editor, 'ArrowUp'); expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    key(editor, 'ArrowUp'); expect(editor.state.selection.from).toBe(7);
    expect(editor.state.doc).toBe(before);
  });

  it('waits until the last visual line before entering the following block formula', () => {
    const editor = create([paragraph('wrapped text'), { type: 'mathBlock', attrs: { latex: 'x' } }, paragraph()]);
    editor.commands.setTextSelection(3);
    const boundary = vi.spyOn(editor.view, 'endOfTextblock').mockReturnValue(false);
    expect(key(editor, 'ArrowDown')).toBeFalsy();
    expect(editor.state.selection).toBeInstanceOf(TextSelection);
    boundary.mockReturnValue(true);
    expect(key(editor, 'ArrowDown')).toBe(true);
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
  });

  it.each(['loaded', 'typed'])('selects a %s inline formula from both sides and then returns to text', creation => {
    const editor = create([creation === 'loaded' ? { type: 'paragraph', content: [
      { type: 'text', text: 'a' }, { type: 'mathInline', attrs: { latex: 'x' } }, { type: 'text', text: 'b' },
    ] } : paragraph('a')]);
    if (creation === 'typed') { editor.commands.setTextSelection(2); type(editor, '$x$b'); }
    const before = editor.state.doc;
    editor.commands.setTextSelection(2);
    key(editor, 'ArrowRight'); expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect((editor.state.selection as NodeSelection).node.type.name).toBe('mathInline');
    key(editor, 'ArrowRight'); expect(editor.state.selection.from).toBe(3);
    key(editor, 'ArrowLeft'); expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    key(editor, 'ArrowLeft'); expect(editor.state.selection.from).toBe(2);
    expect(editor.state.doc).toBe(before);
  });
});
