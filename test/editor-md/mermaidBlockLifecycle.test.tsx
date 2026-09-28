import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { NodeSelection } from '@tiptap/pm/state';
import { expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/Tooltip';
import { MermaidBlock } from '@/features/editor-md/mermaidExtension';
import { DEFAULT_MERMAID_CODE } from '@/features/editor-md/insertContentRecipes';
import { markMermaidCreation } from '@/features/editor-md/mermaidCreation';
import { moveTopLevelBlock } from '@/features/editor-md/blockReorder';

vi.mock('@/features/editor-md/viewportActivation', () => ({ observe: (_element: HTMLElement, callback: () => void) => { callback(); return () => {}; } }));
vi.mock('@/features/editor-md/viewportWorkScheduler', () => ({ scheduleTask: (_id: string, task: () => unknown) => { void task(); }, cancelTask: () => {} }));
vi.mock('@/features/diagram-preview/mermaidRenderer', () => ({ renderMermaidSvg: async () => '<svg xmlns="http://www.w3.org/2000/svg"/>', resetMermaidRenderer: () => {} }));
vi.mock('@/features/diagram-preview/SvgDiagramViewport', () => ({ SvgDiagramViewport: () => <svg/> }));
vi.mock('@/features/export/ChartExportMenu', () => ({ ChartExportMenu: () => null }));

function mount(content: Array<Record<string, unknown>>) {
  const editor = new Editor({ extensions: [StarterKit, MermaidBlock], content: { type: 'doc', content }, editorProps: { handleScrollToSelection: () => true } });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  return { editor, host, root, dispose: async () => { await act(async () => { root.unmount(); editor.destroy(); }); host.remove(); } };
}
const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const mermaid = () => ({ type: 'mermaidBlock', attrs: { code: DEFAULT_MERMAID_CODE } });
const diagramIndex = (editor: Editor) => Array.from({ length: editor.state.doc.childCount }, (_, index) => index)
  .find(index => editor.state.doc.child(index).type.name === 'mermaidBlock');
const diagramCode = (editor: Editor) => editor.state.doc.child(diagramIndex(editor)!).attrs.code;

it('keeps an existing Mermaid in preview through a block move and undo/redo', async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const { editor, host, root, dispose } = mount([paragraph('before'), mermaid(), paragraph('after')]);
  try {
    await act(async () => { root.render(<TooltipProvider><EditorContent editor={editor}/></TooltipProvider>); });
    expect(host.querySelector('textarea[aria-label="Mermaid 图表源码"]')).toBeNull();
    const sourcePos = editor.state.doc.firstChild!.nodeSize;
    await act(async () => { expect(moveTopLevelBlock(editor.view, sourcePos, editor.state.doc.content.size)).not.toBeNull(); });
    expect(diagramIndex(editor)).toBeGreaterThan(1);
    expect(diagramCode(editor)).toBe(DEFAULT_MERMAID_CODE);
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect((editor.state.selection as NodeSelection).node.type.name).toBe('mermaidBlock');
    expect(host.querySelector('textarea[aria-label="Mermaid 图表源码"]')).toBeNull();
    await act(async () => { editor.commands.undo(); });
    expect(diagramIndex(editor)).toBe(1);
    expect(diagramCode(editor)).toBe(DEFAULT_MERMAID_CODE);
    expect(host.querySelector('textarea[aria-label="Mermaid 图表源码"]')).toBeNull();
    await act(async () => { editor.commands.redo(); });
    expect(diagramIndex(editor)).toBeGreaterThan(1);
    expect(diagramCode(editor)).toBe(DEFAULT_MERMAID_CODE);
    expect(host.querySelector('textarea[aria-label="Mermaid 图表源码"]')).toBeNull();
  } finally { await dispose(); }
});

it('restores an active source session at the moved position, including its cancel baseline', async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const { editor, host, root, dispose } = mount([paragraph('before'), mermaid(), paragraph('after')]);
  try {
    await act(async () => { root.render(<TooltipProvider><EditorContent editor={editor}/></TooltipProvider>); });
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="编辑图表源码"]')!.click(); });
    expect(host.querySelector('textarea[aria-label="Mermaid 图表源码"]')).not.toBeNull();
    const sourcePos = editor.state.doc.firstChild!.nodeSize;
    await act(async () => { editor.view.dispatch(editor.state.tr.setNodeMarkup(sourcePos, undefined, { code: 'graph TD\n  A --> C' })); });
    await act(async () => { expect(moveTopLevelBlock(editor.view, sourcePos, editor.state.doc.content.size)).not.toBeNull(); });
    expect(host.querySelector('textarea[aria-label="Mermaid 图表源码"]')).not.toBeNull();
    await act(async () => { host.querySelector<HTMLButtonElement>('.nb-annotation-toolbar-actions button:last-child')!.click(); });
    expect(diagramCode(editor)).toBe(DEFAULT_MERMAID_CODE);
  } finally { await dispose(); }
});

it('opens source after an explicitly marked insert while undo/redo preserves the diagram', async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const { editor, host, root, dispose } = mount([paragraph('before'), paragraph('after')]);
  try {
    await act(async () => { root.render(<TooltipProvider><EditorContent editor={editor}/></TooltipProvider>); });
    const at = editor.state.doc.firstChild!.nodeSize;
    await act(async () => { editor.view.dispatch(markMermaidCreation(editor.state.tr.insert(at, editor.schema.nodes.mermaidBlock.create({ code: DEFAULT_MERMAID_CODE })))); });
    expect(host.querySelector('textarea[aria-label="Mermaid 图表源码"]')).not.toBeNull();
    await act(async () => { editor.commands.undo(); });
    expect(editor.state.doc.content.toJSON().map((node: { type: string }) => node.type)).toEqual(['paragraph', 'paragraph']);
    await act(async () => { editor.commands.redo(); });
    expect(editor.state.doc.child(1).attrs.code).toBe(DEFAULT_MERMAID_CODE);
    expect(host.querySelector('textarea[aria-label="Mermaid 图表源码"]')).toBeNull();
    expect(editor.state.selection.from).toBeGreaterThanOrEqual(0);
    expect(editor.state.selection.to).toBeLessThanOrEqual(editor.state.doc.content.size);
  } finally { await dispose(); }
});
