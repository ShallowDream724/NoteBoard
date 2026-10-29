import { describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { AuthoringInput, convertAuthoringBlock } from '../../src/features/editor-md/authoringInput';
import { InlineFormattingInput } from '../../src/features/editor-md/inlineFormattingInput';
import { collectAnnotations } from '../../src/features/editor-md/annotations/model';
import { parameterizedSlashCommand, searchLeafCommands } from '../../src/features/editor-md/slashCommand';

function editorWith(text = '') {
  const editor = new Editor({ extensions: [...buildDocumentExtensions({ inlineFormattingInput: InlineFormattingInput }), AuthoringInput],
    content: { type: 'doc', content: [{ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) }] } });
  editor.commands.setTextSelection(text.length + 1);
  return editor;
}

function type(editor: Editor, text: string) {
  for (const character of text) {
    const { from, to } = editor.state.selection;
    let handled = false;
    editor.view.someProp('handleTextInput', handler => {
      handled = !!handler(editor.view, from, to, character, () => editor.state.tr.insertText(character, from, to));
      return handled;
    });
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(character, from, to));
  }
}

describe('declarative prose input', () => {
  it.each([['\\blur{答案}', 'conceal'], ['\\u{答案}', 'underline'], ['\\color[red]{答案}', 'textColor']])('converts the completed %s and undoes to its complete literal input and caret', (source, mark) => {
    const editor = editorWith();
    try {
      type(editor, source.slice(0, -1));
      expect(editor.state.doc.textContent).toBe(source.slice(0, -1));
      type(editor, '}');
      expect(editor.state.doc.textContent).toBe('答案');
      expect(editor.state.doc.firstChild?.firstChild?.marks.some(item => item.type.name === mark)).toBe(true);
      editor.commands.undo();
      expect(editor.state.doc.textContent).toBe(source);
      expect(editor.state.selection.from).toBe(source.length + 1);
      editor.commands.redo(); expect(editor.state.doc.textContent).toBe('答案');
    } finally { editor.destroy(); }
  });

  it('preserves nested declarations until the outer command closes', () => {
    const editor = editorWith();
    try {
      type(editor, '\\color[red]{a \\b{b}');
      expect(editor.state.doc.textContent).toBe('\\color[red]{a \\b{b}');
      type(editor, '}');
      expect(editor.state.doc.textContent).toBe('a b');
      expect(editor.state.doc.firstChild?.lastChild?.marks.map(mark => mark.type.name)).toEqual(expect.arrayContaining(['bold', 'textColor']));
    } finally { editor.destroy(); }
  });

  it.each(['\\color[notacolor]{x}', '\\blur{x', 'C++', 'a++', 'https://host/\\blur{x}'])('keeps ordinary, incomplete or invalid input literal: %s', source => {
    const editor = editorWith();
    try { type(editor, source); expect(editor.state.doc.textContent).toBe(source); expect(editor.state.doc.firstChild?.firstChild?.marks).toEqual([]); }
    finally { editor.destroy(); }
  });

  it.each(['code', 'link', 'annotationReference'])('does not reinterpret %s content', name => {
    const editor = editorWith('\\blur{x');
    try {
      const attrs = name === 'link' ? { href: 'https://example.com' } : name === 'annotationReference' ? { id: 'old' } : undefined;
      editor.view.dispatch(editor.state.tr.addMark(1, editor.state.doc.content.size - 1, editor.schema.marks[name].create(attrs)));
      type(editor, '}'); expect(editor.state.doc.textContent).toBe('\\blur{x}');
    } finally { editor.destroy(); }
  });

  it('does not reinterpret composition or an existing code block', () => {
    const editor = editorWith('\\blur{x');
    try {
      vi.spyOn(editor.view, 'composing', 'get').mockReturnValue(true);
      type(editor, '}'); expect(editor.state.doc.textContent).toBe('\\blur{x}');
    } finally { editor.destroy(); }
    const code = editorWith('\\blur{x');
    try { code.commands.setCodeBlock(); type(code, '}'); expect(code.state.doc.textContent).toBe('\\blur{x}'); }
    finally { code.destroy(); }
  });

  it.each([['`\\blur{x`', 9], ['$x+\\blur{x$', 11]])('protects literal code/math syntax with an existing closer: %s', (source, caret) => {
    const editor = editorWith(source);
    try {
      editor.commands.setTextSelection(caret);
      type(editor, '}');
      expect(editor.state.doc.textContent).toContain('\\blur{x}');
      expect(editor.state.doc.firstChild?.firstChild?.marks.some(mark => mark.type.name === 'conceal')).toBe(false);
    } finally { editor.destroy(); }
  });

  it('merges new inline notes with existing annotation bodies and undoes both anchor and body together', () => {
    const editor = editorWith();
    try {
      type(editor, '\\note{one}{first}'); type(editor, ' '); type(editor, '\\note{two}{second}');
      expect(editor.state.doc.textContent).toContain('one two');
      expect(collectAnnotations(editor.state.doc).size).toBe(2);
      editor.commands.undo();
      expect(collectAnnotations(editor.state.doc).size).toBe(1);
      expect(editor.state.doc.textContent).toContain('\\note{two}{second}');
    } finally { editor.destroy(); }
  });

  it('reuses an existing shared note body without creating another annotation record', () => {
    const editor = editorWith();
    try {
      type(editor, '\\note{one}{first}');
      const id = [...collectAnnotations(editor.state.doc).keys()][0];
      type(editor, ' '); type(editor, `\\note[ref=${id}]{two}`);
      expect(editor.state.doc.textContent).toContain('one two');
      expect(collectAnnotations(editor.state.doc).size).toBe(1);
      expect(editor.state.doc.lastChild?.lastChild?.marks.find(mark => mark.type.name === 'annotationReference')?.attrs.id).toBe(id);
      editor.commands.undo();
      expect(collectAnnotations(editor.state.doc).size).toBe(1);
      expect(editor.state.doc.textContent).toContain(`\\note[ref=${id}]{two}`);
      editor.commands.redo();
      expect(editor.state.doc.lastChild?.lastChild?.marks.find(mark => mark.type.name === 'annotationReference')?.attrs.id).toBe(id);
    } finally { editor.destroy(); }
  });

  it.each([['::: note', 'githubAlert'], ['::: fold "Details"', 'disclosure'], ['::: table 2*3', 'table'], ['::: pic 1*2', 'imageCollection']])('Enter turns %s into a usable template and preserves one-step undo', (source, kind) => {
    const editor = editorWith(source);
    try {
      expect(convertAuthoringBlock(editor.view)).toBe(true);
      expect(editor.state.doc.firstChild?.type.name).toBe(kind);
      if (kind !== 'imageCollection') expect(editor.state.selection.$from.parent.isTextblock).toBe(true);
      editor.commands.undo(); expect(editor.state.doc.textContent).toBe(source); expect(editor.state.selection.from).toBe(source.length + 1);
    } finally { editor.destroy(); }
  });

  it.each(['::: fold', '::: annotation', '::: explain', '::: pic 0*2', '::: native'])('leaves a declaration without its required context or parameters intact: %s', source => {
    const editor = editorWith(source);
    try { expect(convertAuthoringBlock(editor.view)).toBe(false); expect(editor.state.doc.textContent).toBe(source); }
    finally { editor.destroy(); }
  });

  it('creates an explicitly named definition and opens its editable body', () => {
    const editor = editorWith('::: annotation shared');
    try {
      const opened = vi.fn(); expect(convertAuthoringBlock(editor.view, opened)).toBe(true);
      expect(collectAnnotations(editor.state.doc).has('shared')).toBe(true);
      expect(opened).toHaveBeenCalledWith('shared');
      expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
      expect(editor.state.selection.$from.node(-1).type.name).toBe('doc');
      editor.commands.undo(); expect(editor.state.doc.textContent).toBe('::: annotation shared');
    } finally { editor.destroy(); }
  });

  it('binds explain to its previous sibling and opens its editable explanation', () => {
    const editor = editorWith();
    try {
      editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Target' }] }, { type: 'paragraph', content: [{ type: 'text', text: '::: explain' }] }] });
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      const opened = vi.fn(); expect(convertAuthoringBlock(editor.view, opened)).toBe(true);
      const target = [...Array(editor.state.doc.childCount)].map((_, i) => editor.state.doc.child(i)).find(node => node.type.name === 'paragraph')!;
      expect(target.attrs.annotationId).toBeTruthy(); expect(collectAnnotations(editor.state.doc).has(target.attrs.annotationId)).toBe(true);
      expect(opened).toHaveBeenCalledWith(target.attrs.annotationId);
      editor.commands.undo(); expect(editor.state.doc.textContent).toBe('Target::: explain'); expect(collectAnnotations(editor.state.doc).size).toBe(0);
    } finally { editor.destroy(); }
  });

  it('binds an explain reference to an existing definition without duplicating it', () => {
    const editor = editorWith();
    try {
      editor.commands.setContent({ type: 'doc', content: [
        { type: 'annotationStore', content: [{ type: 'annotationBody', attrs: { id: 'shared' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Shared body' }] }] }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Target' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '::: explain ref=shared' }] },
      ] });
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      const opened = vi.fn(); expect(convertAuthoringBlock(editor.view, opened)).toBe(true);
      expect(editor.state.doc.child(1).attrs.annotationId).toBe('shared');
      expect(collectAnnotations(editor.state.doc).size).toBe(1); expect(opened).toHaveBeenCalledWith('shared');
      editor.commands.undo();
      expect(editor.state.doc.lastChild?.textContent).toBe('::: explain ref=shared');
      expect(collectAnnotations(editor.state.doc).size).toBe(1);
    } finally { editor.destroy(); }
  });
});

describe('slash declaration parameters', () => {
  it.each([['pic 1*2', 'imageCollection'], ['img 1*2', 'imageCollection'], ['grid 1*2', 'imageCollection'], ['slide print-cols=2', 'imageCollection'], ['carousel print-cols=2', 'imageCollection'], ['table 2*3', 'table'], ['tbl 2*3', 'table'], ['details "Details"', 'disclosure']])('executes /%s through shared declaration parsing', (query, kind) => {
    const editor = editorWith(`/${query}`);
    try {
      const command = parameterizedSlashCommand(query); expect(command).toBeTruthy();
      command!.action(editor, { from: 1, to: query.length + 2 });
      expect(editor.state.doc.firstChild?.type.name).toBe(kind);
      expect(editor.state.doc.textContent).not.toContain('/');
    } finally { editor.destroy(); }
  });
  it('keeps invalid parameter requests out of the action list and retains familiar aliases', () => {
    expect(searchLeafCommands('img 0*2')).toEqual([]);
    expect(searchLeafCommands('tbl')[0].id).toBe('table');
    expect(searchLeafCommands('details')[0].id).toBe('disclosure');
    expect(searchLeafCommands('img')[0].id).toBe('image');
  });
});
