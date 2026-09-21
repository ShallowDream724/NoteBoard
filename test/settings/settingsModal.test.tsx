import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { SettingsModal } from '../../src/components/settings/SettingsModal';
import { TooltipProvider } from '../../src/components/Tooltip';
import { useSettingsStore } from '../../src/stores/settingsStore';
import { saveSettings } from '../../src/core/ipc/commands';

vi.mock('../../src/core/ipc/commands', () => ({ saveSettings: vi.fn().mockResolvedValue(undefined), listSystemFonts: vi.fn().mockResolvedValue([]) }));
vi.mock('../../src/stores/documentStore', () => ({ useDocumentStore: { getState: () => ({ syncSavePolicies: vi.fn() }) } }));

describe('canonical settings dialog', () => {
  it('exposes and persists image removal policy through the actual File & Save panel', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div'); document.body.appendChild(host);
    const root = createRoot(host);
    const render = (isOpen: boolean) => root.render(<TooltipProvider><SettingsModal isOpen={isOpen} onClose={() => {}}/></TooltipProvider>);
    try {
      await act(async () => render(true));
      const fileButton = Array.from(host.querySelectorAll('nav button')).find(button => button.textContent === '文件与保存')!;
      await act(async () => { fileButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      const label = Array.from(host.querySelectorAll('label')).find(item => item.textContent === '从正文移除图片时')!;
      const select = document.getElementById(label.htmlFor) as HTMLSelectElement;
      expect(select.value).toBe('ask');
      await act(async () => { select.value = 'trash'; select.dispatchEvent(new Event('change', { bubbles: true })); });
      expect(useSettingsStore.getState().settings.file.imageDeletionPolicy).toBe('trash');
      expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ file: expect.objectContaining({ imageDeletionPolicy: 'trash' }) }));
      await act(async () => render(false));
      await act(async () => render(true));
      expect(host.querySelector('select')?.value).toBe('trash');
      expect(host.textContent).toContain('不会替你保存正文');
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});
