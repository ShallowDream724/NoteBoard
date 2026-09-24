import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_PDF, type PdfReceipt } from '../../src/features/export/model';
import type { PdfProgressEvent } from '../../src/features/export/progress';

const mock = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mock.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mock.listen }));
vi.mock('../../src/features/export/capture', () => ({ exportFontCss: () => '' }));
import { usePdfJob } from '../../src/features/export/usePdfJob';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const document = { title: 'sample.md', html: '<p>sample</p>', markdown: 'sample', items: [], baseDirectory: '' };
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

it('subscribes before starting native work, tracks loading and releases the listener', async () => {
  vi.useFakeTimers();
  let deliver!: (event: { payload: PdfProgressEvent }) => void;
  let complete!: (receipt: PdfReceipt) => void;
  const unlisten = vi.fn();
  mock.listen.mockImplementation((_event, listener) => { deliver = listener; return Promise.resolve(unlisten); });
  mock.invoke.mockImplementation(command => command === 'create_pdf' ? new Promise(resolve => { complete = resolve; }) : Promise.resolve());
  let value!: ReturnType<typeof usePdfJob>;
  function Harness() { value = usePdfJob(document, DEFAULT_PDF, true, 10); return null; }
  const root = createRoot(window.document.createElement('div'));
  await act(async () => root.render(<Harness/>));
  await act(async () => vi.advanceTimersByTime(0));
  expect(mock.listen.mock.invocationCallOrder[0]).toBeLessThan(mock.invoke.mock.invocationCallOrder[0]);
  const id = mock.invoke.mock.calls.find(([command]) => command === 'create_pdf')![1].id;
  await act(async () => deliver({ payload: { id, revision: 0, phase: 'printing' } }));
  expect(value.progress?.phase).toBe('printing');
  const receipt: PdfReceipt = { id, revision: 0, size: 200, pages: 1, issues: [], adjustable: [], locations: [] };
  await act(async () => complete(receipt));
  expect(value.progress?.phase).toBe('loading'); expect(value.busy).toBe(true);
  await act(async () => deliver({ payload: { id, revision: 0, phase: 'layout' } }));
  expect(value.progress?.phase).toBe('loading');
  await act(async () => value.previewSettled(receipt));
  expect(value.progress).toBeNull(); expect(value.busy).toBe(false);
  await act(async () => root.unmount());
  expect(unlisten).toHaveBeenCalledOnce();
});

it('does not start native work after closing while event subscription is pending', async () => {
  vi.useFakeTimers();
  let subscribed!: (unlisten: () => void) => void;
  mock.listen.mockReturnValue(new Promise(resolve => { subscribed = resolve; }));
  mock.invoke.mockResolvedValue(undefined);
  function Harness() { usePdfJob(document, DEFAULT_PDF, true, 10); return null; }
  const root = createRoot(window.document.createElement('div'));
  await act(async () => root.render(<Harness/>));
  await act(async () => vi.advanceTimersByTime(0));
  await act(async () => root.unmount());
  const unlisten = vi.fn();
  await act(async () => subscribed(unlisten));
  expect(mock.invoke.mock.calls.some(([command]) => command === 'create_pdf')).toBe(false);
  expect(unlisten).toHaveBeenCalledOnce();
});
