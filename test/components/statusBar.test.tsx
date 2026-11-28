import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { StatusBar } from '../../src/components/statusbar/StatusBar';
import { SaveDocumentButton } from '../../src/components/titlebar/SaveDocumentButton';
import { TooltipProvider } from '../../src/components/Tooltip';
import { useDocumentStore } from '../../src/stores/documentStore';
import { useWindowStore, type Tab } from '../../src/stores/windowStore';
import { emit } from '../../src/core/emitter';
import { saveDocument } from '../../src/features/editor-code/orchestration/saveDocument';
import { recordSaveError, trackDocumentSave } from '../../src/stores/saveActivityStore';
import { countDocumentSource } from '../../src/features/document-statistics/documentSourceStatistics';

vi.mock('../../src/features/editor-code/orchestration/saveDocument', () => ({ saveDocument: vi.fn() }));
vi.mock('../../src/core/emitter', () => ({ emit: vi.fn() }));

let container: HTMLDivElement;
let root: Root;
const nativeSource = '#!noteboard 1\n@block {"type":"paragraph","content":[{"type":"text","text":"Hello"}]}';
beforeAll(async () => { await countDocumentSource('', 'markdown'); }, 20000);

function openText(kind: 'noteboard' | 'markdown' | 'code', content: string, viewMode: Tab['viewMode'] = 'visual'): void {
  const key = 'untitled:status-test';
  useDocumentStore.getState().upsertFromPayload({
    key, displayName: 'Status test', dirPath: '', kind,
    language: kind === 'markdown' ? 'markdown' : 'plaintext', content,
    encoding: 'utf8', eol: 'crlf', size: content.length, mtime: 0, readonly: false,
  });
  useWindowStore.getState().openTab({
    key, displayName: 'Status test', path: null, kind, language: 'plaintext',
    isDirty: false, isPreview: false, viewMode, externalStatus: null, isDetached: false,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useWindowStore.setState({ tabs: [], activeKey: null });
  useDocumentStore.setState({ documents: new Map() });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('document status information', () => {
  it('offers native file metadata, a source switch and semantic body statistics', async () => {
    openText('noteboard', nativeSource);
    act(() => root.render(<TooltipProvider><StatusBar /></TooltipProvider>));
    expect(container.textContent).toContain('UTF-8');
    expect(container.textContent).toContain('CRLF');
    expect(container.textContent).toContain('NoteBoard 文档');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    expect(container.textContent).toContain('5 字符 · 1 字词');
    expect(container.textContent).not.toContain(' 行');
    expect(container.querySelector('.nb-status-metadata')?.textContent).toContain('Status test');
    const details = container.querySelector('.nb-status-details')!;
    expect(details.querySelector('[aria-label="文件编码：UTF-8"]')).toBeTruthy();
    expect(details.querySelector('[aria-label="行尾符：CRLF"]')).toBeTruthy();
    expect(details.lastElementChild?.textContent).toContain('未保存');
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-label="切换为源码模式"]');
    expect(toggle).not.toBeNull();
    act(() => toggle!.click());
    expect(emit).toHaveBeenCalledWith('toggle-md-view-mode', { key: 'untitled:status-test' });
  });

  it.each(['image', 'pdf', 'unsupported'] as const)('shows the path without a save or readonly label for %s previews', kind => {
    const file = { image: 'sample.png', pdf: 'sample.pdf', unsupported: 'sample.zip' }[kind];
    const key = 'C:\\fixtures\\' + file;
    useDocumentStore.getState().upsertFromPayload({ key, displayName: file, dirPath: 'C:\\fixtures', kind,
      language: 'plaintext', content: null, encoding: 'utf8', eol: 'lf', size: 127, mtime: 1, readonly: true });
    useWindowStore.getState().openTab({ key, path: key, displayName: file, kind, language: 'plaintext', isDirty: false,
      isPreview: true, viewMode: 'visual', externalStatus: null, isDetached: false });
    act(() => root.render(<TooltipProvider><StatusBar /></TooltipProvider>));
    expect(container.querySelector('.nb-status-metadata button')?.textContent).toContain(file);
    expect(container.querySelector('footer')?.textContent).not.toMatch(/已保存|未保存|只读/);
  });

  it('counts the same native body in source and visual modes without counting file records', async () => {
    openText('noteboard', nativeSource, 'source');
    act(() => root.render(<TooltipProvider><StatusBar /></TooltipProvider>));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    expect(container.textContent).toContain('5 字符 · 1 字词');
    expect(container.textContent).toContain('NoteBoard 文档 (源码)');
    expect(container.textContent).toContain('NoteBoard 文档');
    act(() => useWindowStore.getState().setTabViewMode('untitled:status-test', 'visual'));
    expect(container.textContent).toContain('5 字符 · 1 字词');
    expect(container.textContent).toContain('UTF-8');
    expect(container.textContent).toContain('CRLF');
  });

  it.each(['markdown', 'code'] as const)('keeps %s text metadata and never invents a cursor position', async kind => {
    openText(kind, 'Hello\nworld', 'source');
    act(() => root.render(<TooltipProvider><StatusBar /></TooltipProvider>));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    expect(container.textContent).toContain('10 字符 · 2 字词');
    expect(container.textContent).toContain('UTF-8');
    expect(container.textContent).toContain('CRLF');
    expect(container.textContent).not.toContain('行 1, 列 1');
    if (kind === 'markdown') expect(container.querySelector('button')?.textContent).toBe('Markdown (源码)');
    expect(container.querySelector('button[aria-label="保存当前文档"]')).toBeNull();
  });

  it('offers one keyboard-accessible titlebar save button for a clean untitled document', () => {
    openText('code', 'Hello');
    act(() => root.render(<TooltipProvider><header><SaveDocumentButton /></header><StatusBar /></TooltipProvider>));
    expect(container.textContent).toContain('未保存');
    const save = container.querySelector<HTMLButtonElement>('button[aria-label="保存当前文档"]')!;
    expect(save.closest('header')).not.toBeNull();
    expect(container.querySelectorAll('button[aria-label="保存当前文档"]')).toHaveLength(1);
    expect(save.disabled).toBe(false);
    act(() => save.click());
    expect(saveDocument).toHaveBeenCalledWith('untitled:status-test');
  });

  it('distinguishes waiting auto-save, actual activity and failure', async () => {
    openText('code', 'Hello');
    const key = 'untitled:status-test', doc = useDocumentStore.getState().getDocument(key)!;
    useDocumentStore.setState({ documents: new Map([[key, { ...doc, isDirty: true, savePolicy: 'auto' }]]) });
    act(() => root.render(<TooltipProvider><SaveDocumentButton /><StatusBar /></TooltipProvider>));
    expect(container.textContent).toContain('未保存');
    expect(container.textContent).not.toContain('正在保存');
    let finish!: () => void, saving!: Promise<void>;
    act(() => { saving = trackDocumentSave(key, () => new Promise<void>(resolve => { finish = resolve; })); });
    expect(container.textContent).toContain('正在保存');
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="保存当前文档"]')!.disabled).toBe(true);
    await act(async () => { recordSaveError(key, '磁盘空间不足'); finish(); await saving; });
    expect(container.textContent).toContain('保存失败');
    expect(container.textContent).not.toContain('已保存');
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="保存当前文档"]')!.disabled).toBe(false);
  });
});
