// NoteBoard 选区气泡菜单稳定性回归测试
// TipTap 3.30 会在配置引用变化时派发事务；重复渲染必须保持配置引用不变，防止 React #185。

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/core';
import { EditorBubbleMenu } from '../../src/features/editor-md/bubbleMenu';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state';
import { EditorMenuScope } from '../../src/components/EditorMenuScope';
import { useHoverMenu } from '../../src/components/useHoverMenu';

const bubbleProps = vi.hoisted(() => [] as Array<{ shouldShow: unknown; options: unknown }>);

vi.mock('@tiptap/react/menus', () => ({
  BubbleMenu: (props: { shouldShow: unknown; options: unknown; children: React.ReactNode }) => {
    bubbleProps.push({ shouldShow: props.shouldShow, options: props.options });
    return null;
  },
}));

vi.mock('../../src/components/Tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  TooltipDetailProvider: ({ children }: { children: React.ReactNode }) => children,
}));

beforeEach(() => {
  bubbleProps.length = 0;
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

it('suspends the selection toolbar for top menus and restores it without blurring or changing the selection', async () => {
  const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} } });
  const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('Selected words')])]);
  const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 1, 9) });
  const scroll = document.createElement('div'); scroll.style.overflowY = 'auto';
  const dom = document.createElement('div'); dom.tabIndex = 0; scroll.append(dom); document.body.append(scroll); dom.focus();
  const dispatch = vi.fn<(transaction: Transaction) => void>();
  const editor = { state, view: { dom, dispatch, hasFocus: () => true }, isActive: () => false, getAttributes: () => ({}), on: () => {}, off: () => {} } as unknown as Editor;
  function Activity({ open }: { open: boolean }) { useHoverMenu(open, () => {}); return null; }
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const render = (open: boolean) => root.render(<><EditorBubbleMenu editor={editor} inlineOnly/><EditorMenuScope editor={editor}><Activity open={open}/></EditorMenuScope></>);
  try {
    await act(async () => render(false));
    const shouldShow = bubbleProps.at(-1)!.shouldShow as (props: { editor: Editor; state: EditorState }) => boolean;
    expect(shouldShow({ editor, state })).toBe(true);
    await act(async () => render(true));
    expect(shouldShow({ editor, state })).toBe(false);
    expect((dispatch.mock.calls.at(-1)![0] as Transaction).getMeta('bubbleMenu')).toBe('hide');
    await act(async () => render(false));
    expect(shouldShow({ editor, state })).toBe(true);
    expect(dispatch.mock.calls.some(([tr]: [Transaction]) => tr.getMeta('bubbleMenu') === 'show')).toBe(true);
    expect(dispatch.mock.calls.every(([tr]: [Transaction]) => !tr.selectionSet && !tr.docChanged && tr.getMeta('addToHistory') === false)).toBe(true);
    expect(document.activeElement).toBe(dom);
    expect(editor.state.selection).toBe(state.selection);
  } finally { await act(async () => root.unmount()); host.remove(); scroll.remove(); }
});

it('父组件重复渲染时 BubbleMenu 的事务配置引用应保持稳定', async () => {
  const scrollContainer = document.createElement('div');
  scrollContainer.style.overflowY = 'auto';
  const editorDom = document.createElement('div');
  scrollContainer.appendChild(editorDom);
  document.body.appendChild(scrollContainer);
  const editor = {
    state: { selection: { empty: true } },
    view: { dom: editorDom },
    isActive: () => false,
    getAttributes: () => ({}),
    on: () => {}, off: () => {},
  } as unknown as Editor;

  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    for (let index = 0; index < 8; index += 1) {
      await act(async () => {
        root.render(<EditorBubbleMenu editor={editor} />);
      });
    }

    expect(bubbleProps).toHaveLength(8);
    expect(new Set(bubbleProps.map((item) => item.shouldShow)).size).toBe(1);
    expect(new Set(bubbleProps.map((item) => item.options)).size).toBe(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    scrollContainer.remove();
  }
});
