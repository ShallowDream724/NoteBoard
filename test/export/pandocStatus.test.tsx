import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mock.invoke }));
import { usePandocStatus } from '../../src/features/export/usePandocStatus';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => vi.resetAllMocks());

it('shows the native resolved path without turning automatic detection into a setting', async () => {
  mock.invoke.mockResolvedValue({ available: true, version: 'pandoc 3', resolvedPath: 'C:/Local/Pandoc/pandoc.exe' });
  let value!: ReturnType<typeof usePandocStatus>;
  function Harness() { value = usePandocStatus(''); return null; }
  const root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Harness />));
  expect(mock.invoke).toHaveBeenCalledWith('pandoc_status', { path: '' });
  expect(mock.invoke).toHaveBeenCalledTimes(1);
  expect(value.result?.resolvedPath).toBe('C:/Local/Pandoc/pandoc.exe');
  expect(value.checking).toBe(false);
  await act(async () => root.unmount());
});

it('ignores older path responses, supports refresh, and ignores completion after closing', async () => {
  const pending: Array<(result: unknown) => void> = [];
  mock.invoke.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
  let value!: ReturnType<typeof usePandocStatus>;
  function Harness({ path }: { path: string }) { value = usePandocStatus(path); return null; }
  const root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Harness path="" />));
  await act(async () => root.render(<Harness path="custom.exe" />));
  const found = { available: true, version: 'pandoc 3', resolvedPath: 'custom.exe' };
  await act(async () => pending[1](found));
  await act(async () => pending[0]({ ...found, resolvedPath: 'old.exe' }));
  expect(value.result?.resolvedPath).toBe('custom.exe');
  await act(async () => value.refresh());
  expect(value.checking).toBe(true);
  expect(value.result).toBeUndefined();
  await act(async () => root.unmount());
  await act(async () => pending[2](found));
  expect(mock.invoke).toHaveBeenCalledTimes(3);
});
