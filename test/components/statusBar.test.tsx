import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { StatusBar } from '../../src/components/statusbar/StatusBar';
import { TooltipProvider } from '../../src/components/Tooltip';
import { useDocumentStore } from '../../src/stores/documentStore';
import { useWindowStore, type Tab } from '../../src/stores/windowStore';
import { emit } from '../../src/core/emitter';
import { saveDocument } from '../../src/features/editor-code/orchestration/saveDocument';
import { recordSaveError, trackDocumentSave } from '../../src/stores/saveActivityStore';

vi.mock('../../src/features/editor-code/orchestration/saveDocument', () => ({ saveDocument: vi.fn() }));
vi.mock('../../src/core/emitter', () => ({ emit: vi.fn() }));

let container: HTMLDivElement;
let root: Root;
const nativeSource = '#!noteboard 1\n@block {"type":"paragraph","content":[{"type":"text","text":"Hello"}]}';

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
});

describe('document status information', () => {
  it('offers native file metadata without a raw source switch or counting serialized frames as prose', () => {
    openText('noteboard', nativeSource);
    act(() => root.render(<TooltipProvider><StatusBar /></TooltipProvider>));
    expect(container.textContent).toContain('UTF-8');
    expect(container.textContent).toContain('CRLF');
    expect(container.textContent).toContain('NoteBoard 文档');
    expect(container.textContent).not.toContain('字');
    expect(container.textContent).not.toContain(' 行');
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-label="切换为源码模式"]');
    expect(toggle).toBeNull();
    expect(emit).not.toHaveBeenCalledWith('toggle-md-view-mode', expect.anything());
  });

  it('labels native source statistics explicitly and removes them when returning to visual mode', () => {
    openText('noteboard', nativeSource, 'source');
    act(() => root.render(<TooltipProvider><StatusBar /></TooltipProvider>));
    expect(container.textContent).toContain(`原始记录 ${nativeSource.length} 字符 · 2 行`);
    expect(container.textContent).toContain('NoteBoard 文档');
    act(() => useWindowStore.getState().setTabViewMode('untitled:status-test', 'visual'));
    expect(container.textContent).not.toContain('字符');
    expect(container.textContent).toContain('UTF-8');
    expect(container.textContent).toContain('CRLF');
  });

  it.each(['markdown', 'code'] as const)('keeps %s text metadata and never invents a cursor position', kind => {
    openText(kind, 'Hello\nworld', 'source');
    act(() => root.render(<TooltipProvider><StatusBar /></TooltipProvider>));
    expect(container.textContent).toContain('11 字 · 2 行');
    expect(container.textContent).toContain('UTF-8');
    expect(container.textContent).toContain('CRLF');
    expect(container.textContent).not.toContain('行 1, 列 1');
    if (kind === 'markdown') expect(container.querySelector('button')?.textContent).toBe('Markdown (源码)');
    expect(container.querySelector('button[aria-label="保存当前文档"]')).not.toBeNull();
  });

  it('offers a keyboard-accessible save button even for a clean untitled document', () => {
    openText('code', 'Hello');
    act(() => root.render(<TooltipProvider><StatusBar /></TooltipProvider>));
    expect(container.textContent).toContain('未保存');
    const save = container.querySelector<HTMLButtonElement>('button[aria-label="保存当前文档"]')!;
    expect(save.disabled).toBe(false);
    act(() => save.click());
    expect(saveDocument).toHaveBeenCalledWith('untitled:status-test');
  });

  it('distinguishes waiting auto-save, actual activity and failure', async () => {
    openText('code', 'Hello');
    const key = 'untitled:status-test', doc = useDocumentStore.getState().getDocument(key)!;
    useDocumentStore.setState({ documents: new Map([[key, { ...doc, isDirty: true, savePolicy: 'auto' }]]) });
    act(() => root.render(<TooltipProvider><StatusBar /></TooltipProvider>));
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
