import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/Tooltip';
import { TipTapEditor } from '@/features/editor-md/TipTapEditor';
import { getMdTipTapEditor } from '@/features/editor-md/editorInstances';
import { DEFAULT_MERMAID_CODE } from '@/features/editor-md/insertContentRecipes';
import { markMermaidCreation } from '@/features/editor-md/mermaidCreation';
import { encodeNativeDocument, type NativeNode } from '@/core/nativeDocument';
import { clearAllDocumentHistories } from '@/features/history/documentHistory';
import { useDocumentStore } from '@/stores/documentStore';
import { useWindowStore } from '@/stores/windowStore';

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

async function mount(key: string, blocks: NativeNode[]) {
  useDocumentStore.getState().upsertFromPayload({ key, displayName: 'history.nb', dirPath: '', kind: 'noteboard', language: 'markdown',
    content: encodeNativeDocument({ type: 'doc', content: blocks }), encoding: 'utf8', eol: 'lf', size: 0, mtime: 0, readonly: false });
  useWindowStore.getState().openTab({ key, displayName: 'history.nb', path: null, kind: 'noteboard', language: 'markdown',
    isDirty: false, isPreview: false, viewMode: 'visual', externalStatus: null, isDetached: false });
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(<TooltipProvider><TipTapEditor docKey={key}/></TooltipProvider>); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });
  const editor = getMdTipTapEditor(key)!;
  return { host, editor, destroy: async () => { await act(async () => root.unmount()); host.remove(); } };
}

async function press(target: Element, key: string) {
  await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true })); });
}

async function input(source: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(source, value);
    source.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('routes code content shortcuts through the shared history after typing', async () => {
  const mounted = await mount('untitled:code-source-history', [{ type: 'paragraph', content: [{ type: 'text', text: 'Before' }] }]);
  try {
    const { editor, host } = mounted;
    await act(async () => { editor.commands.insertContent(' text'); });
    const textOnly = editor.state.doc;
    await act(async () => { editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'codeBlock', attrs: { language: 'text' } }); });
    const created = editor.state.doc;
    let codePos = 0;
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'codeBlock') { codePos = pos; return false; } });
    await act(async () => { editor.commands.setTextSelection(codePos + 1); editor.commands.insertContent('AAA'); });
    const source = host.querySelector('.nb-code-block-content code')!;
    expect(source.textContent).toBe('AAA');
    await press(source, 'z');
    expect(editor.state.doc.toJSON()).toEqual(created.toJSON());
    await press(host.querySelector('.nb-code-block-content code')!, 'z');
    expect(editor.state.doc.toJSON()).toEqual(textOnly.toJSON());
  } finally { await mounted.destroy(); }
});

it('autoopens a new Mermaid template and steps through source, edit mode, creation and earlier text', async () => {
  const mounted = await mount('untitled:mermaid-source-history', [{ type: 'paragraph', content: [{ type: 'text', text: 'Before' }] }]);
  try {
    const { editor, host } = mounted;
    const initial = editor.state.doc;
    await act(async () => { editor.commands.insertContent(' text'); });
    const textOnly = editor.state.doc;
    await act(async () => { editor.chain().focus('end').command(({ tr }) => { markMermaidCreation(tr); return true; }).insertContent({ type: 'mermaidBlock', attrs: { code: DEFAULT_MERMAID_CODE } }).run(); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
    const created = editor.state.doc;
    const source = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Mermaid 图表源码"]')!;
    expect(source).not.toBeNull();
    expect(document.activeElement).toBe(source);
    for (const suffix of ['A', 'AA', 'AAA']) await input(source, `${DEFAULT_MERMAID_CODE}${suffix}`);
    expect(editor.state.doc.child(1).attrs.code).toBe(`${DEFAULT_MERMAID_CODE}AAA`);
    await press(source, 'z');
    expect(editor.state.doc.toJSON()).toEqual(created.toJSON());
    expect(host.querySelector('textarea[aria-label="Mermaid 图表源码"]')).toBe(source);
    await press(source, 'z');
    expect(editor.state.doc.toJSON()).toEqual(created.toJSON());
    expect(host.querySelector('textarea[aria-label="Mermaid 图表源码"]')).toBeNull();
    await press(editor.view.dom, 'z');
    expect(editor.state.doc.toJSON()).toEqual(textOnly.toJSON());
    await press(editor.view.dom, 'z');
    expect(editor.state.doc.toJSON()).toEqual(initial.toJSON());
  } finally { await mounted.destroy(); }
});

it('continues into preceding document history after an existing Mermaid source returns to its original value', async () => {
  const originalCode = DEFAULT_MERMAID_CODE;
  const mounted = await mount('untitled:existing-mermaid-history', [
    { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
    { type: 'mermaidBlock', attrs: { code: originalCode } },
  ]);
  try {
    const { editor, host } = mounted;
    const original = editor.state.doc;
    expect(host.querySelector('textarea[aria-label="Mermaid 图表源码"]')).toBeNull();
    await act(async () => { editor.commands.insertContentAt(7, ' text'); });
    const textOnly = editor.state.doc;
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="编辑图表源码"]')!.click(); });
    const source = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Mermaid 图表源码"]')!;
    await input(source, `${originalCode}AAA`);
    await press(source, 'z');
    expect(editor.state.doc.toJSON()).toEqual(textOnly.toJSON());
    expect(host.querySelector('textarea[aria-label="Mermaid 图表源码"]')).toBe(source);
    await press(source, 'z');
    expect(editor.state.doc.toJSON()).toEqual(textOnly.toJSON());
    expect(host.querySelector('textarea[aria-label="Mermaid 图表源码"]')).toBeNull();
    await press(editor.view.dom, 'z');
    expect(editor.state.doc.toJSON()).toEqual(original.toJSON());
  } finally { await mounted.destroy(); }
});

it('commits Mermaid IME text once after composition ends and undoes it as one document edit', async () => {
  const original = 'graph TD\n  A --> B';
  const mounted = await mount('untitled:mermaid-ime-history', [
    { type: 'paragraph' }, { type: 'mermaidBlock', attrs: { code: original } },
  ]);
  try {
    const { editor, host } = mounted;
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="编辑图表源码"]')!.click(); });
    const source = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Mermaid 图表源码"]')!;
    await act(async () => {
      source.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '中' }));
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(source, `${original}中`);
      source.dispatchEvent(new InputEvent('input', { bubbles: true, data: '中', isComposing: true }));
    });
    expect(editor.state.doc.child(1).attrs.code).toBe(original);
    await act(async () => { source.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中' })); });
    expect(editor.state.doc.child(1).attrs.code).toBe(`${original}中`);
    await press(source, 'z');
    expect(editor.state.doc.child(1).attrs.code).toBe(original);
  } finally { await mounted.destroy(); }
});
