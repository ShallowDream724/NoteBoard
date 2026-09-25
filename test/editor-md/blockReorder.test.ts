// NoteBoard Markdown 顶层块拖拽单元测试
// 验证普通块可稳定重排，同时列表、表格、代码块等嵌套位置始终被双层校验拒绝

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { HeadingFolding, headingSectionEnd, foldedSectionEnd, toggleHeadingFold } from '@/features/editor-md/headingFolding';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import {
  isTopLevelBlockMoveAllowed,
  moveTopLevelBlock,
  resolveTopLevelDropTarget,
} from '@/features/editor-md/blockReorder';

const editors: Editor[] = [];

/** 创建真实 TipTap 编辑器，覆盖段落、列表、表格和代码块的 ProseMirror Schema。 */
function createEditor(content: Record<string, unknown>): Editor {
  const editor = new Editor({
    extensions: [
      StarterKit,
      HeadingFolding,
      // 与生产配置一致启用列宽调整，确保 tableWrapper NodeView 也能正确映射顶层位置。
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content,
  });
  editors.push(editor);
  return editor;
}

/** 收集所有顶层节点位置，避免测试依赖手写的 nodeSize 魔法值。 */
function getTopLevelPositions(editor: Editor): number[] {
  const positions: number[] = [];
  editor.state.doc.forEach((_node, offset) => positions.push(offset));
  return positions;
}

/** 为 jsdom 中没有布局能力的元素提供确定的视口矩形。 */
function mockRect(element: HTMLElement, top: number, height: number): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    x: 100,
    y: top,
    top,
    left: 100,
    right: 500,
    bottom: top + height,
    width: 400,
    height,
    toJSON: () => ({}),
  } as DOMRect);
}

afterEach(() => {
  while (editors.length > 0) editors.pop()?.destroy();
  vi.restoreAllMocks();
});

describe('Markdown 顶层块安全重排序', () => {
  it('moves individual list items within and across lists, retaining marks and undo', () => {
    const item = (text: string) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text, marks: [{ type: 'bold' }] }] }] });
    const editor = createEditor({ type: 'doc', content: [{ type: 'orderedList', attrs: { start: 3 }, content: [item('one'),item('two'),item('three')] }, { type: 'paragraph', content: [{ type: 'text', text: 'end' }] }] });
    const initial = editor.state.doc;
    const first = 1, end = initial.firstChild!.nodeSize - 1;
    expect(moveTopLevelBlock(editor.view, first, end)).not.toBeNull();
    expect(editor.state.doc.firstChild!.textContent).toBe('twothreeone');
    editor.commands.undo(); expect(editor.state.doc.eq(initial)).toBe(true);
    const moved = moveTopLevelBlock(editor.view, first, initial.content.size)!;
    expect(moved).not.toBeNull();
    const list = editor.state.doc.resolve(moved.insertedPos).parent;
    expect(list.type.name).toBe('orderedList');
    expect(list.textContent).toBe('one');
    expect(list.firstChild!.firstChild!.firstChild!.marks[0].type.name).toBe('bold');
    editor.state.doc.check();
    editor.commands.undo(); expect(editor.state.doc.eq(initial)).toBe(true);
  });
  it('拖拽独立于前后输入撤销，重做保留移动后的内容', () => {
    const editor = createEditor({ type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'two' }] },
    ] });
    editor.view.dispatch(editor.state.tr.insertText('!', 2));
    const typed = editor.getJSON();
    moveTopLevelBlock(editor.view, 0, editor.state.doc.content.size);
    const moved = editor.getJSON();
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertContent('?');
    editor.commands.undo(); expect(editor.getJSON()).toEqual(moved);
    editor.commands.undo(); expect(editor.getJSON()).toEqual(typed);
    editor.commands.redo(); expect(editor.getJSON()).toEqual(moved);
  });

  it('折叠章节包含下级标题，整体移动且拒绝落入自身，展开恢复所有子块', () => {
    const h = (level: number, text: string) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });
    const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
    const editor = createEditor({ type: 'doc', content: [h(2,'3'), p('body'), h(3,'3.1'), p('child'), h(2,'4'), p('last')] });
    const positions = getTopLevelPositions(editor);
    expect(headingSectionEnd(editor.state.doc, 0)).toBe(positions[4]);
    toggleHeadingFold(editor.state, editor.view.dispatch, 0);
    expect(foldedSectionEnd(editor.state, 0)).toBe(positions[4]);
    expect(editor.view.dom.querySelectorAll('.nb-heading-fold-hidden')).toHaveLength(3);
    expect(moveTopLevelBlock(editor.view, 0, positions[2])).toBeNull();
    const moved = moveTopLevelBlock(editor.view, 0, editor.state.doc.content.size)!;
    expect(editor.state.doc.content.content.map(node => node.textContent)).toEqual(['4','last','3','body','3.1','child']);
    expect(foldedSectionEnd(editor.state, moved.insertedPos)).toBe(editor.state.doc.content.size);
    toggleHeadingFold(editor.state, editor.view.dispatch, moved.insertedPos);
    expect(editor.view.dom.querySelectorAll('.nb-heading-fold-hidden')).toHaveLength(0);
    editor.commands.undo();
    expect(editor.state.doc.content.content.map(node => node.textContent)).toEqual(['3','body','3.1','child','4','last']);
  });
  it('支持将普通顶层块向下和向上移动，并保持节点内容完整', () => {
    const editor = createEditor({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '第一段' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '第二段' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '第三段' }] },
      ],
    });

    expect(moveTopLevelBlock(editor.view, 0, editor.state.doc.content.size)).not.toBeNull();
    expect(editor.state.doc.content.content.map((node) => node.textContent)).toEqual([
      '第二段',
      '第三段',
      '第一段',
    ]);

    const positions = getTopLevelPositions(editor);
    expect(moveTopLevelBlock(editor.view, positions[2], 0)).not.toBeNull();
    expect(editor.state.doc.content.content.map((node) => node.textContent)).toEqual([
      '第一段',
      '第二段',
      '第三段',
    ]);
  });

  it('拒绝源块原位置、源块内部以及任意非顶层落点', () => {
    const editor = createEditor({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: '列表项' }] },
              ],
            },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: '外部段落' }] },
      ],
    });

    const listNode = editor.state.doc.nodeAt(0);
    const listEnd = listNode?.nodeSize ?? 0;
    const snapshot = editor.getJSON();

    expect(isTopLevelBlockMoveAllowed(editor.state.doc, 0, 0)).toBe(false);
    expect(isTopLevelBlockMoveAllowed(editor.state.doc, 0, listEnd)).toBe(false);
    expect(isTopLevelBlockMoveAllowed(editor.state.doc, 0, 2)).toBe(false);
    expect(moveTopLevelBlock(editor.view, 0, 2)).toBeNull();
    expect(editor.getJSON()).toEqual(snapshot);
  });

  it('表格单元格与代码块内容都不能成为源位置或目标位置', () => {
    const editor = createEditor({
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: '单元格' }] },
                  ],
                },
              ],
            },
          ],
        },
        { type: 'codeBlock', content: [{ type: 'text', text: 'const value = 1;' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '可移动段落' }] },
      ],
    });

    const [tablePos, codeBlockPos, paragraphPos] = getTopLevelPositions(editor);
    const tableCellInsidePos = tablePos + 2;
    const codeContentPos = codeBlockPos + 1;
    const snapshot = editor.getJSON();

    const [tableElement, codeElement, paragraphElement] = Array.from(
      editor.view.dom.children,
    ) as HTMLElement[];
    mockRect(tableElement, 100, 120);
    mockRect(codeElement, 240, 80);
    mockRect(paragraphElement, 340, 40);
    const tableTarget = resolveTopLevelDropTarget(editor.view, 140);

    expect(isTopLevelBlockMoveAllowed(editor.state.doc, paragraphPos, tableCellInsidePos)).toBe(false);
    expect(isTopLevelBlockMoveAllowed(editor.state.doc, paragraphPos, codeContentPos)).toBe(false);
    expect(moveTopLevelBlock(editor.view, tableCellInsidePos, editor.state.doc.content.size)).toBeNull();
    expect(moveTopLevelBlock(editor.view, codeContentPos, 0)).toBeNull();
    expect(tableTarget?.targetPos).toBe(tablePos);
    expect(tableTarget?.insertPos).toBe(tablePos);
    expect(tableTarget?.element).toBe(tableElement);
    expect(editor.state.doc.resolve(tableTarget?.insertPos ?? -1).depth).toBe(0);
    expect(editor.getJSON()).toEqual(snapshot);
  });

  it('指针位于嵌套列表内部时仍只解析为列表顶层边界', () => {
    const editor = createEditor({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: '列表项' }] },
              ],
            },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: '下一段' }] },
      ],
    });

    const [listElement, paragraphElement] = Array.from(editor.view.dom.children) as HTMLElement[];
    mockRect(listElement, 100, 80);
    mockRect(paragraphElement, 200, 40);

    const target = resolveTopLevelDropTarget(editor.view, 130);

    // DOM 元素单独按引用断言，避免 Vitest pretty-format 深度遍历 ProseMirror DOM 集合。
    expect(target?.targetPos).toBe(0);
    expect(target?.insertPos).toBe(0);
    expect(target?.edge).toBe('before');
    expect(target?.element).toBe(listElement);
    expect(editor.state.doc.resolve(target?.insertPos ?? -1).depth).toBe(0);
    expect(isTopLevelBlockMoveAllowed(editor.state.doc, 0, target?.insertPos ?? -1)).toBe(false);
  });
});
