import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSpringFolders } from '@/features/explorer/springFolders';
import { useExplorerStore } from '@/features/explorer/explorerStore';
import { readExplorerDirectory } from '@/features/explorer/explorerActions';
import type { FileTreeNode } from '@/core/ipc/types';

vi.mock('@/features/explorer/explorerActions', () => ({ readExplorerDirectory: vi.fn(async () => []) }));
const root = 'C:\\work', parent = `${root}\\parent`, child = `${parent}\\child`, sibling = `${root}\\parent-other`;
let spring: ReturnType<typeof createSpringFolders>;
const expanded = (path: string) => useExplorerStore.getState().isExpanded(path);
beforeEach(() => {
  vi.useFakeTimers(); useExplorerStore.getState().clear(); useExplorerStore.getState().setRoot(root, []);
  vi.mocked(readExplorerDirectory).mockResolvedValue([]);
  spring = createSpringFolders(root, () => useExplorerStore.getState().root === root);
});
afterEach(() => { spring.destroy(); vi.useRealTimers(); vi.resetAllMocks(); });
const dwell = async (path: string) => { spring.hover(path); await vi.advanceTimersByTimeAsync(650); };

describe('drag-owned folder expansion', () => {
  it('keeps ancestors while entering children, then closes only the departed branch', async () => {
    await dwell(parent); await dwell(child);
    expect(expanded(parent)).toBe(true); expect(expanded(child)).toBe(true);
    spring.hover(parent);
    expect(expanded(parent)).toBe(true); expect(expanded(child)).toBe(false);
    await dwell(sibling);
    expect(expanded(parent)).toBe(false); expect(expanded(sibling)).toBe(true);
    spring.clear(); expect(expanded(sibling)).toBe(false);
  });
  it('preserves folders already open and folders manually reopened during the gesture', async () => {
    useExplorerStore.getState().expand(parent, []);
    await dwell(child); spring.clear();
    expect(expanded(parent)).toBe(true); expect(expanded(child)).toBe(false);
    await dwell(sibling);
    useExplorerStore.getState().collapse(sibling); useExplorerStore.getState().expand(sibling, []);
    spring.clear(); expect(expanded(sibling)).toBe(true);
  });
  it('retains only the successful target ancestor chain and restores it after a failed drop', async () => {
    await dwell(parent); await dwell(child);
    const complete = spring.take(parent); spring.clear();
    expect(expanded(parent)).toBe(true); expect(expanded(child)).toBe(false);
    complete(true); spring.clear(); expect(expanded(parent)).toBe(true);
    await dwell(child); const fail = spring.take(child); spring.clear(); fail(false);
    expect(expanded(parent)).toBe(true); expect(expanded(child)).toBe(false);
  });
  it('rejects late directory reads after leaving and revisiting the same path', async () => {
    let resolve!: (children: FileTreeNode[]) => void;
    vi.mocked(readExplorerDirectory).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    spring.hover(parent); await vi.advanceTimersByTimeAsync(650);
    spring.hover(sibling); spring.hover(parent); resolve([]); await vi.advanceTimersByTimeAsync(0);
    expect(expanded(parent)).toBe(false);
    await vi.advanceTimersByTimeAsync(650); expect(expanded(parent)).toBe(true);
  });
  it('never applies an old read or cleanup to a replacement tree after switching away and back', async () => {
    let resolve!: (children: FileTreeNode[]) => void;
    vi.mocked(readExplorerDirectory).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    spring.hover(parent); await vi.advanceTimersByTimeAsync(650);
    useExplorerStore.getState().setRoot('C:\\other', []); useExplorerStore.getState().setRoot(root, []);
    resolve([]); await vi.advanceTimersByTimeAsync(0); expect(expanded(parent)).toBe(false);
    await dwell(parent); const fail = spring.take(parent);
    useExplorerStore.getState().setRoot('C:\\other', []); useExplorerStore.getState().setRoot(root, []);
    useExplorerStore.getState().expand(parent, []); fail(false);
    expect(expanded(parent)).toBe(true);
  });
  it('preserves pending destination ownership when moving a directory revises the same root', async () => {
    await dwell(parent); await dwell(child); const complete = spring.take(child);
    useExplorerStore.getState().renameDirectory(`${root}\\source`, `${child}\\source`);
    complete(true);
    expect(expanded(parent)).toBe(true); expect(expanded(child)).toBe(true);
  });
  it('cancels pending timers and rolls back active and pending branches on teardown', async () => {
    await dwell(parent); const complete = spring.take(parent); spring.hover(sibling);
    spring.destroy(); complete(true); await vi.advanceTimersByTimeAsync(1000);
    expect(expanded(parent)).toBe(false); expect(expanded(sibling)).toBe(false);
    expect(readExplorerDirectory).toHaveBeenCalledTimes(1);
  });
});
