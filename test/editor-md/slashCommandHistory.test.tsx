import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';
import { TipTapEditor } from '@/features/editor-md/TipTapEditor';
import { useDocumentStore } from '@/stores/documentStore';
import { useWindowStore } from '@/stores/windowStore';
import { getMdTipTapEditor } from '@/features/editor-md/editorInstances';
import { clearAllDocumentHistories } from '@/features/history/documentHistory';
import { TooltipProvider } from '@/components/Tooltip';

vi.mock('@/features/editor-md/bubbleMenu', () => ({ EditorBubbleMenu: () => null, TableToolbar: () => null }));
vi.mock('@/features/editor-md/blockDragHandle', () => ({ BlockDragHandle: () => null }));
vi.mock('@/features/editor-md/EditorContextMenu', () => ({ EditorContextMenu: () => null }));
vi.mock('@/features/editor-md/LinkModal', () => ({ LinkModal: () => null }));
vi.mock('@/features/editor-md/MarkdownModeToggle', () => ({ MarkdownModeToggle: () => null }));
vi.mock('@/features/editor-md/ExternalChangeBanner', () => ({ ExternalChangeBanner: () => null }));
vi.mock('@/features/editor-md/imagePaste', () => ({ handlePastedImageFile: vi.fn() }));
vi.mock('@/features/editor-md/markdownAutoSave', () => ({ autoSaveDocument: vi.fn() }));

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  useDocumentStore.setState({ documents: new Map() });
  useWindowStore.setState({ tabs: [], activeKey: null, transferringKeys: [] });
  clearAllDocumentHistories();
});

it('a slash command undoes as one action, redoes exactly, and leaves no menu on history navigation', async () => {
  const key = 'untitled:slash-command-history';
  useDocumentStore.getState().upsertFromPayload({ key, displayName: 'slash.nb', dirPath: '', kind: 'noteboard', language: 'markdown', content: '', encoding: 'utf8', eol: 'lf', size: 0, mtime: 0, readonly: false });
  useWindowStore.getState().openTab({ key, displayName: 'slash.nb', path: null, kind: 'noteboard', language: 'markdown', isDirty: false, isPreview: false, viewMode: 'visual', externalStatus: null, isDetached: false });
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
  try {
    await act(async () => { root.render(<TooltipProvider><TipTapEditor docKey={key} /></TooltipProvider>); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });
    const editor = getMdTipTapEditor(key)!;
    await act(async () => { editor.commands.insertContent('Body '); });
    const before = editor.state.doc.toJSON();
    await act(async () => { editor.commands.insertContent('/'); });
    await act(async () => { editor.commands.insertContent('h1'); });
    expect(document.body.textContent).toContain('一级标题 (H1)');
    const command = [...document.body.querySelectorAll('button')].find(button => button.getAttribute('aria-label')?.startsWith('一级标题 (H1)'))!;
    expect(command).toBeTruthy();
    await act(async () => { command.click(); });
    const after = editor.state.doc.toJSON();
    expect(after).not.toEqual(before);
    expect(editor.state.doc.firstChild?.type.name).toBe('heading');
    expect(document.body.textContent).not.toContain('搜索 · h1');
    const press = async (keyName: string) => act(async () => {
      editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, ctrlKey: true, bubbles: true, cancelable: true }));
    });
    await press('z');
    expect(editor.state.doc.toJSON()).toEqual(before);
    expect(document.body.textContent).not.toContain('插入内容');
    await press('y');
    expect(editor.state.doc.toJSON()).toEqual(after);
    expect(document.body.textContent).not.toContain('插入内容');
    await press('z');
    await act(async () => { editor.commands.insertContent('again'); });
    expect(editor.state.doc.textContent).toContain('again');
    expect(document.body.textContent).not.toContain('插入内容');
    await act(async () => { editor.commands.insertContent(' /'); });
    expect(document.querySelector('button[aria-label^="清除格式"]')).toBeTruthy();
    await act(async () => { editor.commands.insertContent('clear'); });
    expect(document.querySelector('button[aria-label^="清除格式"]')).toBeTruthy();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
