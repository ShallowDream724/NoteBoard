// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { nativeTestEditor } from './nativeTestEditor';
import { mountFigureCaptionEditor } from '../../src/features/editor-md/figureCaptionEditor';
import { getEditingScope, registerExternalEditingScope } from '../../src/features/editor-md/editingScope';
import { MarkdownToolbar } from '../../src/features/toolbar/MarkdownToolbar';
import { TooltipProvider } from '../../src/components/Tooltip';
import { setFigureCaption } from '../../src/features/editor-md/figureCaptionCommands';

vi.mock('../../src/features/editor-md/bubbleMenu', () => ({ EditorBubbleMenu: () => null }));
vi.mock('../../src/features/toolbar/ResponsiveToolbar', () => ({
  ResponsiveToolbar: ({ children }: { children: ReactNode }) => <div className="responsive-toolbar">{children}</div>,
  ToolbarOverflowItem: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../../src/features/history/documentHistory', async importOriginal => ({
  ...await importOriginal<object>(), useDocumentHistory: () => ({ canUndo: true, canRedo: true }),
}));

const editors: Editor[] = [], roots: Root[] = [], cleanups: Array<() => void> = [];
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
function parent() {
  const element = document.body.appendChild(document.createElement('div'));
  const editor = nativeTestEditor(new Editor({ element, extensions: buildDocumentExtensions(),
    editorProps: { handleScrollToSelection: () => true },
    content: '<table><tr><td>A</td></tr></table><p>Body selection</p>' }));
  editors.push(editor);
  setFigureCaption(editor.view, 0, 'Caption text');
  editor.commands.setTextSelection({ from: editor.state.doc.firstChild!.nodeSize + 1, to: editor.state.doc.content.size - 1 });
  return editor;
}
async function toolbar(editor: Editor) {
  const host = document.body.appendChild(document.createElement('div')), root = createRoot(host); roots.push(root);
  await act(async () => root.render(<TooltipProvider><MarkdownToolbar docKey="scope.nb" editor={editor} viewMode="visual"/></TooltipProvider>));
  return host;
}
async function click(host: HTMLElement, label: string) {
  const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  expect(button).not.toBeNull();
  await act(async () => {
    button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    button.click();
  });
}
afterEach(async () => {
  await act(async () => { cleanups.splice(0).forEach(cleanup => cleanup()); roots.splice(0).forEach(root => root.unmount()); });
  editors.splice(0).forEach(editor => editor.destroy()); document.body.replaceChildren();
});

describe('parent-owned editing scopes', () => {
  it('routes marks, color, clear and history to the caption while preserving the body selection', async () => {
    const editor = parent(), beforeBody = editor.state.doc.lastChild!, bodySelection = editor.state.selection;
    const host = document.body.appendChild(document.createElement('div'));
    let caption!: ReturnType<typeof mountFigureCaptionEditor>;
    await act(async () => { caption = mountFigureCaptionEditor(host, { view: editor.view, getPos: () => 0, label: '图注', close: () => caption.destroy() }); });
    cleanups.push(() => caption.destroy());
    caption.editor.commands.setTextSelection({ from: 1, to: 8 }); caption.editor.view.dom.focus();
    const top = await toolbar(editor);
    await click(top, '加粗');
    expect(editor.state.doc.firstChild!.attrs.captionContent[0].marks).toContainEqual({ type: 'bold' });
    expect(editor.state.doc.lastChild).toBe(beforeBody); expect(editor.state.selection.eq(bodySelection)).toBe(true);
    await click(top, '斜体'); await click(top, '下划线'); await click(top, '删除线'); await click(top, '行内代码');
    expect(caption.editor.isActive('code')).toBe(true);
    await click(top, '应用文字颜色与高亮');
    expect(caption.editor.isActive('highlight')).toBe(true);
    await click(top, '清除选中文本格式');
    expect(caption.editor.isActive('bold')).toBe(false); expect(caption.editor.isActive('highlight')).toBe(false);
    await click(top, '撤销'); expect(caption.editor.isActive('bold')).toBe(true);
    expect(document.activeElement).toBe(caption.editor.view.dom);
    expect(editor.state.doc.lastChild).toBe(beforeBody);
    expect(top.querySelector<HTMLButtonElement>('button[aria-label="标题等级"]')!.disabled).toBe(true);
    expect(top.querySelector<HTMLButtonElement>('button[aria-label="无序列表"]')!.disabled).toBe(true);
    await click(top, '插入超链接、图片、表格、公式、图表、提示块、日期时间等');
    expect(top.querySelector('[role="menuitem"][aria-label="表格"]')?.getAttribute('aria-disabled')).toBe('true');
    expect(top.querySelector('[role="menuitem"][aria-label="代码块"]')?.getAttribute('aria-disabled')).toBe('true');
    expect(getEditingScope(editor.view)?.kind).toBe('tiptap');
  });

  it('keeps caption selection during portal focus and edits links in the caption modal', async () => {
    const editor = parent(), body = editor.state.doc.lastChild!;
    const host = document.body.appendChild(document.createElement('div'));
    let caption!: ReturnType<typeof mountFigureCaptionEditor>;
    await act(async () => { caption = mountFigureCaptionEditor(host, { view: editor.view, getPos: () => 0, label: '图注', close: () => caption.destroy() }); });
    cleanups.push(() => caption.destroy());
    caption.editor.commands.setTextSelection({ from: 1, to: 8 }); caption.editor.view.dom.focus();
    const selection = caption.editor.state.selection, top = await toolbar(editor);
    const portal = document.body.appendChild(document.createElement('button')); portal.className = 'nb-highlight-menu';
    await act(async () => { portal.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); portal.focus(); });
    expect(caption.editor.state.selection.eq(selection)).toBe(true); expect(getEditingScope(editor.view)?.kind).toBe('tiptap');
    await click(top, '插入/编辑超链接');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });
    const input = host.querySelector<HTMLInputElement>('input[placeholder*="https"]')!;
    expect(input).not.toBeNull();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(input, 'https://example.com'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(caption.editor.getAttributes('link').href).toBe('https://example.com');
    expect(editor.state.doc.lastChild).toBe(body); expect(document.activeElement).toBe(caption.editor.view.dom);
  });

  it('isolates documents, blocks external scopes, and ignores stale disposal during replacement', async () => {
    const editor = parent(), other = parent(), body = editor.state.doc;
    const top = await toolbar(editor);
    let release!: () => void, replacement!: () => void;
    await act(async () => { release = registerExternalEditingScope(editor.view); replacement = registerExternalEditingScope(editor.view); });
    release(); expect(getEditingScope(editor.view)?.kind).toBe('external'); expect(getEditingScope(other.view)).toBeNull();
    for (const label of ['加粗', '无序列表', '插入/编辑超链接', '清除选中文本格式', '撤销', '重做']) {
      expect(top.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.disabled).toBe(true);
      await click(top, label);
    }
    expect(editor.state.doc).toBe(body);
    await act(async () => { editor.view.dom.focus(); });
    expect(getEditingScope(editor.view)).toBeNull();
    replacement();
    await act(async () => editor.commands.setTextSelection({ from: editor.state.doc.firstChild!.nodeSize + 1, to: editor.state.doc.content.size - 1 }));
    expect(top.querySelector<HTMLButtonElement>('button[aria-label="加粗"]')!.disabled).toBe(false);
    await click(top, '加粗'); expect(editor.isActive('bold')).toBe(true);
    expect(other.isActive('bold')).toBe(false);
  });
});
