import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { MathInline, MathBlock } from '../../src/features/editor-md/katexExtensions';
import { GitHubAlert } from '../../src/features/editor-md/alertExtension';
import { parseMarkdown } from '../../src/features/editor-md/serialize';
import { mapModeSelection } from '../../src/features/editor-md/sourcePosition';

describe('跨模式位置', () => {
  for (const md of ['重复 text\n\n重复 **target** text', '> first\n> second target\n', '- first\n- second target', '> [!NOTE]\n> first\n> second target', 'A &amp; B \\* target', 'before $x^2$ and \\(y\\) target', '```python\nx = 1\n# target\n```']) {
    it(md, () => {
      const editor = new Editor({ extensions: [StarterKit, MathInline, MathBlock, GitHubAlert, Markdown] });
      try {
        parseMarkdown(editor, md);
        let visual = -1;
        editor.state.doc.descendants((node, pos) => { if (node.isText && node.text!.includes('target')) visual = pos + node.text!.indexOf('target') + 3; });
        const source = md.indexOf('target') + 3;
        expect(mapModeSelection(editor, md, 'source', { anchor: visual, head: visual }).head).toBe(source);
        expect(mapModeSelection(editor, md, 'visual', { anchor: source, head: source }).head).toBe(visual);
      } finally { editor.destroy(); }
    });
  }
});
