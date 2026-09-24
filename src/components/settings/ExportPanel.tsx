import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore } from '../../stores/settingsStore';
import { usePandocStatus } from '../../features/export/usePandocStatus';

export function ExportPanel() {
  const path = useSettingsStore(s => s.settings.export?.pandocPath ?? '');
  const setExport = useSettingsStore(s => s.setExport);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(path);
  const detection = usePandocStatus(path);
  useEffect(() => setDraft(path), [path]);
  const savePath = async (value: string) => {
    setError('');
    try { await setExport({ pandocPath: value.trim() }); }
    catch (error) { setError(String(error)); }
  };
  return <section><h3 style={{ marginTop: 0 }}>Pandoc</h3>
    <p style={{ color: 'var(--editor-text-secondary)', lineHeight: 1.6 }}>用于导出 Word、HTML 和 LaTeX。PDF 无需安装。</p>
    <label>Pandoc 路径<input aria-label="Pandoc 路径" value={draft} placeholder="留空时自动查找"
      onChange={e => setDraft(e.target.value)} onBlur={() => { if (draft.trim() !== path) void savePath(draft); }}
      style={{ display: 'block', boxSizing: 'border-box', width: '100%', margin: '10px 0', padding: 9, border: '1px solid var(--editor-border)', borderRadius: 6, background: 'var(--editor-bg)', color: 'inherit' }}/></label>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <button type="button" className="nb-btn-secondary" onClick={() => {
        void open({ filters: [{ name: 'Pandoc', extensions: ['exe'] }] }).then(selected => {
          if (typeof selected === 'string') return savePath(selected);
        }).catch(error => setError(String(error)));
      }}>选择程序</button>
      <button type="button" className="nb-btn-secondary" disabled={detection.checking} onClick={() => {
        if (draft.trim() !== path) void savePath(draft);
        else detection.refresh();
      }}>检查</button>
      {path && <button type="button" className="nb-btn-secondary" onClick={() => { setDraft(''); void savePath(''); }}>自动查找</button>}
      <button type="button" className="nb-btn-secondary" onClick={() => {
        void invoke('open_external_url', { url: 'https://pandoc.org/installing.html' }).catch(error => setError(String(error)));
      }}>下载 Pandoc</button>
    </div>
    <div role="status" style={{ marginTop: 16, lineHeight: 1.6, userSelect: 'text' }}>
      {detection.checking ? '正在查找 Pandoc…' : detection.error || (detection.result?.available
        ? <><span>{path ? '当前程序' : '自动找到'} · {detection.result.version}</span>
          <code style={{ display: 'block', marginTop: 4, fontSize: 12, color: 'var(--editor-text-secondary)', overflowWrap: 'anywhere' }}>{detection.result.resolvedPath}</code></>
        : path ? '所选程序无法运行，请检查路径。' : '未找到 Pandoc，请选择程序或安装。')}
    </div>
    {error && <p role="alert" style={{ color: 'var(--error-500)', overflowWrap: 'anywhere', userSelect: 'text' }}>{error}</p>}
  </section>;
}
