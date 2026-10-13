import { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { expect, it } from 'vitest';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { parseMarkdown, serializeMarkdown } from '../../src/features/editor-md/serialize';
import { initializeEditorDocument, parseEditorDocument, serializeNativeNode } from '../../src/features/editor-md/editorDocumentCodec';

it.each(['sync', 'history'] as const)('Markdown %s preserves an empty code fence when the previous atom fills the selection', origin => {
  const editor = new Editor({ extensions: buildDocumentExtensions(), content: '<hr>' });
  try {
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)));
    parseMarkdown(editor, '```python\n```', origin);
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.firstChild?.type.name).toBe('codeBlock');
    expect(editor.state.doc.firstChild?.attrs.language).toBe('python');
    expect(editor.state.doc.firstChild?.content.size).toBe(0);
    expect(serializeMarkdown(editor)).toContain('```python');
  } finally { editor.destroy(); }
});

it.each(['sync', 'history'] as const)('NB %s restores legal empty code, heading and callout blocks exactly', origin => {
  for (const type of ['codeBlock', 'heading', 'githubAlert']) {
    const editor = new Editor({ extensions: buildDocumentExtensions(), content: '<hr>' });
    try {
      initializeEditorDocument(editor, serializeNativeNode(editor.state.doc), 'noteboard');
      editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)));
      const child = type === 'githubAlert' ? editor.schema.nodes.paragraph.create() : undefined;
      const target = editor.schema.topNodeType.create(null, editor.schema.nodes[type].create(null, child));
      parseEditorDocument(editor, serializeNativeNode(target), origin);
      expect(editor.state.doc.toJSON()).toEqual(target.toJSON());
    } finally { editor.destroy(); }
  }
});

it('ordinary deletion of the whole document still resets its empty heading to a paragraph', () => {
  const editor = new Editor({ extensions: buildDocumentExtensions(), content: '<h2>待删除正文</h2>' });
  try {
    editor.commands.selectAll();
    editor.commands.deleteSelection();
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.firstChild?.type.name).toBe('paragraph');
    expect(editor.state.doc.firstChild?.content.size).toBe(0);
  } finally { editor.destroy(); }
});
