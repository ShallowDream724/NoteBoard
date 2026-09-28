import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TipTapEditor } from '@/features/editor-md/TipTapEditor';
import { useDocumentStore } from '@/stores/documentStore';
import { useWindowStore } from '@/stores/windowStore';
import { getMdTipTapEditor } from '@/features/editor-md/editorInstances';
import { clearAllDocumentHistories, undoDocumentHistory } from '@/features/history/documentHistory';
import { closeHistory } from '@tiptap/pm/history';
import { dispatchDiscreteEdit } from '@/features/editor-md/discreteEdit';
import { distributeTableColumns } from '@/features/editor-md/tablePresentationCommands';
import { moveTopLevelBlock } from '@/features/editor-md/blockReorder';
import { encodeNativeDocument } from '@/core/nativeDocument';
import { editFigureCaption } from '@/features/editor-md/figureCaptionCommands';
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
    const table = '<table><tr><td colwidth="80">A</td><td colwidth="160">B</td></tr><tr><td colwidth="80">C</td><td colwidth="160">D</td></tr></table><p>end</p>';
    await act(async () => { editor.commands.setContent(kind === 'noteboard' ? table : table.replace(/ colwidth="\d+"/g, '')); });
    const tableBefore = editor.state.doc;
    let tableAfter = tableBefore;
    if (kind === 'noteboard') {
      await act(async () => { editor.commands.setTextSelection(4); expect(distributeTableColumns(editor)).toBe(true); });
      tableAfter = editor.state.doc;
      await press('z'); expect(editor.state.doc.eq(tableBefore)).toBe(true);
      await press('y'); expect(editor.state.doc.eq(tableAfter)).toBe(true);
    }
    await act(async () => { expect(moveTopLevelBlock(editor.view, 0, editor.state.doc.content.size)).not.toBeNull(); });
    await press('z'); expect(editor.state.doc.eq(tableAfter)).toBe(true);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it('formula source, its creation and preceding text form one continuous document timeline', async () => {
  const key = 'untitled:formula-history';
  useDocumentStore.getState().upsertFromPayload({ key, displayName: 'formula.nb', dirPath: '', kind: 'noteboard', language: 'markdown', content: encodeNativeDocument({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Before' }] }] }), encoding: 'utf8', eol: 'lf', size: 0, mtime: 0, readonly: false });
  useWindowStore.getState().openTab({ key, displayName: 'formula.nb', path: null, kind: 'noteboard', language: 'markdown', isDirty: false, isPreview: false, viewMode: 'visual', externalStatus: null, isDetached: false });
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
  try {
    await act(async () => { root.render(<TipTapEditor docKey={key} />); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });
    const editor = getMdTipTapEditor(key)!;
    const initial = editor.state.doc;
    await act(async () => { dispatchDiscreteEdit(editor.view, editor.state.tr.insertText(' text', 7)); });
    const textOnly = editor.state.doc;
    await act(async () => { editor.chain().focus('end').insertContent({ type: 'mathBlock', attrs: { latex: '' } }).run(); });
    expect(editor.state.doc.childCount).toBeGreaterThan(1);
    await act(async () => { host.querySelector('.math-node')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
    const source = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="块公式源码"]')!;
    expect(source).not.toBeNull();
    source.focus();
    expect(document.activeElement).toBe(source);
    const formula = () => { let latex: string | undefined; editor.state.doc.descendants(node => { if (node.type.name === 'mathBlock') latex = node.attrs.latex; }); return latex; };
    const input = async (value: string) => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(source, value);
      source.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const press = async (keyName: string) => act(async () => {
      (host.querySelector('textarea[aria-label="块公式源码"]') ?? editor.view.dom).dispatchEvent(new KeyboardEvent('keydown', { key: keyName, ctrlKey: true, bubbles: true, cancelable: true }));
    });
    await input('a');
    await act(async () => { editor.view.dispatch(closeHistory(editor.state.tr)); });
    await input('ab');
    expect(document.activeElement).toBe(source);
    expect(formula()).toBe('ab');
    await press('z');
    expect(formula()).toBe('a');
    expect(host.querySelector('textarea')).toBe(source);
    expect(document.activeElement).toBe(source);
    await press('z');
    expect(formula()).toBe('');
    expect(host.querySelector('textarea')).toBe(source);
    await press('z');
    expect(editor.state.doc.eq(textOnly)).toBe(true);
    await press('z');
    expect(editor.state.doc.eq(initial)).toBe(true);
    for (let step = 0; step < 4; step++) await press('y');
    expect(formula()).toBe('ab');
    expect(editor.state.doc.child(0).textContent).toBe('Before text');
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it('caption input uses the same document timeline and retains its editor across metadata undo', async () => {
  const key = 'untitled:caption-history';
  const content = encodeNativeDocument({ type: 'doc', content: [{ type: 'table', attrs: { caption: 'Original' }, content: [
    { type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cell' }] }] }] },
  ] }, { type: 'paragraph', content: [{ type: 'text', text: 'Tail' }] }] });
  useDocumentStore.getState().upsertFromPayload({ key, displayName: 'caption.nb', dirPath: '', kind: 'noteboard', language: 'markdown', content, encoding: 'utf8', eol: 'lf', size: 0, mtime: 0, readonly: false });
  useWindowStore.getState().openTab({ key, displayName: 'caption.nb', path: null, kind: 'noteboard', language: 'markdown', isDirty: false, isPreview: false, viewMode: 'visual', externalStatus: null, isDetached: false });
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
  try {
    await act(async () => { root.render(<TooltipProvider><TipTapEditor docKey={key}/></TooltipProvider>); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });
    const editor = getMdTipTapEditor(key)!;
    await act(async () => { editFigureCaption(editor, 0); await vi.dynamicImportSettled(); });
    const input = host.querySelector<HTMLElement & { editor: import('@tiptap/core').Editor }>('.nb-caption-editor')!;
    const tableContent = editor.state.doc.firstChild!.content;
    await act(async () => { input.editor.commands.insertContent(' changed'); });
    expect(editor.state.doc.firstChild!.attrs.caption).toBe('Original changed');
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })); });
    expect(editor.state.doc.firstChild!.attrs.caption).toBe('Original');
    expect(editor.state.doc.firstChild!.content).toBe(tableContent);
    expect(host.querySelector('.nb-caption-editor')).toBe(input);
    expect(document.activeElement).toBe(input);
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true, cancelable: true })); });
    expect(editor.state.doc.firstChild!.attrs.caption).toBe('Original changed');
    expect(document.activeElement).toBe(input);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it.each(['codeBlock', 'disclosure', 'table'])('%s creation and its first input stay separate from preceding typing without command-specific markers', async kind => {
  const key = `untitled:container-history-${kind}`;
  const content = encodeNativeDocument({ type: 'doc', content: [{ type: 'paragraph' }] });
  useDocumentStore.getState().upsertFromPayload({ key, displayName: 'container.nb', dirPath: '', kind: 'noteboard', language: 'markdown', content, encoding: 'utf8', eol: 'lf', size: 0, mtime: 0, readonly: false });
  useWindowStore.getState().openTab({ key, displayName: 'container.nb', path: null, kind: 'noteboard', language: 'markdown', isDirty: false, isPreview: false, viewMode: 'visual', externalStatus: null, isDetached: false });
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
  try {
    await act(async () => { root.render(<TooltipProvider><TipTapEditor docKey={key}/></TooltipProvider>); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });
    const editor = getMdTipTapEditor(key)!, initial = editor.state.doc;
    await act(async () => { editor.commands.insertContent('Body'); });
    const body = editor.state.doc;
    const paragraph = { type: 'paragraph' };
    const node = kind === 'table' ? { type: kind, content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph] }] }] }
      : kind === 'disclosure' ? { type: kind, content: [paragraph] } : { type: kind, attrs: { language: 'text' } };
    await act(async () => { editor.commands.insertContentAt(editor.state.doc.content.size, node); });
    const created = editor.state.doc;
    let input = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== kind) return;
      if (node.isTextblock) input = pos + 1;
      else node.descendants((child, offset) => { if (!input && child.isTextblock) input = pos + offset + 2; return !input; });
      return false;
    });
    expect(input).toBeGreaterThan(0);
    await act(async () => { editor.commands.setTextSelection(input); editor.commands.insertContent('Inside'); });
    const typed = editor.state.doc;
    const press = async (keyName: string) => act(async () => { editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, ctrlKey: true, bubbles: true, cancelable: true })); });
    for (const expected of [created, body, initial]) { await press('z'); expect(editor.state.doc.toJSON()).toEqual(expected.toJSON()); }
    for (const expected of [body, created, typed]) { await press('y'); expect(editor.state.doc.toJSON()).toEqual(expected.toJSON()); }
  } finally { await act(async () => root.unmount()); host.remove(); }
});
