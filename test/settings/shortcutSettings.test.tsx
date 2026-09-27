import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ShortcutsPanel } from '../../src/components/settings/ShortcutsPanel';
import { checkShortcutSystem } from '../../src/stores/shortcutDiagnosticsStore';
import { useSettingsStore } from '../../src/stores/settingsStore';
import { patchSettings, type ShortcutProbe } from '../../src/core/ipc/commands';
import { commandBindings } from '../../src/core/shortcutBindings';
import { SHORTCUT_BY_ID } from '../../src/core/shortcutCatalog';

vi.mock('../../src/core/ipc/commands', () => ({ patchSettings: vi.fn(), probeShortcuts: vi.fn() }));
vi.mock('../../src/stores/documentStore', () => ({ useDocumentStore: { getState: () => ({ syncSavePolicies: vi.fn() }) } }));
vi.mock('../../src/stores/shortcutDiagnosticsStore', async original => ({ ...await original<object>(), checkShortcutSystem: vi.fn() }));

let host: HTMLDivElement, root: Root;
const heading = SHORTCUT_BY_ID.get('markdown.heading1')!.label;
const findButton = (label: string) => {
  const button = Array.from(host.querySelectorAll('button')).find(item => item.getAttribute('aria-label') === label || item.textContent === label);
  expect(button, label).toBeTruthy(); return button!;
};
const click = async (label: string) => act(async () => { findButton(label).click(); });
const press = async (label: string, key: string, extra: KeyboardEventInit = {}) => act(async () => {
  findButton(label).dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true, ...extra }));
});
function mockPersistence() {
  vi.mocked(patchSettings).mockImplementation(async patch => {
    const current = useSettingsStore.getState().settings, overrides = { ...current.shortcuts?.overrides };
    for (const [id, values] of Object.entries(patch.shortcuts?.overrides ?? {})) { if (values === null) delete overrides[id]; else overrides[id] = values; }
    return { ...current, revision: current.revision + 1, shortcuts: { overrides } };
  });
}

beforeEach(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); mockPersistence();
  vi.mocked(checkShortcutSystem).mockImplementation(async bindings => bindings.map(binding => ({ binding, status: 'unclaimed', errorCode: null })));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<ShortcutsPanel/>));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  mockPersistence();
  await useSettingsStore.getState().setShortcuts(Object.fromEntries(Object.keys(useSettingsStore.getState().settings.shortcuts?.overrides ?? {}).map(id => [id, null])));
});

it('records on the first click, saves immediately and preserves other aliases until reset', async () => {
  await click(`修改${heading}`);
  expect(document.activeElement).toBe(findButton(`修改${heading}`));
  await press(`修改${heading}`, 'F8', { ctrlKey: true });
  expect(checkShortcutSystem).toHaveBeenCalledWith(['Ctrl+F8']);
  expect(patchSettings).toHaveBeenCalledWith({ shortcuts: { overrides: { 'markdown.heading1': ['Ctrl+F8', 'Ctrl+Alt+1'] } } });
  expect(commandBindings('markdown.heading1')).toEqual(['Ctrl+F8', 'Ctrl+Alt+1']);
  expect(host.textContent).toContain('已保存');
  expect(Array.from(host.querySelectorAll('button')).some(button => button.textContent === '保存')).toBe(false);
  await click(`恢复${heading}默认快捷键`);
  expect(commandBindings('markdown.heading1')).toEqual(['Ctrl+1', 'Ctrl+Alt+1']);
});

it('validates normal typing, reserved keys, internal conflicts and duplicate aliases as soon as they are pressed', async () => {
  await click(`修改${heading}`);
  await press(`修改${heading}`, 'a', { code: 'KeyA' });
  expect(host.textContent).toContain('避免覆盖正常输入');
  await press(`修改${heading}`, 'F4', { altKey: true });
  expect(host.textContent).toContain('操作系统保留');
  await press(`修改${heading}`, 's', { code: 'KeyS', ctrlKey: true });
  expect(host.textContent).toContain('冲突，请换一个组合键');
  await press(`修改${heading}`, '1', { code: 'Digit1', ctrlKey: true, altKey: true });
  expect(host.textContent).toContain('这个命令已使用该组合键');
  expect(patchSettings).not.toHaveBeenCalled(); expect(checkShortcutSystem).not.toHaveBeenCalled();
  await press(`修改${heading}`, 'Escape');
  expect(host.querySelector('[data-shortcut-recording]')).toBeNull();
  expect(commandBindings('markdown.heading1')).toEqual(['Ctrl+1', 'Ctrl+Alt+1']);
});

it('blocks occupied combinations and lets the user retry immediately without another click', async () => {
  vi.mocked(checkShortcutSystem).mockResolvedValueOnce([{ binding: 'Ctrl+F8', status: 'occupied', errorCode: 1409 }]);
  await click(`修改${heading}`); await press(`修改${heading}`, 'F8', { ctrlKey: true });
  expect(patchSettings).not.toHaveBeenCalled(); expect(host.textContent).toContain('已被系统或其他程序占用');
  expect(document.activeElement).toBe(findButton(`修改${heading}`));
  await press(`修改${heading}`, 'F9', { ctrlKey: true });
  expect(commandBindings('markdown.heading1')[0]).toBe('Ctrl+F9');
});

it('shows persistence failure, rolls back the binding and allows a retry', async () => {
  vi.mocked(patchSettings).mockRejectedValueOnce(new Error('disk unavailable'));
  await click(`修改${heading}`); await press(`修改${heading}`, 'F8', { ctrlKey: true });
  expect(host.textContent).toContain('未保存：');
  expect(commandBindings('markdown.heading1')).toEqual(['Ctrl+1', 'Ctrl+Alt+1']);
  await press(`修改${heading}`, 'F9', { ctrlKey: true });
  expect(commandBindings('markdown.heading1')[0]).toBe('Ctrl+F9');
});

it('does not save a stale system check after the user switches the recording target', async () => {
  let resolve!: (result: ShortcutProbe[]) => void;
  vi.mocked(checkShortcutSystem).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await click(`修改${heading}`); await press(`修改${heading}`, 'F8', { ctrlKey: true });
  expect(host.textContent).toContain('正在检查组合键');
  await click(`修改${SHORTCUT_BY_ID.get('markdown.heading2')!.label}`);
  await act(async () => resolve([{ binding: 'Ctrl+F8', status: 'unclaimed', errorCode: null }]));
  expect(patchSettings).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain('正在检查组合键');
});

it('supports manual fallback with immediate validation and Enter to save', async () => {
  await click(`修改${heading}`); await click('手动输入');
  const input = host.querySelector('input[aria-label^="手动输入"]') as HTMLInputElement;
  expect(document.activeElement).toBe(input);
  const type = async (value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await type('Ctrl+S'); expect(host.textContent).toContain('冲突，请换一个组合键');
  expect(patchSettings).not.toHaveBeenCalled();
  await type('Ctrl+F8');
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
  expect(commandBindings('markdown.heading1')).toEqual(['Ctrl+F8', 'Ctrl+Alt+1']);
  expect(document.activeElement).toBe(findButton(`修改${heading}`));
});

it('adds and removes individual aliases and keeps the key test available before the command list', async () => {
  await click(`为${heading}添加组合键`); await press(`为${heading}添加组合键`, 'F8', { ctrlKey: true });
  expect(commandBindings('markdown.heading1')).toEqual(['Ctrl+1', 'Ctrl+Alt+1', 'Ctrl+F8']);
  await click(`修改${heading}的组合键 3`); await click('移除');
  expect(commandBindings('markdown.heading1')).toEqual(['Ctrl+1', 'Ctrl+Alt+1']);
  const test = findButton('按键测试');
  expect(test.compareDocumentPosition(findButton(`修改${heading}`)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await act(async () => test.focus()); await press('按键测试', 's', { code: 'KeyS', ctrlKey: true });
  expect(host.textContent).toContain('已收到 Ctrl+S');
});
