// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { currentDiagramTheme, mermaidThemeConfig, useDiagramTheme } from '../../src/features/diagram-preview/mermaidTheme';
import { contrastRatio } from '../../src/core/theme/contrast';

it('uses actual theme IDs, visible dark strokes, and an independent light export', () => {
  document.documentElement.dataset.theme = 'mo-ye';
  expect(currentDiagramTheme()).toBe('mo-ye');
  const dark = mermaidThemeConfig(currentDiagramTheme()).themeVariables!;
  expect(contrastRatio(dark.lineColor as string, '#0f172a')).toBeGreaterThan(3);
  expect(contrastRatio(dark.primaryTextColor as string, dark.primaryColor as string)).toBeGreaterThan(4.5);
  expect(mermaidThemeConfig('default')).toEqual({ theme: 'default' });
  document.documentElement.dataset.theme = 'chen-guang';
});
it('shares one theme observer and releases it when the final diagram unmounts', async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const observe = vi.spyOn(MutationObserver.prototype, 'observe'), disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const Theme = () => <span>{useDiagramTheme()}</span>;
  try {
    await act(async () => root.render(<><Theme/><Theme/></>));
    expect(observe).toHaveBeenCalledTimes(1);
    await act(async () => { document.documentElement.dataset.theme = 'mo-ye'; await Promise.resolve(); });
    expect(host.textContent).toBe('mo-yemo-ye');
    await act(async () => root.render(<Theme/>));
    expect(disconnect).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    expect(disconnect).toHaveBeenCalledTimes(1);
  } finally { host.remove(); vi.restoreAllMocks(); document.documentElement.dataset.theme = 'chen-guang'; }
});
