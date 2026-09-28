import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import MarkdownIt from 'markdown-it';
import { buildDocumentExtensions, parseMarkdownDocument } from '../../src/features/editor-md/documentExtensions';
import { serializeMarkdown } from '../../src/features/editor-md/serialize';
import { setParagraphPresentation, setTextColor } from '../../src/features/document-style/documentStyles';
import { nativeTestEditor } from './nativeTestEditor';
import { renderDocument } from '../../src/features/export/renderDocument';

describe('body-first document styles', () => {
  it('centers display math by default and preserves left/right alignment in native, Markdown metadata, and HTML export', async () => {
    const editor = nativeTestEditor(new Editor({ extensions: buildDocumentExtensions(), content: { type: 'doc', content: [
      { type: 'mathBlock', attrs: { latex: 'a=b' } },
      { type: 'mathBlock', attrs: { latex: 'c=d' } },
    ] } }));
    try {
      expect(editor.state.doc.firstChild?.attrs.textAlign).toBe('center');
      editor.commands.setNodeSelection(0);
      expect(setParagraphPresentation(editor, { textAlign: 'left' })).toBe(true);
      expect(editor.state.doc.firstChild?.attrs.textAlign).toBe('left');
      editor.commands.setNodeSelection(editor.state.doc.firstChild!.nodeSize);
      expect(setParagraphPresentation(editor, { textAlign: 'right' })).toBe(true);
      const markdown = serializeMarkdown(editor);
      expect(parseMarkdownDocument(markdown).toJSON().content).toEqual(editor.getJSON().content?.slice(0, 2));
      const exported = await renderDocument('', 'Math', '', undefined, editor.state.doc, async () => ({ html: '<span class="katex-display">formula</span>' }));
      expect(exported.html).toContain('data-math-align="left"');
      expect(exported.html).toContain('data-math-align="right"');
      expect(exported.html).toContain('text-align: left');
      expect(exported.html).toContain('text-align: right');
    } finally { editor.destroy(); }
  });
  it('preserves overlapping inline colors, highlight, paragraph styles and normal Markdown', () => {
    const editor = new Editor({ extensions: buildDocumentExtensions(), content: '<p>one <strong>two</strong> three</p>' });
    try {
      nativeTestEditor(editor);
      editor.commands.setTextSelection({ from: 2, to: 10 }); expect(setTextColor(editor, '#2563eb')).toBe(true);
      editor.commands.setTextSelection({ from: 5, to: 13 }); editor.commands.setHighlight({ color: '#fef08a' });
      setParagraphPresentation(editor, { textAlign: 'center', indentBy: 1 });
      const markdown = serializeMarkdown(editor);
      expect(markdown).toContain('one **two** three'); expect(markdown).toContain('<!-- noteboard-styles ');
      expect(markdown).not.toContain('<mark'); expect(markdown).not.toContain('<span');
      expect(parseMarkdownDocument(markdown).toJSON()).toEqual(editor.getJSON());
      const preview = new MarkdownIt({ html: true }).render(markdown);
      expect(preview.replace(/<!--[\s\S]*?-->/g, '').trim()).toBe('<p>one <strong>two</strong> three</p>');
      expect(new MarkdownIt({ html: false }).render(markdown)).toContain('&lt;!-- noteboard-styles');
    } finally { editor.destroy(); }
  });
  it('keeps duplicate paragraphs distinct on roundtrip, but rejects changed/ambiguous anchors', () => {
    const editor = new Editor({ extensions: buildDocumentExtensions(), content: '<p>same</p><p>same</p><p>unique</p>' });
    try {
      nativeTestEditor(editor);
      editor.commands.setTextSelection({ from: 1, to: 5 }); expect(setTextColor(editor, '#dc2626')).toBe(true);
      editor.commands.setTextSelection({ from: 7, to: 11 }); setTextColor(editor, '#2563eb');
      editor.commands.setTextSelection({ from: 13, to: 19 }); editor.commands.setHighlight({ color: '#fef08a' });
      const markdown = serializeMarkdown(editor);
      expect(parseMarkdownDocument(markdown).toJSON()).toEqual(editor.getJSON());
      const changed = parseMarkdownDocument('inserted\n\n' + markdown);
      expect(changed.child(1).firstChild?.marks).toHaveLength(0);
      expect(changed.child(2).firstChild?.marks).toHaveLength(0);
      expect(changed.child(3).firstChild?.marks[0]?.type.name).toBe('highlight');
      expect(parseMarkdownDocument(markdown.replace('unique', 'edited')).child(2).firstChild?.marks).toHaveLength(0);
    } finally { editor.destroy(); }
  });
  it('reads legacy highlight markup and writes safe standalone annotations on the next save', () => {
    const editor = new Editor({ extensions: buildDocumentExtensions(), content: '<mark data-color="#fef08a">old **bold**</mark>', contentType: 'markdown' });
    try {
      const markdown = serializeMarkdown(editor);
      expect(markdown).not.toContain('<mark'); expect(parseMarkdownDocument(markdown).toJSON()).toEqual(editor.getJSON());
      const escapedExample = parseMarkdownDocument('```text\n' + markdown + '\n```');
      expect(escapedExample.firstChild?.type.name).toBe('codeBlock');
      expect(escapedExample.firstChild?.textContent).toContain('noteboard-styles');
    } finally { editor.destroy(); }
  });
  it('retains nested table/list text ranges and cell alignment through the shared worker grammar', () => {
    const editor = new Editor({ extensions: buildDocumentExtensions(), content: '<ul><li><p>A <mark data-color="#fef08a">color</mark></p></li></ul><table><tr><th>Head</th></tr><tr><td style="text-align:right;vertical-align:middle"><p><span data-text-color="#2563eb">Cell</span></p></td></tr></table>' });
    try { expect(parseMarkdownDocument(serializeMarkdown(editor)).toJSON()).toEqual(editor.getJSON()); }
    finally { editor.destroy(); }
  });
});
