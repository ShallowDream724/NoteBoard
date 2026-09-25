import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { afterEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../../src/components/Tooltip';
import { CodeBlockView } from '../../src/features/editor-md/codeBlockView';
import { CodeHighlight } from '../../src/features/editor-md/codeHighlightExtension';

vi.mock('../../src/features/editor-md/nearViewport', () => ({ observeNearby: (_element: HTMLElement, callback: (near: boolean) => void) => { callback(true); return () => {}; } }));
vi.mock('../../src/features/editor-md/codeHighlighting', () => ({ highlightCode: async () => [{ from: 0, to: 3, className: 'hljs-keyword' }] }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

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
