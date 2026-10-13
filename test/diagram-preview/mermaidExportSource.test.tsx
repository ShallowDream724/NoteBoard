// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../../src/components/Tooltip';
import { ChartExportMenu } from '../../src/features/export/ChartExportMenu';
import { useMermaidExportSource } from '../../src/features/diagram-preview/mermaidExportSource';

const mocks = vi.hoisted(() => ({ render: vi.fn(), copy: vi.fn(), save: vi.fn() }));
vi.mock('../../src/features/diagram-preview/mermaidRenderer', () => ({ renderMermaidSvg: mocks.render }));
vi.mock('../../src/features/export/chartExport', () => ({ copyChartImage: mocks.copy, exportChartImage: mocks.save }));
const screen = { kind: 'svg' as const, svg: '<svg>dark screen</svg>' };
function Controls({ code, owner = 'document' }: { code: string; owner?: string }) {
  const prepare = useMermaidExportSource(code, owner);
  return <TooltipProvider><ChartExportMenu action="copy" source={screen} prepareSource={prepare} fileName="diagram"/>
    <ChartExportMenu action="download" source={screen} prepareSource={prepare} fileName="diagram"/></TooltipProvider>;
}
const click = async (element: Element) => { await act(async () => (element as HTMLButtonElement).click()); };
afterEach(() => vi.clearAllMocks());
it('lazily prepares a light SVG for both real copy/export menus and reuses it for PNG', async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.render.mockResolvedValue('<svg>light export</svg>'); mocks.copy.mockResolvedValue(undefined); mocks.save.mockResolvedValue(true);
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<Controls code="graph LR; A-->B"/>));
    expect(mocks.render).not.toHaveBeenCalled();
    await click(host.querySelectorAll('.nb-chart-export-btn')[0]); await click(document.querySelectorAll('.nb-chart-export-item')[0]);
    expect(mocks.render.mock.calls[0].slice(0,2)).toEqual(['graph LR; A-->B','default']);
    expect(mocks.copy).toHaveBeenCalledWith({kind:'svg',svg:'<svg>light export</svg>'},'svg',expect.any(Object));
    await click(host.querySelectorAll('.nb-chart-export-btn')[1]); await click(document.querySelectorAll('.nb-chart-export-item')[1]);
    expect(mocks.render).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledWith({kind:'svg',svg:'<svg>light export</svg>'},'png','diagram',expect.any(Object));
    expect(screen.svg).toBe('<svg>dark screen</svg>');
  } finally { await act(async () => root.unmount()); host.remove(); }
});
it('cancels a pending source when the user edits or closes the diagram', async () => {
  let finish!: (svg: string) => void;
  mocks.render.mockImplementation(() => new Promise<string>(resolve => { finish = resolve; }));
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<Controls code="old"/>));
    await click(host.querySelector('.nb-chart-export-btn')!); await click(document.querySelector('.nb-chart-export-item')!);
    const signal = mocks.render.mock.calls[0][2] as AbortSignal;
    await act(async () => root.render(<Controls code="new"/>));
    expect(signal.aborted).toBe(true);
    await act(async () => finish('<svg>stale</svg>'));
    expect(mocks.copy).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLButtonElement>('.nb-chart-export-btn')!.disabled).toBe(false);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
