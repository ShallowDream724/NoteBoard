import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { advancePdfProgress, type PdfProgress } from '../../src/features/export/progress';
import { ExportProgress } from '../../src/features/export/ExportProgress';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('ignores cancelled sessions, old revisions and backwards phase events', () => {
  const current: PdfProgress = { id: 'new-job', revision: 2, phase: 'printing', startedAt: 12 };
  expect(advancePdfProgress(current, { id: 'old-job', revision: 2, phase: 'finishing' })).toBe(current);
  expect(advancePdfProgress(current, { id: 'new-job', revision: 1, phase: 'finishing' })).toBe(current);
  expect(advancePdfProgress(current, { id: 'new-job', revision: 2, phase: 'layout' })).toBe(current);
  expect(advancePdfProgress(current, { id: 'new-job', revision: 2, phase: 'printing' })).toBe(current);
  expect(advancePdfProgress(current, { id: 'new-job', revision: 2, phase: 'finishing' })).toEqual({ ...current, phase: 'finishing' });
  expect(advancePdfProgress(null, { id: 'new-job', revision: 2, phase: 'finishing' })).toBeNull();
});

it('updates truthful elapsed time without restarting it at a stage change and cleans up the clock', async () => {
  vi.useFakeTimers(); let now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const host = document.createElement('div'), root = createRoot(host);
  await act(async () => root.render(<ExportProgress progress={{ phase: 'preparing', startedAt: 1000 }}/>));
  expect(host.querySelector('[role=status]')?.textContent).toBe('整理文档');
  now = 4100;
  await act(async () => vi.advanceTimersByTime(1000));
  expect(host.textContent).toContain('已用 3 秒');
  await act(async () => root.render(<ExportProgress progress={{ phase: 'printing', startedAt: 1000 }}/>));
  expect(host.querySelector('[role=status]')?.textContent).toBe('生成 PDF');
  expect(host.textContent).toContain('已用 3 秒');
  expect(vi.getTimerCount()).toBe(1);
  await act(async () => root.unmount());
  expect(vi.getTimerCount()).toBe(0);
});

it('uses the same stage feedback in compact mode without announcing each second', async () => {
  const host = document.createElement('div'), root = createRoot(host);
  await act(async () => root.render(<ExportProgress compact progress={{ phase: 'layout', startedAt: performance.now() }}/>));
  expect(host.firstElementChild?.classList.contains('export-progress-compact')).toBe(true);
  expect(host.querySelectorAll('[role=status]')).toHaveLength(1);
  expect(host.querySelector('.export-progress-time')?.getAttribute('aria-live')).toBe('off');
  await act(async () => root.unmount());
});
