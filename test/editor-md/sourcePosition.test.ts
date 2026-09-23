import { describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { MathInline, MathBlock } from '../../src/features/editor-md/katexExtensions';
import { GitHubAlert } from '../../src/features/editor-md/alertExtension';
import { parseMarkdown } from '../../src/features/editor-md/serialize';
import { mapModeSelection } from '../../src/features/editor-md/sourcePosition';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';

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

  it.each(['mermaid', 'MERMAID options', 'plantuml', 'puml', 'uml', 'infographic', 'info'])('图表%s与后续重复正文的边界双向匹配', language => {
    const md = `same target\n\n\`\`\`${language}\nsame target\n\`\`\`\n\nsame target`;
    const editor = new Editor({ extensions: buildDocumentExtensions() });
    try {
      parseMarkdown(editor, md);
      let atom = -1, target = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name.endsWith('Block') && node.isAtom) atom = pos;
        if (node.isText && node.text!.includes('target')) target = pos + node.text!.indexOf('target') + 3;
      });
      expect(atom).toBeGreaterThanOrEqual(0);
      const start = md.indexOf('```'), end = md.lastIndexOf('```') + 3;
      expect(mapModeSelection(editor, md, 'source', { anchor: atom, head: atom + 1 })).toEqual({ anchor: start, head: end });
      expect(mapModeSelection(editor, md, 'visual', { anchor: start, head: end })).toEqual({ anchor: atom, head: atom + 1 });
      const source = md.lastIndexOf('target') + 3;
      expect(mapModeSelection(editor, md, 'source', { anchor: target, head: target }).head).toBe(source);
      expect(mapModeSelection(editor, md, 'visual', { anchor: source, head: source }).head).toBe(target);
    } finally { editor.destroy(); }
  });

  it.each([
    '| same | value |\n| --- | --- |\n| same | target |',
    '> - same\n> - same $x$ target',
    '- [ ] same\n- [x] same target',
    'same\r\n\r\nsame target',
  ])('表格/嵌套块/原始换行选区双向匹配：%s', md => {
    const editor = new Editor({ extensions: buildDocumentExtensions() });
    try {
      parseMarkdown(editor, md);
      let visual = -1;
      editor.state.doc.descendants((node, pos) => { if (node.isText && node.text!.includes('target')) visual = pos + node.text!.indexOf('target') + 3; });
      const source = md.lastIndexOf('target') + 3;
      expect(mapModeSelection(editor, md, 'source', { anchor: visual, head: visual }).head).toBe(source);
      expect(mapModeSelection(editor, md, 'visual', { anchor: source, head: source }).head).toBe(visual);
    } finally { editor.destroy(); }
  });

  it('连续空格和代码空白保留每个光标位置', () => {
    const md = 'one   two and `a  b`';
    const editor = new Editor({ extensions: buildDocumentExtensions() });
    try {
      parseMarkdown(editor, md);
      for (const source of [3, 4, 5, 6, md.indexOf('a  b') + 1, md.indexOf('a  b') + 2]) {
        const mapped = mapModeSelection(editor, md, 'visual', { anchor: source, head: source });
        expect(mapModeSelection(editor, md, 'source', mapped).head).toBe(source);
      }
    } finally { editor.destroy(); }
  });

  it.each(['', '\n\n'])('空正文边界保持有效位置：%j', md => {
    const editor = new Editor({ extensions: buildDocumentExtensions() });
    try {
      parseMarkdown(editor, md);
      expect(mapModeSelection(editor, md, 'source', { anchor: 1, head: 1 })).toEqual({ anchor: md.length, head: md.length });
      expect(mapModeSelection(editor, md, 'visual', { anchor: md.length, head: md.length })).toEqual({ anchor: 1, head: 1 });
    } finally { editor.destroy(); }
  });

  it('长前缀往返和光标移动复用同一索引，不序列化未选择的正文块', () => {
    const md = Array.from({ length: 400 }, (_, i) => `paragraph ${i} **repeated text**`).join('\n\n') + '\n\nlast target';
    const editor = new Editor({ extensions: buildDocumentExtensions() });
    try {
      parseMarkdown(editor, md);
      const manager = editor.storage.markdown.manager;
      const serialize = vi.spyOn(manager, 'serialize');
      const lexer = vi.spyOn(manager.instance, 'lexer');
      const source = md.lastIndexOf('target') + 3;
      const mapped = mapModeSelection(editor, md, 'visual', { anchor: source, head: source });
      expect(mapped.head).toBe(editor.state.doc.content.size - 4);
      editor.commands.setTextSelection(mapped.head);
      expect(mapModeSelection(editor, md, 'source', mapped).head).toBe(source);
      const otherSource = md.indexOf('paragraph 10') + 5;
      const otherVisual = mapModeSelection(editor, md, 'visual', { anchor: otherSource, head: otherSource });
      expect(mapModeSelection(editor, md, 'source', otherVisual).head).toBe(otherSource);
      expect(lexer).toHaveBeenCalledTimes(1);
      expect(serialize).not.toHaveBeenCalled();
    } finally { editor.destroy(); }
  });

  it('源码表示和可视化不可变根各自变化时替换索引', () => {
    const md = '**first** then **target**';
    const editor = new Editor({ extensions: buildDocumentExtensions() });
    try {
      parseMarkdown(editor, md);
      const lexer = vi.spyOn(editor.storage.markdown.manager.instance, 'lexer');
      const source = md.indexOf('target') + 3;
      const visual = mapModeSelection(editor, md, 'visual', { anchor: source, head: source });
      const alternate = '__first__ then **target**\n';
      expect(mapModeSelection(editor, alternate, 'source', visual).head).toBe(alternate.indexOf('target') + 3);
      expect(lexer).toHaveBeenCalledTimes(2);

      editor.commands.insertContentAt(1, 'new ');
      const edited = `new ${alternate}`;
      const editedSource = edited.indexOf('target') + 3;
      expect(mapModeSelection(editor, edited, 'visual', { anchor: editedSource, head: editedSource }).head).toBe(visual.head + 4);
      expect(lexer).toHaveBeenCalledTimes(3);
    } finally { editor.destroy(); }
  });
});
