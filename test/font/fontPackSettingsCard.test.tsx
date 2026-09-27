import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { FontPackSettingsCard } from '../../src/components/settings/FontPackSettingsCard';
import { useFontPackStore } from '../../src/stores/fontPackStore';

it('keeps installed font controls compact until management is explicitly opened', async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  useFontPackStore.setState({ status: { id: 'core', version: '1', state: 'ready', installedSizeBytes: 1, downloadSizeBytes: 1, downloadUrl: '', faces: [] } });
  const host = document.createElement('div'); const root = createRoot(host);
  try {
    await act(async () => root.render(<FontPackSettingsCard />));
    expect(host.textContent).toContain('代码与纯文本正在使用推荐字体');
    expect(host.textContent).not.toContain('导入并使用');
    expect(host.textContent).not.toContain('安装后约');
    await act(async () => { (host.querySelector('.nb-font-pack-manage') as HTMLButtonElement).click(); });
    expect(host.textContent).toContain('删除字体包');
    expect(host.textContent).toContain('导入并使用');
  } finally { await act(async () => root.unmount()); }
});
