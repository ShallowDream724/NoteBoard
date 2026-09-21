import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore } from '../../stores/settingsStore';

export function ExportPanel() {
  const path = useSettingsStore(s => s.settings.export?.pandocPath ?? '');
  const setExport = useSettingsStore(s => s.setExport);
  const [status, setStatus] = useState('');
  const [draft, setDraft] = useState(path);
  useEffect(() => setDraft(path), [path]);
  const check = async () => {
    const result = await invoke<{ available: boolean; version: string }>('pandoc_status', { path });
    setStatus(result.available ? result.version : '未找到 Pandoc');
  };
  return <section><h3 style={{ marginTop: 0 }}>Pandoc</h3>
    <p style={{ color: 'var(--editor-text-muted)', lineHeight: 1.6 }}>用于导出 Word、HTML 和 LaTeX。PDF 无需安装。</p>
    <label>Pandoc 路径<input aria-label="Pandoc 路径" value={draft} placeholder="自动查找" onChange={e => setDraft(e.target.value)} onBlur={() => { if (draft !== path) void setExport({ pandocPath: draft }).catch(error => setStatus(String(error))); }}
      style={{ display: 'block', width: '100%', margin: '10px 0', padding: 9, border: '1px solid var(--editor-border)', borderRadius: 5, background: 'var(--editor-bg)', color: 'inherit' }}/></label>
    <div style={{ display: 'flex', gap: 8 }}>
      <button type="button" className="nb-btn-secondary" onClick={async () => { const selected = await open({ filters: [{ name: 'Pandoc', extensions: ['exe'] }] }); if (typeof selected === 'string') await setExport({ pandocPath: selected }); }}>选择程序</button>
      <button type="button" className="nb-btn-secondary" onClick={() => void check().catch(error => setStatus(String(error)))}>检查</button>
      <button type="button" className="nb-btn-secondary" onClick={() => void invoke('open_external_url', { url: 'https://pandoc.org/installing.html' })}>下载 Pandoc</button>
    </div><p role="status">{status}</p>
  </section>;
}
