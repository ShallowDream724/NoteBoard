// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';
import { CodeToolbar } from '../../src/features/toolbar/CodeToolbar';
import { useDocumentStore } from '../../src/stores/documentStore';
import { openWithDefaultApp } from '../../src/core/ipc/commands';
import { flushDocument } from '../../src/features/session/documentSession';
import { saveAs, saveDocument } from '../../src/features/editor-code/orchestration/saveDocument';

vi.mock('../../src/core/ipc/commands', () => ({ openWithDefaultApp: vi.fn(), revealInExplorer: vi.fn() }));
vi.mock('../../src/features/session/documentSession', () => ({ flushDocument: vi.fn() }));
vi.mock('../../src/features/editor-code/orchestration/saveDocument', () => ({ saveAs: vi.fn(), saveDocument: vi.fn() }));
vi.mock('../../src/features/toolbar/ResponsiveToolbar', () => ({ ResponsiveToolbar: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('../../src/features/toolbar/ToolbarComponents', () => ({
  ToolbarButton: ({ title, label, onClick, disabled }: { title: string; label?: string; onClick?: () => void; disabled?: boolean }) => <button title={title} disabled={disabled} onClick={onClick}>{label || title}</button>,
  ToolbarDivider: () => <span />,
  ToolbarDropdown: ({ trigger }: { trigger: ReactNode }) => trigger,
  ToolbarDropdownItem: () => null,
}));
const path = 'C:\\notes\\report.html';
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(openWithDefaultApp).mockResolvedValue(undefined);
  vi.mocked(saveAs).mockResolvedValue(true);
  useDocumentStore.setState({ documents: new Map() });
  useDocumentStore.getState().upsertFromPayload({ key: path, displayName: 'report.html', dirPath: 'C:\\notes', kind: 'code', language: 'html', content: 'old mirror', encoding: 'utf8', eol: 'lf', size: 10, mtime: 1, readonly: false });
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

it('shows useful HTML actions without JSON/XML tools and opens the saved path without an implicit save', async () => {
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<CodeToolbar docKey={path} language="html" />));
    expect(host.textContent).not.toContain('JSON');
    expect(host.textContent).not.toContain('文本工具');
    await act(async () => host.querySelector<HTMLButtonElement>('button[title^="用系统默认应用"]')!.click());
    expect(openWithDefaultApp).toHaveBeenCalledExactlyOnceWith(path);
    expect(saveDocument).not.toHaveBeenCalled();
    await act(async () => host.querySelector<HTMLButtonElement>('button[title="HTML 另存为"]')!.click());
    expect(saveAs).toHaveBeenCalledExactlyOnceWith(path, '');
  } finally { await act(async () => root.unmount()); }
});

it('copies the latest editor snapshot rather than the delayed store mirror', async () => {
  vi.mocked(flushDocument).mockResolvedValue({ docKey: path, instanceId: 'source', revision: 2, content: '<p>new typing</p>' });
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<CodeToolbar docKey={path} language="html" />));
    await act(async () => host.querySelector<HTMLButtonElement>('button[title="复制 HTML 源码"]')!.click());
    expect(flushDocument).toHaveBeenCalledExactlyOnceWith(path, 'export');
    expect(writeText).toHaveBeenCalledExactlyOnceWith('<p>new typing</p>');
  } finally { await act(async () => root.unmount()); }
});
