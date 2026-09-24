import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ShortcutsPanel } from '../../src/components/settings/ShortcutsPanel';
import { checkShortcutSystem } from '../../src/stores/shortcutDiagnosticsStore';
import { useSettingsStore } from '../../src/stores/settingsStore';
import { patchSettings } from '../../src/core/ipc/commands';
import { commandBindings, setShortcutOverrides } from '../../src/core/shortcutBindings';
import { SHORTCUT_BY_ID } from '../../src/core/shortcutCatalog';

vi.mock('../../src/core/ipc/commands', () => ({ patchSettings: vi.fn(), probeShortcuts: vi.fn() }));
vi.mock('../../src/stores/documentStore', () => ({ useDocumentStore: { getState: () => ({ syncSavePolicies: vi.fn() }) } }));
vi.mock('../../src/stores/shortcutDiagnosticsStore', async original => ({ ...await original<object>(), checkShortcutSystem: vi.fn() }));

it('records, checks occupancy, persists a custom binding and restores the command defaults', async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  vi.mocked(patchSettings).mockImplementation(async patch => {
    const current = useSettingsStore.getState().settings, overrides = { ...current.shortcuts?.overrides };
    for (const [id, values] of Object.entries(patch.shortcuts?.overrides ?? {})) { if (values === null) delete overrides[id]; else overrides[id] = values; }
    return { ...current, revision: current.revision + 1, shortcuts: { overrides } };
  });
  const click = async (label: string) => act(async () => {
    const button = Array.from(host.querySelectorAll('button')).find(item => item.getAttribute('aria-label') === label || item.textContent === label);
    expect(button, label).toBeTruthy(); button!.click();
  });
  try {
    await act(async () => root.render(<ShortcutsPanel/>));
    const label = SHORTCUT_BY_ID.get('markdown.heading1')!.label;
    await click(`修改${label}`);
    await click('录入组合键 1');
    await act(async () => host.querySelector('input[aria-label="组合键 1"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8', code: 'F8', ctrlKey: true, bubbles: true, cancelable: true })));
    expect((host.querySelector('input[aria-label="组合键 1"]') as HTMLInputElement).value).toBe('Ctrl+F8');
    vi.mocked(checkShortcutSystem).mockResolvedValue([{ binding: 'Ctrl+F8', status: 'occupied', errorCode: 1409 }]);
    await click('保存'); expect(patchSettings).not.toHaveBeenCalled(); expect(host.textContent).toContain('已被系统或其他程序占用');
    vi.mocked(checkShortcutSystem).mockResolvedValue([{ binding: 'Ctrl+F8', status: 'unclaimed', errorCode: null }]);
    await click('保存'); expect(commandBindings('markdown.heading1')).toContain('Ctrl+F8');
    expect(patchSettings).toHaveBeenCalledWith({ shortcuts: { overrides: { 'markdown.heading1': ['Ctrl+F8', 'Ctrl+Alt+1'] } } });
    await click(`恢复${label}默认快捷键`); expect(commandBindings('markdown.heading1')).toEqual(['Ctrl+1','Ctrl+Alt+1']);
  } finally { await act(async () => root.unmount()); host.remove(); setShortcutOverrides({}); }
});
