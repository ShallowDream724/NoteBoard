import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ExportDiagnostics } from '../../src/features/export/ExportDiagnostics';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('copies complete converter diagnostics while bounding visible output', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const host = document.createElement('div'), root = createRoot(host), details = 'error detail\n'.repeat(2000);
  await act(async () => root.render(<ExportDiagnostics message={details} details={details}/>));
  expect(host.querySelector('button')!.textContent).toContain('复制报错');
  expect(host.querySelector('[role="status"]')!.textContent!.length).toBeLessThan(12100);
  await act(async () => host.querySelector('button')!.click());
  expect(writeText).toHaveBeenCalledWith(details);
  expect(host.textContent).toContain('已复制');
  await act(async () => root.unmount());
});

it('shows the PDF summary in the left status slot when there is no status message', async () => {
  const host = document.createElement('div'), root = createRoot(host);
  await act(async () => root.render(<ExportDiagnostics message="" details=""><span>6 页 · 2.53 MB</span></ExportDiagnostics>));
  expect(host.querySelector('[role="status"]')!.textContent).toBe('6 页 · 2.53 MB');
  expect(host.querySelector('button')).toBeNull();
  await act(async () => root.render(<ExportDiagnostics message="预览失败" details="预览失败"><span>6 页 · 2.53 MB</span></ExportDiagnostics>));
  expect(host.querySelector('[role="status"]')!.textContent).toBe('预览失败');
  await act(async () => root.unmount());
});
