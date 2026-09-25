// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LinkedMarkdownBanner } from '../../src/features/document-format/LinkedMarkdownBanner';

const state = vi.hoisted(() => ({ conflict: undefined as { nativeKey: string; markdownPath: string; reason: string; message: string } | undefined,
  accept: vi.fn(), save: vi.fn(), open: vi.fn(), listeners: new Set<() => void>() }));
vi.mock('../../src/features/document-format/linkedMarkdownUpdates', () => ({
  getLinkedMarkdownConflict: (key: string) => state.conflict?.nativeKey === key ? state.conflict : undefined,
  subscribeLinkedMarkdownConflicts: (listener: () => void) => { state.listeners.add(listener); return () => state.listeners.delete(listener); },
  acceptLinkedMarkdownOverwrite: state.accept,
}));
vi.mock('../../src/features/editor-code/orchestration/saveDocument', () => ({ saveDocument: state.save }));
vi.mock('../../src/features/editor-code/orchestration/openDocument', () => ({ openDocument: state.open }));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.conflict = undefined; state.accept.mockReset(); state.save.mockReset(); state.open.mockReset();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); state.listeners.clear(); vi.unstubAllGlobals(); });
const render = () => act(async () => root.render(<LinkedMarkdownBanner docKey="C:/note.nb"/>));
const conflict = () => { state.conflict = { nativeKey: 'C:/note.nb', markdownPath: 'C:/source.md', reason: 'structure', message: '关联 Markdown 的表格结构已变化，请确认如何处理。' }; };
it('stays absent without an active conflict and follows subscribed updates', async () => {
  await render(); expect(host.textContent).toBe('');
  await act(async () => { conflict(); state.listeners.forEach(listener => listener()); });
  expect(host.querySelector('[role=status]')?.textContent).toContain('表格结构已变化');
  await act(async () => { state.conflict = undefined; state.listeners.forEach(listener => listener()); });
  expect(host.textContent).toBe('');
});
it('saves only after accepting the latest external Markdown version', async () => {
  conflict(); state.accept.mockResolvedValue(false); await render();
  const button = host.querySelector<HTMLButtonElement>('button[title="保留 NB 并更新关联 Markdown"]')!;
  await act(async () => button.click()); expect(state.save).not.toHaveBeenCalled();
  state.accept.mockResolvedValue(true);
  await act(async () => button.click());
  expect(state.accept).toHaveBeenLastCalledWith('C:/note.nb'); expect(state.save).toHaveBeenCalledWith('C:/note.nb');
});
it('opens the associated Markdown path without authorizing a write', async () => {
  conflict(); await render();
  await act(async () => host.querySelector<HTMLButtonElement>('button[title="打开关联 Markdown 查看"]')!.click());
  expect(state.open).toHaveBeenCalledWith('C:/source.md'); expect(state.accept).not.toHaveBeenCalled(); expect(state.save).not.toHaveBeenCalled();
});
