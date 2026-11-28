// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { OpenFileExternally } from '../../src/components/titlebar/OpenFileExternally';
import { EditorToolbar } from '../../src/features/toolbar/EditorToolbar';
import { textToolbarKind } from '../../src/core/fileFormats';
import { openWithDefaultApp } from '../../src/core/ipc/commands';
import { useWindowStore, type Tab } from '../../src/stores/windowStore';

vi.mock('../../src/core/ipc/commands', () => ({ openWithDefaultApp: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/components/Tooltip', () => ({ Tooltip: ({ children }: { children: ReactNode }) => children }));

it('keeps both HTML modes free of toolbar rows and opens the saved file through the title bar', async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const tab: Tab = { key: 'C:/notes/report.html', path: 'C:/notes/report.html', displayName: 'report.html', kind: 'code',
    language: 'html', isDirty: true, isPreview: false, viewMode: 'visual', externalStatus: null, isDetached: false };
  useWindowStore.getState().openTab(tab);
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<><EditorToolbar activeTab={tab} activeEditor={null}/><OpenFileExternally/></>));
    expect(host.children).toHaveLength(1);
    const browser = host.querySelector<HTMLButtonElement>('button[aria-label="在浏览器中打开"]')!;
    await act(async () => browser.click());
    expect(openWithDefaultApp).toHaveBeenCalledExactlyOnceWith(tab.path);
    await act(async () => root.render(<EditorToolbar activeTab={{...tab, viewMode:'source'}} activeEditor={null}/>));
    expect(host.children).toHaveLength(0);
  } finally { await act(async () => root.unmount()); }
});

it('chooses tools by what the file contains', () => {
  expect(['paper.txt', 'data.geojson', 'drawing.xaml'].map(textToolbarKind)).toEqual(['text', 'json', 'xml']);
  for (const file of ['app.ts', 'index.html', 'model.m', 'server.log', 'captions.srt', 'records.tsv', 'large.py', 'photo.svg']) {
    expect(textToolbarKind(file)).toBeUndefined();
  }
});
