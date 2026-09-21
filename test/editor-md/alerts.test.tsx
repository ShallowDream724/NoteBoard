import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { GitHubAlert } from '../../src/features/editor-md/alertExtension';
import { MathInline, MathBlock } from '../../src/features/editor-md/katexExtensions';
import { parseMarkdown, serializeMarkdown } from '../../src/features/editor-md/serialize';

describe('提示块内容与保存', () => {
  for (const kind of ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']) {
    it(kind + ' 多段正文和公式可往返', () => {
      const editor = new Editor({ extensions: [StarterKit, GitHubAlert, MathInline, MathBlock, Markdown] });
      try {
        parseMarkdown(editor, '> [!' + kind + ']\n> **正文** $x^2$\n>\n> 第二段\n>\n> - 列表项\n\n后文');
        expect(editor.state.doc.firstChild?.type.name).toBe('githubAlert');
        expect(editor.state.doc.firstChild?.attrs.kind).toBe(kind.toLowerCase());
        expect(editor.state.doc.firstChild?.textContent).toContain('第二段');
        const saved = serializeMarkdown(editor);
        expect(saved).toContain('> [!' + kind + ']');
        expect(saved).toContain('**正文**');
        expect(saved).toContain('$x^2$');
        const before = editor.getJSON();
        parseMarkdown(editor, saved);
        expect(editor.getJSON()).toEqual(before);
      } finally { editor.destroy(); }
    });
  }
  it('空提示块也有明确的 Markdown 表示，不能在保存时消失', () => {
    const editor = new Editor({ extensions: [StarterKit, GitHubAlert, Markdown] });
    try {
      editor.commands.setContent({ type: 'doc', content: [{ type: 'githubAlert', attrs: { kind: 'tip' }, content: [{ type: 'paragraph' }] }] });
      const saved = serializeMarkdown(editor);
      expect(saved).toContain('> [!TIP]');
      parseMarkdown(editor, saved);
      expect(editor.state.doc.firstChild?.type.name).toBe('githubAlert');
    } finally { editor.destroy(); }
  });
});
