// NoteBoard 多维表格多行文本富文本编辑器测试
// 直接驱动 TipTap 编辑器实例验证「扩展装配 + Markdown 往返」，不依赖 DOM 渲染库：
// 真实风险在于扩展冲突或 Markdown 扩展未生效，这类问题只有跑起来才暴露

import { describe, test, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { buildLongTextExtensions } from '@/features/bitable/BitableRichTextEditor';
import { clearTextStyleMarks } from '@/features/editor-md/textStyleMarks';

/** 用与线上一致的扩展集创建一个挂载到 jsdom 的编辑器 */
function createTestEditor(content = '') {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: buildLongTextExtensions(),
    content,
    contentType: 'markdown',
  });
  return editor;
}

describe('多行文本富文本编辑器扩展集', () => {
  test('列表转换后的紧邻输入单独撤销，再次撤销才恢复原列表', () => {
    const editor = createTestEditor('- one\n- two\n- three');
    try {
      let at = 0; editor.state.doc.descendants((node, pos) => { if (node.isTextblock && node.textContent === 'two') at = pos + 1; });
      editor.commands.setTextSelection(at); const before = editor.state.doc;
      expect(editor.commands.toggleOrderedList()).toBe(true); const converted = editor.state.doc;
      editor.view.dispatch(editor.state.tr.insertText('x'));
      expect(editor.commands.undo()).toBe(true); expect(editor.state.doc.eq(converted)).toBe(true);
      expect(editor.commands.undo()).toBe(true); expect(editor.state.doc.eq(before)).toBe(true);
      expect(editor.commands.redo()).toBe(true); expect(editor.state.doc.eq(converted)).toBe(true);
    } finally { editor.destroy(); }
  });
  test('切换当前列表项类型时保留其他项，并与相邻新列表连续编号', () => {
    const editor = createTestEditor('- one\n- two\n- three');
    try {
      const select = (text: string) => { let at = 0; editor.state.doc.descendants((node, pos) => { if (node.isTextblock && node.textContent === text) at = pos + 1; }); editor.commands.setTextSelection(at); };
      select('two'); expect(editor.commands.toggleOrderedList()).toBe(true);
      select('three'); expect(editor.commands.toggleOrderedList()).toBe(true);
      const lists = editor.state.doc.content.content.filter(node => node.type.name.endsWith('List'));
      expect(lists).toHaveLength(2); expect(lists[0].type.name).toBe('bulletList'); expect(lists[0].textContent).toBe('one');
      expect(lists[1].type.name).toBe('orderedList'); expect(lists[1].childCount).toBe(2); expect(lists[1].attrs.start).toBe(1);
      editor.state.doc.check();
    } finally { editor.destroy(); }
  });
  test('清除文字样式保留单元格正文的链接、列表和其他项', () => {
    const editor = createTestEditor('- [**one**](https://example.com)\n- **two**\n\nafter');
    try {
      let from = 0;
      editor.state.doc.descendants((node, pos) => { if (node.type.name === 'paragraph' && node.textContent === 'one') from = pos + 1; });
      editor.commands.setTextSelection({ from, to: from + 3 });
      expect(editor.chain().command(({ tr }) => clearTextStyleMarks(tr)).run()).toBe(true);
      expect(editor.state.doc.firstChild!.type.name).toBe('bulletList');
      expect(editor.state.doc.firstChild!.firstChild!.firstChild!.firstChild!.marks.map(mark => mark.type.name)).toEqual(['link']);
      expect(editor.getMarkdown()).toContain('**two**');
      expect(editor.getMarkdown()).toContain('[one](https://example.com)'); editor.state.doc.check();
    } finally { editor.destroy(); }
  });
  test('编辑器可用 Markdown 初始化并原样序列化回 Markdown', () => {
    const md = '# 标题\n\n正文 **加粗** 与 `行内代码`。';
    const editor = createTestEditor(md);
    const output = editor.getMarkdown();
    expect(output).toContain('# 标题');
    expect(output).toContain('**加粗**');
    expect(output).toContain('`行内代码`');
    editor.destroy();
  });

  test('代码块被识别为 codeBlock 节点而非普通段落', () => {
    const md = '说明：\n\n```ts\nconst a = 1;\n```\n';
    const editor = createTestEditor(md);
    let codeBlockCount = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'codeBlock') codeBlockCount += 1;
    });
    expect(codeBlockCount).toBe(1);
    editor.destroy();
  });

  test('代码块内容不丢字符：序列化后仍包含原始代码', () => {
    const md = '```ts\nconst answer = 42;\n```';
    const editor = createTestEditor(md);
    expect(editor.getMarkdown()).toContain('const answer = 42;');
    editor.destroy();
  });

  test('列表与引用被解析为对应节点', () => {
    const md = '- 第一项\n- 第二项\n\n> 引用内容';
    const editor = createTestEditor(md);
    const types = new Set<string>();
    editor.state.doc.descendants((node) => {
      types.add(node.type.name);
    });
    expect(types.has('bulletList')).toBe(true);
    expect(types.has('listItem')).toBe(true);
    expect(types.has('blockquote')).toBe(true);
    editor.destroy();
  });

  test('行内代码可与加粗嵌套共存（Markdown 兼容的 Code 扩展生效）', () => {
    // 默认 Code 的 excludes 会让这种合法 Markdown 解析出非法 marks 并降级为纯文本
    const md = '**加粗的 `代码`**';
    const editor = createTestEditor(md);
    const output = editor.getMarkdown();
    expect(output).toContain('`代码`');
    expect(output).toContain('**');
    editor.destroy();
  });

  test('setContent 以 markdown 为内容类型可重复覆盖文档', () => {
    const editor = createTestEditor('第一段');
    expect(editor.getMarkdown()).toContain('第一段');
    editor.commands.setContent('第二段', { contentType: 'markdown' });
    expect(editor.getMarkdown()).toContain('第二段');
    editor.destroy();
  });

  test('空内容初始化不抛错', () => {
    const editor = createTestEditor('');
    expect(editor.getMarkdown()).toBeDefined();
    editor.destroy();
  });
});
