import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TipTapEditor } from '@/features/editor-md/TipTapEditor';
import { useDocumentStore } from '@/stores/documentStore';
import { useWindowStore } from '@/stores/windowStore';
import { getMdTipTapEditor } from '@/features/editor-md/editorInstances';
import { clearAllDocumentHistories, undoDocumentHistory } from '@/features/history/documentHistory';
import { dispatchDiscreteEdit } from '@/features/editor-md/discreteEdit';
import { distributeTableColumns } from '@/features/editor-md/tablePresentationCommands';
import { moveTopLevelBlock } from '@/features/editor-md/blockReorder';
import { encodeNativeDocument } from '@/core/nativeDocument';

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
  useDocumentStore.setState({ documents: new Map() });
  useWindowStore.setState({ tabs: [], activeKey: null, transferringKeys: [] });
  clearAllDocumentHistories();
});
afterEach(() => vi.restoreAllMocks());

it.each(['markdown', 'noteboard'] as const)('physical Ctrl+Z uses the shared %s timeline for text, table dimensions and block moves', async kind => {
  const key = 'untitled:keyboard-history';
  const content = kind === 'markdown' ? 'before' : encodeNativeDocument({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'before' }] }] });
  useDocumentStore.getState().upsertFromPayload({ key, displayName: 'history.md', dirPath: '', kind, language: 'markdown', content, encoding: 'utf8', eol: 'lf', size: 0, mtime: 0, readonly: false });
  useWindowStore.getState().openTab({ key, displayName: 'history.md', path: null, kind, language: 'markdown', isDirty: false, isPreview: false, viewMode: 'visual', externalStatus: null, isDetached: false });
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
  try {
    await act(async () => { root.render(<TipTapEditor docKey={key} />); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });
    const editor = getMdTipTapEditor(key)!;
    const initial = editor.state.doc;
    await act(async () => { dispatchDiscreteEdit(editor.view, editor.state.tr.insertText(' after', 7)); });
    const changed = editor.state.doc;
    expect(changed.eq(initial)).toBe(false);
    const press = async (keyName: string, shiftKey = false) => act(async () => {
      editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, ctrlKey: true, shiftKey, bubbles: true, cancelable: true }));
    });
    await press('z');
    expect(editor.state.doc.eq(initial)).toBe(true);
    await press('y');
    expect(editor.state.doc.eq(changed)).toBe(true);
    await act(async () => { expect(undoDocumentHistory(key)).toBe(true); });
    expect(editor.state.doc.eq(initial)).toBe(true);
    await press('Z', true);
    expect(editor.state.doc.eq(changed)).toBe(true);
    await act(async () => { editor.commands.setContent('<table><tr><td colwidth="80">A</td><td colwidth="160">B</td></tr><tr><td colwidth="80">C</td><td colwidth="160">D</td></tr></table><p>end</p>'); });
    const tableBefore = editor.state.doc;
    await act(async () => { editor.commands.setTextSelection(4); expect(distributeTableColumns(editor)).toBe(true); });
    const tableAfter = editor.state.doc;
    await press('z'); expect(editor.state.doc.eq(tableBefore)).toBe(true);
    await press('y'); expect(editor.state.doc.eq(tableAfter)).toBe(true);
    await act(async () => { expect(moveTopLevelBlock(editor.view, 0, editor.state.doc.content.size)).not.toBeNull(); });
    await press('z'); expect(editor.state.doc.eq(tableAfter)).toBe(true);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
