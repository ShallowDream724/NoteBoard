import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => { localStorage.clear(); vi.resetModules(); });
it('restores a resized sidebar without requiring any open document', async () => {
  localStorage.clear(); vi.resetModules();
  const first = (await import('../../src/stores/layoutStore')).useLayoutStore;
  first.getState().setExplorerWidth(372);
  vi.resetModules();
  const restored = (await import('../../src/stores/layoutStore')).useLayoutStore;
  expect(restored.getState().explorerWidth).toBe(372);
  restored.getState().toggleExplorer(); restored.getState().toggleExplorer();
  expect(restored.getState().explorerWidth).toBe(372);
  restored.getState().setExplorerWidth(NaN);
  expect(restored.getState().explorerWidth).toBe(372);
});
