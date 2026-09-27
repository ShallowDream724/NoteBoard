import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../../src/components/Tooltip';
import { CodeBlockView } from '../../src/features/editor-md/codeBlockView';
import { CodeHighlight } from '../../src/features/editor-md/codeHighlightExtension';
import type { CodeHighlightResult } from '../../src/features/editor-md/codeHighlighting';

const fixture = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../src/features/editor-md/codeHighlighting', () => ({ requestCodeHighlight: fixture.request }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); fixture.request.mockReset(); });

it('loads code asynchronously, scrolls to line 10,000 without focus, and keeps visible gutters independent of a pending worker', async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const frames = new Map<number, FrameRequestCallback>(); let sequence = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { const id = ++sequence; frames.set(id, callback); return id; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
  const source = Array.from({ length: 10_000 }, () => 'const value = 1;').join('\n');
  const lineLength = 17, lineHeight = 20;
  let codeTop = 600, resolve!: (result: CodeHighlightResult) => void;
  fixture.request.mockImplementation(() => new Promise<CodeHighlightResult>(done => { resolve = done; }));
  const host = document.createElement('div'); host.dataset.editorScroll = ''; document.body.appendChild(host);
  const bounds = (top: number, height: number) => ({ left: 0, right: 800, top, bottom: top + height, width: 800, height } as DOMRect);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this === host) return bounds(0, 400);
    if (this.matches('code, pre, .nb-code-block')) return bounds(codeTop, 10_000 * lineHeight);
    return bounds(0, 400);
  });
  const editor = new Editor({ extensions: [StarterKit.configure({ codeBlock: false }), CodeBlockView, CodeHighlight], content: '<p></p>' });
  vi.spyOn(editor.view, 'posAtCoords').mockImplementation(({ top }) => ({ pos: 1 + Math.min(9999, Math.max(0, Math.floor((top - codeTop) / lineHeight))) * lineLength, inside: 0 }));
  const root = createRoot(host);
  const flush = async () => { await act(async () => { await Promise.resolve(); for (const [id, callback] of [...frames]) { frames.delete(id); callback(16); } }); };
  try {
    await act(async () => root.render(<TooltipProvider><EditorContent editor={editor}/></TooltipProvider>));
    await act(async () => { editor.commands.setContent({ type: 'doc', content: [{ type: 'codeBlock', attrs: { language: 'javascript' }, content: [{ type: 'text', text: source }] }] }); });
    await flush();
    expect(host.querySelector('.nb-code-line-number')).toBeNull(); expect(fixture.request).not.toHaveBeenCalled();
    codeTop = -9980 * lineHeight; host.dispatchEvent(new Event('scroll')); await flush();
    expect(host.querySelectorAll('.nb-code-line-number').length).toBeLessThanOrEqual(400);
    expect([...host.querySelectorAll('.nb-code-line-number')].map(node => node.textContent)).toContain('10000');
    expect(host.querySelector<HTMLElement>('.nb-code-block')?.style.getPropertyValue('--nb-code-line-digits')).toBe('5');
    expect(host.querySelector('code .hljs-keyword')).toBeNull(); expect(fixture.request).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ status: 'ready', tokens: Array.from({ length: 10_000 }, (_, line) => ({ from: line * lineLength, to: line * lineLength + 5, className: 'hljs-keyword' })) }));
    await flush();
    expect(host.querySelectorAll('code .hljs-keyword').length).toBeGreaterThan(0);
    expect(host.querySelectorAll('code .hljs-keyword').length).toBeLessThanOrEqual(400);
    expect(editor.isFocused).toBe(false); expect(document.activeElement).toBe(document.body);
    expect(editor.state.doc.textContent).toBe(source);
    const chunks = [...host.querySelectorAll('[data-code-chunk]')];
    expect(new Set(chunks.map(node => node.getAttribute('data-code-chunk'))).size).toBe(25);
    codeTop = 600; host.dispatchEvent(new Event('scroll')); await flush(); await flush();
    expect(host.querySelector('.nb-code-line-number')).toBeNull(); expect(host.querySelector('.hljs-keyword')).toBeNull();
    // Keep bounded, semantically plain text runs offscreen, not thousands of
    // token/gutter nodes or an ever-recreated giant accessibility text node.
    expect(new Set([...host.querySelectorAll('[data-code-chunk]')].map(node => node.getAttribute('data-code-chunk'))).size).toBe(25);
    expect(editor.state.doc.textContent).toBe(source);
  } finally { await act(async () => { root.unmount(); editor.destroy(); }); host.remove(); }
});
