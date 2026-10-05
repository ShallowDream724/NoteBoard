import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { buildDocumentExtensions } from '@/features/editor-md/documentExtensions';
import { nativeTestEditor } from './editor-md/nativeTestEditor';
import { EmptyBlockInsertMenu } from '@/features/editor-md/EmptyBlockInsertMenu';
import { BlockContextMenu } from '@/features/editor-md/BlockContextMenu';
import { ImageInsertItems } from '@/features/editor-md/rich-content/menus';
import { MarkdownToolbar } from '@/features/toolbar/MarkdownToolbar';
import { IMAGE_TEMPLATES, imageCollectionTemplate } from '@/features/editor-md/rich-content/commands';
import { IMAGE_TEMPLATE_HELP_KEYS } from '@/components/contextualHelpKeys';

// These checks cover operation identities at real menu boundaries. The actual
// delayed tooltip lifecycle and preview DOM are covered in contextualHelp.test.
vi.mock('@/components/Tooltip', () => ({
  Tooltip: ({ children, helpKey, shortcut }: { children: ReactNode; helpKey?: string; shortcut?: string }) =>
    <span data-entry-help={helpKey} data-entry-shortcut={shortcut}>{children}</span>,
}));
vi.mock('@/features/toolbar/ResponsiveToolbar', () => ({
  ResponsiveToolbar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ToolbarOverflowItem: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/features/history/documentHistory', async importOriginal => ({
  ...await importOriginal<object>(), useDocumentHistory: () => ({ canUndo: true, canRedo: true }),
}));

let root: Root, host: HTMLDivElement;
const editors: Editor[] = [];
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  host = document.body.appendChild(document.createElement('div')); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); editors.splice(0).forEach(editor => editor.destroy());
  document.body.replaceChildren(); vi.unstubAllGlobals();
});
function editor(content: string | JSONContent = '<p>现有正文</p>') {
  const instance = nativeTestEditor(new Editor({ element: document.body.appendChild(document.createElement('div')),
    extensions: buildDocumentExtensions(), editorProps: { handleScrollToSelection: () => true }, content }));
  editors.push(instance); return instance;
}
function entry(label: string) {
  return host.querySelector(`[aria-label="${label}"]`) ?? Array.from(host.querySelectorAll('button')).find(button => button.textContent === label)!;
}
function help(label: string) { return entry(label)?.closest('[data-entry-help]')?.getAttribute('data-entry-help'); }
const formats = { '正文': 'block.paragraph', '无序列表': 'list.bullet', '有序列表': 'list.ordered', '待办': 'list.task', '代码块': 'block.code', '引用': 'block.quote' };

it('uses the same format identities in the empty insertion and existing-block format menus', async () => {
  const instance = editor('<p></p>');
  await act(async () => root.render(<EmptyBlockInsertMenu editor={instance} pos={0} close={() => {}}/>));
  for (const [label, key] of Object.entries(formats)) expect(help(label)).toBe(key);
  for (let level = 1; level <= 6; level++) expect(help(`标题 ${level}`)).toBe(`block.heading.${level}`);
  expect(help('分割线')).toBe('block.divider');
  await act(async () => instance.commands.setContent('<p>现有正文</p>'));
  await act(async () => root.render(<BlockContextMenu editor={instance} pos={0} close={() => {}}/>));
  for (const [label, key] of Object.entries(formats)) expect(help(label)).toBe(key);
  for (let level = 1; level <= 6; level++) expect(help(`标题 ${level}`)).toBe(`block.heading.${level}`);
});

it('gives all image templates the same help key in both insertion menus and preserves insertion callbacks', async () => {
  const instance = editor('<p></p>'), close = vi.fn(), local = vi.fn(), network = vi.fn();
  await act(async () => root.render(<EmptyBlockInsertMenu editor={instance} pos={0} close={close}/>));
  for (const { template, label } of IMAGE_TEMPLATES) expect(help(label)).toBe(IMAGE_TEMPLATE_HELP_KEYS[template]);
  await act(async () => root.render(<ImageInsertItems editor={instance} onLocal={local} onNetwork={network} onDone={close}/>));
  for (const { template, label } of IMAGE_TEMPLATES) expect(help(label)).toBe(IMAGE_TEMPLATE_HELP_KEYS[template]);
  await act(async () => (entry('四宫格') as HTMLElement).click());
  const collection = instance.state.doc.firstChild!;
  expect(collection.type.name).toBe('imageCollection'); expect(collection.childCount).toBe(4);
  expect(collection.attrs.columns).toBe(2); expect(close).toHaveBeenCalledOnce();
});

it('explains image layout conversion and preserves the existing collection while changing columns', async () => {
  const instance = editor({ type: 'doc', content: [imageCollectionTemplate(9)] }), close = vi.fn();
  await act(async () => root.render(<BlockContextMenu editor={instance} pos={0} close={close}/>));
  expect(help('两列拼图')).toBe('image.collection.columns.2');
  expect(help('三列拼图')).toBe('image.collection.columns.3');
  expect(help('图片轮播')).toBe('image.collection.layout.carousel');
  await act(async () => (entry('两列拼图') as HTMLElement).click());
  expect(instance.state.doc.firstChild!.childCount).toBe(9);
  expect(instance.state.doc.firstChild!.attrs.columns).toBe(2); expect(close).toHaveBeenCalledOnce();
});

it('exposes the matching format help and existing shortcuts from the top toolbar', async () => {
  const instance = editor();
  await act(async () => root.render(<MarkdownToolbar docKey="help-entry.nb" editor={instance} viewMode="visual"/>));
  for (const label of ['无序列表', '有序列表', '待办']) expect(help(label)).toBe(formats[label as keyof typeof formats]);
  await act(async () => (entry('标题等级') as HTMLElement).click());
  expect(help('正文段落')).toBe('block.paragraph');
  expect(help('三级标题 (H3)')).toBe('block.heading.3');
  await act(async () => (entry('插入超链接、图片、表格、公式、图表、提示块、日期时间等') as HTMLElement).click());
  expect(help('代码块')).toBe('block.code');
  expect(entry('代码块')?.closest('[data-entry-help]')?.getAttribute('data-entry-shortcut')).toBe('Ctrl+Alt+C');
  expect(help('引用块 (Quote)')).toBe('block.quote'); expect(help('水平分割线')).toBe('block.divider');
});
