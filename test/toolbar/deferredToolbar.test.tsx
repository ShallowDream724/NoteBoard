// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
const loads = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../src/features/toolbar/MarkdownToolbar', () => {
  loads.count++;
  return { MarkdownToolbar: ({ docKey }: { docKey: string }) => <div>{docKey}</div> };
});
import { DeferredMarkdownToolbar, loadMarkdownToolbar } from '../../src/features/toolbar/DeferredMarkdownToolbar';

it('keeps toolbar code deferred, shares prefetch, and renders the cached component without a loading frame', async () => {
  expect(loads.count).toBe(0);
  const first = loadMarkdownToolbar();
  expect(loadMarkdownToolbar()).toBe(first);
  await first;
  expect(loads.count).toBe(1);
  const host = document.createElement('div'), root = createRoot(host);
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => root.render(<DeferredMarkdownToolbar docKey="ready.nb" editor={null} viewMode="visual"/>));
    expect(host.textContent).toBe('ready.nb');
    await loadMarkdownToolbar();
    expect(loads.count).toBe(1);
  } finally { await act(async () => root.unmount()); }
});
