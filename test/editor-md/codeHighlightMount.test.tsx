import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../../src/components/Tooltip';
import { CodeBlockView } from '../../src/features/editor-md/codeBlockView';
import { CodeHighlight } from '../../src/features/editor-md/codeHighlightExtension';
import type { CodeHighlightResult } from '../../src/features/editor-md/codeHighlighting';
import { moveTopLevelBlock } from '../../src/features/editor-md/blockReorder';
import { ImageNode, MathInlineNode, MathBlockNode } from '../../src/features/editor-md/documentNodes';
import { initializeEditorDocument, serializeEditorDocument, serializeNativeNode, parseEditorDocument } from '../../src/features/editor-md/editorDocumentCodec';

const fixture = vi.hoisted(() => ({ observers: new Map<HTMLElement, (near: boolean) => void>(), immediate: true, request: vi.fn() }));
vi.mock('../../src/features/editor-md/codeVisibility', () => ({ observeCodeVisibility: (_editor: HTMLElement, element: HTMLElement, callback: (sample: { visible: boolean; viewport: { top: number; bottom: number; left: number; right: number } }) => void) => {
  const notify = (visible: boolean) => callback({ visible, viewport: { top: 0, bottom: 800, left: 0, right: 1000 } });
  fixture.observers.set(element, notify);
  if (fixture.immediate) notify(true);
  return () => fixture.observers.delete(element);
} }));
vi.mock('../../src/features/editor-md/codeHighlighting', () => ({ requestCodeHighlight: fixture.request }));
const ready: CodeHighlightResult = { status: 'ready', tokens: [{ from: 0, to: 3, className: 'hljs-keyword' }] };
beforeEach(() => {
  fixture.observers.clear(); fixture.immediate = true; fixture.request.mockReset(); fixture.request.mockResolvedValue(ready);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

async function mount() {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  const frames = new Map<number, FrameRequestCallback>(); let sequence = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = ++sequence; frames.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const editor = new Editor({ extensions: [StarterKit.configure({ codeBlock: false }), CodeBlockView, CodeHighlight, ImageNode, MathInlineNode, MathBlockNode],
    content: { type: 'doc', content: [{ type: 'codeBlock', attrs: { language: 'python' }, content: [{ type: 'text', text: 'def greet(name):\n    return name' }] }] } });
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
  await act(async () => root.render(<TooltipProvider><EditorContent editor={editor}/></TooltipProvider>));
  return {
    editor, host, frames,
    tick: async (milliseconds = 45) => { await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); }); },
    flush: async () => { await act(async () => { for (const [id, callback] of [...frames]) { frames.delete(id); callback(16); } }); },
    nearby: async (near: boolean) => { await act(async () => { fixture.observers.forEach(callback => callback(near)); }); },
    destroy: async () => { await act(async () => { root.unmount(); editor.destroy(); }); host.remove(); },
  };
}

it('keeps the first Python tokens when another UI plugin mounts before their batched frame', async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  const frames = new Map<number, FrameRequestCallback>(); let sequence = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = ++sequence; frames.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const editor = new Editor({ extensions: [StarterKit.configure({ codeBlock: false }), CodeBlockView, CodeHighlight],
    content: { type: 'doc', content: [{ type: 'codeBlock', attrs: { language: 'python' }, content: [{ type: 'text', text: 'def greet(name):\n    return name' }] }] } });
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<TooltipProvider><EditorContent editor={editor}/></TooltipProvider>));
    await act(async () => { await vi.advanceTimersByTimeAsync(45); });
    expect(frames.size).toBeGreaterThan(0);
    // Bubble/embedded UI registers plugins after node views have already mounted.
    // ProseMirror recreates every plugin view but preserves their state fields.
    await act(async () => { editor.registerPlugin(new Plugin({ key: new PluginKey('late-ui') })); });
    await act(async () => { for (const [id, callback] of [...frames]) { frames.delete(id); callback(16); } });
    expect(host.querySelector('code .hljs-keyword')?.textContent).toBe('def');
    await act(async () => { editor.view.dispatch(editor.state.tr.insertText('x', 5)); });
    await act(async () => { await vi.advanceTimersByTimeAsync(45); });
    expect(frames.size).toBeGreaterThan(0);
    await act(async () => editor.destroy());
    expect(frames.size).toBe(0);
  } finally { await act(async () => root.unmount()); editor.destroy(); host.remove(); }
});

it('retries a transient failure for an unchanged visible Python node', async () => {
  fixture.request.mockResolvedValueOnce({ status: 'unavailable', tokens: [] });
  const mounted = await mount();
  try {
    await mounted.tick(); await mounted.flush();
    expect(mounted.host.querySelector('code .hljs-keyword')).toBeNull();
    await mounted.tick(250); await mounted.flush();
    expect(mounted.host.querySelector('code .hljs-keyword')?.textContent).toBe('def');
    expect(fixture.request).toHaveBeenCalledTimes(2);
  } finally { await mounted.destroy(); }
});

it('recovers an unchanged visible block after a longer worker outage and stops retries offscreen', async () => {
  fixture.request.mockReset();
  for (let i = 0; i < 4; i++) fixture.request.mockResolvedValueOnce({ status: 'unavailable', tokens: [] });
  fixture.request.mockResolvedValue(ready);
  const mounted = await mount();
  try {
    await mounted.tick(); await mounted.tick(250); await mounted.tick(1000); await mounted.tick(4000);
    expect(mounted.host.querySelector('code .hljs-keyword')).toBeNull();
    await mounted.tick(15000); await mounted.flush();
    expect(mounted.host.querySelector('code .hljs-keyword')?.textContent).toBe('def');
    expect(fixture.request).toHaveBeenCalledTimes(5);
    await mounted.nearby(false); await mounted.tick(30000); await mounted.flush();
    expect(fixture.request).toHaveBeenCalledTimes(5);
  } finally { await mounted.destroy(); }
});

it('cancels a pending colored batch when a block leaves nearby, then restores colors on reentry', async () => {
  const mounted = await mount();
  try {
    await mounted.tick();
    expect(mounted.frames.size).toBeGreaterThan(0);
    await mounted.nearby(false); await mounted.tick(1); await mounted.flush();
    expect(mounted.host.querySelector('code .hljs-keyword')).toBeNull();
    await mounted.nearby(true); await mounted.tick(); await mounted.flush();
    expect(mounted.host.querySelector('code .hljs-keyword')?.textContent).toBe('def');
    await mounted.nearby(false); await mounted.tick(1); await mounted.flush();
    expect(mounted.host.querySelector('code .hljs-keyword')).toBeNull();
  } finally { await mounted.destroy(); }
});

it('publishes an async result at the current position after editing before the code block', async () => {
  let resolve!: (result: CodeHighlightResult) => void;
  fixture.request.mockImplementationOnce(() => new Promise<CodeHighlightResult>(done => { resolve = done; }));
  const mounted = await mount();
  try {
    await mounted.tick();
    await act(async () => { mounted.editor.view.dispatch(mounted.editor.state.tr.insert(0, mounted.editor.schema.nodes.paragraph.create(null, mounted.editor.schema.text('before')))); });
    await act(async () => resolve(ready));
    await mounted.flush();
    expect(mounted.host.querySelector('p')?.textContent).toBe('before');
    expect(mounted.host.querySelector('code .hljs-keyword')?.textContent).toBe('def');
  } finally { await mounted.destroy(); }
});

it('preserves surviving colors while a remounted NodeView awaits its first observer result', async () => {
  const mounted = await mount();
  try {
    await mounted.tick(); await mounted.flush();
    expect(mounted.host.querySelector('code .hljs-keyword')?.textContent).toBe('def');
    fixture.immediate = false;
    const original = mounted.editor.view.props.nodeViews!.codeBlock;
    await act(async () => { mounted.editor.view.setProps({ nodeViews: { ...mounted.editor.view.props.nodeViews, codeBlock: (...args) => original(...args) } }); });
    await mounted.tick(); await mounted.flush();
    expect(mounted.host.querySelector('code .hljs-keyword')?.textContent).toBe('def');
    await mounted.nearby(false); await mounted.tick(1); await mounted.flush();
    expect(mounted.host.querySelector('code .hljs-keyword')).toBeNull();
    await mounted.nearby(true); await mounted.tick(); await mounted.flush();
    expect(mounted.host.querySelector('code .hljs-keyword')?.textContent).toBe('def');
  } finally { await mounted.destroy(); }
});

it('transports ready syntax tokens during a drag and republishes after the moved view mounts', async () => {
  const mounted = await mount();
  try {
    const paragraph = mounted.editor.schema.nodes.paragraph.create(null, mounted.editor.schema.text('before'));
    await act(async () => { mounted.editor.view.dispatch(mounted.editor.state.tr.insert(0, paragraph)); });
    await mounted.tick(); await mounted.flush();
    expect(mounted.host.querySelector('code .hljs-keyword')?.textContent).toBe('def');
    fixture.immediate = false;
    await act(async () => { expect(moveTopLevelBlock(mounted.editor.view, paragraph.nodeSize, 0)).not.toBeNull(); });
    expect(mounted.host.querySelectorAll('code .hljs-keyword')).toHaveLength(1);
    expect(mounted.host.querySelector('code .hljs-keyword')?.textContent).toBe('def');
    await mounted.nearby(true); await mounted.tick(); await mounted.flush();
    expect(mounted.host.querySelectorAll('code .hljs-keyword')).toHaveLength(1);
    expect(mounted.host.querySelector('.nb-code-line-gutter')).not.toBeNull();
  } finally { await mounted.destroy(); }
});

it.each(['image', 'mathBlock', 'mathInline'])('keeps code colors and its DOM immediately when undo restores a deleted %s', async type => {
  const mounted = await mount();
  try {
    const { editor, host } = mounted;
    const atom = editor.schema.nodes[type].create(type === 'image' ? { src: 'example.png' } : { latex: 'a+b' });
    const block = type === 'mathInline' ? editor.schema.nodes.paragraph.create(null, [editor.schema.text('Before '), atom, editor.schema.text(' after')]) : atom;
    await act(async () => editor.view.dispatch(editor.state.tr.insert(0, block)));
    initializeEditorDocument(editor, serializeNativeNode(editor.state.doc), 'noteboard');
    const before = serializeEditorDocument(editor);
    await mounted.tick(); await mounted.flush();
    const codeNode = editor.state.doc.lastChild;
    expect(host.querySelector('code .hljs-keyword')?.textContent).toBe('def');
    const position = type === 'mathInline' ? 8 : 0;
    await act(async () => editor.view.dispatch(editor.state.tr.delete(position, position + atom.nodeSize)));
    const code = host.querySelector('code'), keyword = host.querySelector('code .hljs-keyword');
    const deleted = serializeEditorDocument(editor);
    const requests = fixture.request.mock.calls.length;
    await act(async () => parseEditorDocument(editor, before, 'history'));
    expect(host.querySelector('code')).toBe(code);
    expect(host.querySelector('code .hljs-keyword')).toBe(keyword);
    expect(editor.state.doc.lastChild).toBe(codeNode);
    expect(serializeEditorDocument(editor)).toBe(before);
    expect(fixture.request).toHaveBeenCalledTimes(requests);
    await act(async () => parseEditorDocument(editor, deleted, 'history'));
    expect(host.querySelector('code .hljs-keyword')?.textContent).toBe('def');
    expect(editor.state.doc.lastChild).toBe(codeNode);
  } finally { await mounted.destroy(); }
});

it('renders one language name in each picker option', async () => {
  const previousScroll = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const mounted = await mount();
  try {
    await act(async () => { Array.from(mounted.host.querySelectorAll('span')).find(span => span.textContent === 'Python')!.parentElement!.click(); });
    expect(Array.from(mounted.host.querySelectorAll('button')).find(button => button.textContent?.includes('Python'))?.textContent).toBe('Python');
    expect(Array.from(mounted.host.querySelectorAll('button')).find(button => button.textContent?.includes('PowerShell'))?.textContent).toBe('PowerShell');
  } finally { await mounted.destroy(); HTMLElement.prototype.scrollIntoView = previousScroll; }
});
