import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/Tooltip';
import { MermaidBlock } from '@/features/editor-md/mermaidExtension';

vi.mock('@/features/editor-md/viewportActivation', () => ({ observe: (_element: HTMLElement, callback: () => void) => { callback(); return () => {}; } }));
vi.mock('@/features/editor-md/viewportWorkScheduler', () => ({ scheduleTask: (_id: string, task: () => unknown) => { void task(); }, cancelTask: () => {} }));
vi.mock('@/features/diagram-preview/mermaidRenderer', () => ({ renderMermaidSvg: async () => '<svg xmlns="http://www.w3.org/2000/svg"/>', resetMermaidRenderer: () => {} }));
vi.mock('@/features/diagram-preview/SvgDiagramViewport', () => ({ SvgDiagramViewport: ({ fullscreen }: { fullscreen?: boolean }) =>
  <div data-testid={fullscreen ? 'fullscreen-viewport' : 'inline-viewport'}><svg data-testid="diagram-svg"/></div> }));
vi.mock('@/features/export/ChartExportMenu', () => ({ ChartExportMenu: () => null }));

it('closes fullscreen Mermaid preview on empty backdrop while keeping diagram clicks inside', async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const editor = new Editor({ extensions: [StarterKit, MermaidBlock], content: { type: 'doc', content: [
    { type: 'mermaidBlock', attrs: { code: 'graph TD\n  A --> B' } },
  ] } });
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<TooltipProvider><EditorContent editor={editor}/></TooltipProvider>); });
    await act(async () => { await Promise.resolve(); });
    const open = host.querySelector<HTMLButtonElement>('[aria-label="全屏放大查看"]')!;
    expect(open).not.toBeNull();
    await act(async () => { open.click(); });
    const viewport = host.querySelector<HTMLElement>('[data-testid="fullscreen-viewport"]')!;
    expect(viewport).not.toBeNull();
    await act(async () => { viewport.querySelector('svg')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(host.querySelector('[data-testid="fullscreen-viewport"]')).not.toBeNull();
    await act(async () => { viewport.click(); });
    expect(host.querySelector('[data-testid="fullscreen-viewport"]')).toBeNull();
  } finally {
    await act(async () => { root.unmount(); editor.destroy(); }); host.remove();
  }
});
