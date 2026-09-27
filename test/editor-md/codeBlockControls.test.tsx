import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../../src/components/Tooltip';
import { CodeBlockView } from '../../src/features/editor-md/codeBlockView';
import { withRichPresentation } from '../../src/features/editor-md/rich-content/presentedView';
import { moveTopLevelBlock } from '../../src/features/editor-md/blockReorder';

const fixture = vi.hoisted(() => ({ observers: new Map<HTMLElement, (near: boolean) => void>() }));
vi.mock('../../src/features/editor-md/codeVisibility', () => ({ observeCodeVisibility: (_editor: HTMLElement, element: HTMLElement, callback: (sample: { visible: boolean; viewport: { top: number; bottom: number; left: number; right: number } }) => void) => {
  const notify = (visible: boolean) => callback({ visible, viewport: { top: 0, bottom: 800, left: 0, right: 1000 } });
  fixture.observers.set(element, notify); notify(true);
  return () => fixture.observers.delete(element);
} }));
vi.mock('../../src/features/editor-md/codeHighlightExtension', () => ({ useCodeHighlight: () => {} }));
afterEach(() => { vi.useRealTimers(); fixture.observers.clear(); vi.restoreAllMocks(); });

const source = 'def greet(name):\n    if name:\n        return name\n    return "hello"\n\nprint(greet("world"))';
async function mount() {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  const editor = new Editor({ extensions: [StarterKit.configure({ codeBlock: false }), withRichPresentation(CodeBlockView)],
    content: { type: 'doc', content: [{ type: 'codeBlock', attrs: { language: 'python' }, content: [{ type: 'text', text: source }] }] } });
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
  await act(async () => root.render(<TooltipProvider><EditorContent editor={editor}/></TooltipProvider>));
  await act(async () => { await vi.advanceTimersByTimeAsync(45); });
  return { editor, host,
    click: async (selector: string) => { const element = host.querySelector<HTMLButtonElement>(selector); expect(element).not.toBeNull(); await act(async () => element!.click()); },
    near: async (near: boolean) => { await act(async () => { fixture.observers.forEach(callback => callback(near)); await vi.advanceTimersByTimeAsync(45); }); },
    destroy: async () => { await act(async () => { root.unmount(); editor.destroy(); }); host.remove(); },
  };
}

it('wraps and collapses without changing saved source; copy includes hidden lines', async () => {
  const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
  const mounted = await mount();
  try {
    const before = mounted.editor.getJSON();
    expect([...mounted.host.querySelectorAll('.nb-code-line-number')].map(el => el.textContent)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(mounted.host.querySelector('.nb-code-block')?.getAttribute('data-wrap')).toBe('true');
    expect(mounted.host.querySelector('[aria-label="自动换行"]')?.getAttribute('aria-pressed')).toBe('true');
    await mounted.click('[aria-label="自动换行"]');
    expect(mounted.host.querySelector('.nb-code-block')?.getAttribute('data-wrap')).toBe('false');
    await mounted.click('[aria-label="折叠第 1 行代码"]');
    expect(mounted.host.querySelector('.nb-code-fold-hidden')).not.toBeNull();
    expect([...mounted.host.querySelectorAll('.nb-code-line-number')].map(el => el.textContent)).toEqual(['1', '5', '6']);
    await mounted.click('[aria-label="折叠代码块"]');
    expect(mounted.host.querySelector('pre')?.hidden).toBe(true);
    await mounted.click('[aria-label="复制代码内容"]');
    expect(clipboard.writeText).toHaveBeenCalledWith(source);
    expect(mounted.editor.getJSON()).toEqual(before);
    await mounted.click('[aria-label="展开代码块"]');
    await mounted.click('.nb-code-fold-summary');
    expect(mounted.host.querySelector('.nb-code-fold-hidden')).toBeNull();
  } finally { await mounted.destroy(); }
});

it('parks a caret before folding, reveals selection targets, and never hides newly edited text', async () => {
  const mounted = await mount();
  try {
    const inside = source.indexOf('return name') + 1;
    await act(async () => { mounted.editor.commands.setTextSelection(inside); });
    await mounted.click('[aria-label="折叠第 1 行代码"]');
    expect(mounted.editor.state.selection.from).toBe(source.indexOf('\n') + 1);
    expect(mounted.host.querySelector('.nb-code-fold-hidden')).not.toBeNull();
    await act(async () => { mounted.editor.commands.setTextSelection(inside); });
    expect(mounted.host.querySelector('.nb-code-fold-hidden')).toBeNull();
    await mounted.click('[aria-label="折叠第 1 行代码"]');
    await act(async () => { mounted.editor.view.dispatch(mounted.editor.state.tr.insertText('new_', inside)); });
    expect(mounted.host.querySelector('.nb-code-fold-hidden')).toBeNull();
    expect(mounted.editor.state.doc.textContent).toContain('new_return name');
    await mounted.click('[aria-label="折叠代码块"]');
    await act(async () => { mounted.editor.commands.setTextSelection(inside + 2); });
    expect(mounted.host.querySelector('pre')?.hidden).toBe(false);
  } finally { await mounted.destroy(); }
});

it('unloads offscreen gutters while preserving folded height and restores nested controls on return', async () => {
  const mounted = await mount();
  try {
    await mounted.click('[aria-label="折叠第 2 行代码"]');
    await mounted.click('[aria-label="折叠第 1 行代码"]');
    await mounted.near(false);
    expect(mounted.host.querySelector('.nb-code-line-gutter')).toBeNull();
    expect(mounted.host.querySelector('.nb-code-fold-hidden')).not.toBeNull();
    await mounted.near(true);
    expect(mounted.host.querySelector('.nb-code-line-gutter')).not.toBeNull();
    await mounted.click('.nb-code-fold-summary');
    expect(mounted.host.querySelector('.nb-code-fold-summary')?.getAttribute('aria-label')).toBe('展开第 2 行代码');
    expect(mounted.editor.state.doc.textContent).toBe(source);
  } finally { await mounted.destroy(); }
});

it('retains function folds and whole-block presentation when dragging remounts its NodeView', async () => {
  const mounted = await mount();
  try {
    const paragraph = mounted.editor.schema.nodes.paragraph.create(null, mounted.editor.schema.text('before'));
    await act(async () => { mounted.editor.view.dispatch(mounted.editor.state.tr.insert(0, paragraph)); });
    await mounted.click('[aria-label="折叠第 1 行代码"]');
    await mounted.click('[aria-label="自动换行"]');
    await mounted.click('[aria-label="折叠代码块"]');
    await act(async () => { expect(moveTopLevelBlock(mounted.editor.view, paragraph.nodeSize, 0)).not.toBeNull(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(45); });
    expect(mounted.host.querySelector('.nb-code-block')?.getAttribute('data-collapsed')).toBe('true');
    expect(mounted.host.querySelector('.nb-code-block')?.getAttribute('data-wrap')).toBe('false');
    await mounted.click('[aria-label="展开代码块"]');
    await act(async () => { await vi.advanceTimersByTimeAsync(45); });
    expect(mounted.host.querySelector('.nb-code-fold-summary')).not.toBeNull();
    expect(mounted.host.querySelector('.nb-code-line-gutter')).not.toBeNull();
  } finally { await mounted.destroy(); }
});
