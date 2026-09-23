import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { InfographicBlock } from '../../src/features/editor-md/infographicExtension';
import { parseInfographicCode } from '../../src/features/infographic/infographicParser';
import { InfographicRenderer } from '../../src/features/infographic/infographicRenderer';
import { copyChartImage } from '../../src/features/export/chartExport';
import { TooltipProvider } from '../../src/components/Tooltip';

const observed = vi.hoisted(() => new Map<Element, () => void>());
vi.mock('../../src/features/editor-md/viewportActivation', () => ({
  observe: (element: Element, activate: () => void) => {
    observed.set(element, activate);
    return () => observed.delete(element);
  },
}));
vi.mock('../../src/features/infographic/infographicParser', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/features/infographic/infographicParser')>();
  return { ...original, parseInfographicCode: vi.fn(original.parseInfographicCode) };
});
vi.mock('../../src/features/infographic/infographicRenderer', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/features/infographic/infographicRenderer')>();
  return { ...original, InfographicRenderer: vi.fn(original.InfographicRenderer) };
});
vi.mock('../../src/features/export/chartExport', () => ({
  buildExportFileName: () => 'infographic',
  copyChartImage: vi.fn(async () => {}),
  exportChartImage: vi.fn(async () => true),
}));

const codeFor = (title: string) => JSON.stringify({
  type: 'metric-cards', title, items: [{ label: '项目', value: '12' }],
});
let host: HTMLDivElement;
let root: Root;
let editor: Editor;

beforeEach(async () => {
  vi.clearAllMocks();
  observed.clear();
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  function Host() {
    const instance = useEditor({
      extensions: [StarterKit, InfographicBlock],
      content: {
        type: 'doc',
        content: ['图表一', '图表二'].map((title) => ({
          type: 'infographicBlock', attrs: { code: codeFor(title) },
        })),
      },
    });
    useEffect(() => { if (instance) editor = instance; }, [instance]);
    return <TooltipProvider><EditorContent editor={instance} /></TooltipProvider>;
  }
  await act(async () => root.render(<Host />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  observed.clear();
});

function button(container: ParentNode, label: string): HTMLButtonElement {
  const result = [...container.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.getAttribute('aria-label') === label || candidate.textContent === label);
  expect(result, `button ${label}`).toBeDefined();
  return result!;
}

async function click(target: HTMLElement) {
  await act(async () => target.click());
}

it('屏外图表不解析和渲染；首次邻近后复用解析及 DOM，复制使用已挂载图表', async () => {
  expect(observed.size).toBe(2);
  expect(parseInfographicCode).not.toHaveBeenCalled();
  expect(InfographicRenderer).not.toHaveBeenCalled();
  expect(host.querySelectorAll('style')).toHaveLength(0);
  const [first, second] = [...observed.keys()];
  expect(button(first, '复制').disabled).toBe(true);
  await act(async () => observed.get(first)!());
  expect(parseInfographicCode).toHaveBeenCalledTimes(1);
  expect(InfographicRenderer).toHaveBeenCalledTimes(1);
  expect(first.textContent).toContain('图表一');
  expect(second.textContent).not.toContain('图表二');
  expect(button(first, '复制').disabled).toBe(false);

  // Selection and toolbar state do not invalidate unchanged code/data.
  await act(async () => editor.commands.setNodeSelection(0));
  await click(button(first, '复制'));
  await click(button(document.body, '复制 SVG 源码'));
  expect(copyChartImage).toHaveBeenCalledTimes(1);
  const source = vi.mocked(copyChartImage).mock.calls[0][0];
  expect(source.kind).toBe('element');
  if (source.kind === 'element') {
    expect(first.contains(source.element)).toBe(true);
    expect(source.element!.textContent).toContain('图表一');
  }
  expect(parseInfographicCode).toHaveBeenCalledTimes(1);
  expect(InfographicRenderer).toHaveBeenCalledTimes(1);
  expect(observed.has(first)).toBe(false);
});

it('直接编辑激活屏外图表且保留未提交输入，全屏复制使用独立预览', async () => {
  const [first, second] = [...observed.keys()];
  await click(button(first, '编辑信息图源码'));
  const textarea = host.querySelector('textarea')!;
  const changedCode = codeFor('修改后的图表');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, changedCode);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => observed.get(second)!());
  expect(host.querySelector('textarea')).toBe(textarea);
  expect(textarea.value).toBe(changedCode);
  await click(button(host, '完成'));
  expect(editor.state.doc.firstChild?.attrs.code).toBe(changedCode);
  const updated = host.querySelector('.nb-infographic-container')!;
  expect(updated.textContent).toContain('修改后的图表');

  const parseCalls = vi.mocked(parseInfographicCode).mock.calls.length;
  await click(button(updated, '全屏放大查看'));
  expect(parseInfographicCode).toHaveBeenCalledTimes(parseCalls);
  const close = button(host, '关闭预览');
  const toolbar = close.closest('div')!;
  await click(button(toolbar, '复制'));
  await click(button(document.body, '复制 SVG 源码'));
  const source = vi.mocked(copyChartImage).mock.calls[0][0];
  expect(source.kind).toBe('element');
  if (source.kind === 'element') {
    expect(updated.contains(source.element)).toBe(false);
    expect(source.element!.isConnected).toBe(true);
    expect(source.element!.textContent).toContain('修改后的图表');
  }
  await click(close);
  expect(updated.textContent).toContain('修改后的图表');
  expect(parseInfographicCode).toHaveBeenCalledTimes(parseCalls);
});

it('observer 尚未通知时直接打开全屏也会挂载可复制预览', async () => {
  const first = [...observed.keys()][0];
  await click(button(first, '全屏放大查看'));
  expect(parseInfographicCode).toHaveBeenCalledTimes(1);
  expect(InfographicRenderer).toHaveBeenCalledTimes(2);
  expect(button(button(host, '关闭预览').closest('div')!, '复制').disabled).toBe(false);
  await click(button(host, '关闭预览'));
  expect(button(first, '复制').disabled).toBe(false);
  expect(first.textContent).toContain('图表一');
  expect(parseInfographicCode).toHaveBeenCalledTimes(1);
});
