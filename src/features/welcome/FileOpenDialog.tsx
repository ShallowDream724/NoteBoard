import { useState } from 'react';
import { DialogShell, showTransientDialog } from '../../components/TransientDialog';
import { pathExists } from '../../core/ipc/commands';
import { normalizeFileInput } from './fileInput';

type Browse = () => Promise<string[] | null>;
function FileOpenChoice({ browse, browseFolder, finish }: { browse: Browse; browseFolder: Browse; finish: (paths: string[] | null) => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const browseFiles = async (choose: Browse = browse) => {
    setBusy(true); setError('');
    try { const paths = await choose(); if (paths?.length) finish(paths); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  };
  const submit = async () => {
    if (!value.trim()) { await browseFiles(); return; }
    setBusy(true); setError('');
    try {
      const path = normalizeFileInput(value);
      const result = await pathExists(path);
      if (!result.exists) throw new Error('找不到此文件或文件夹，请检查路径');
      finish([path]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return <DialogShell title="打开文件或文件夹" description="粘贴路径即可打开，也可以浏览本地文件或文件夹。" onDismiss={() => finish(null)}>
    <form onSubmit={(event) => { event.preventDefault(); if (!busy) void submit(); }}>
      <input aria-label="文件或文件夹路径" value={value} autoFocus placeholder="C:\笔记\文档.md 或 C:\笔记"
        onChange={(event) => { setValue(event.target.value); setError(''); }}
        style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 6,
          border: '1px solid var(--editor-border)', background: 'var(--editor-bg)', color: 'var(--editor-text)' }} />
      {error && <p role="alert" style={{ fontSize: 13, color: 'var(--error-500)' }}>{error}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
        <button type="button" className="nb-btn-secondary" disabled={busy} onClick={() => void browseFiles(browseFolder)}>浏览文件夹…</button>
        <button type="button" className="nb-btn-secondary" disabled={busy} onClick={() => void browseFiles()}>浏览文件…</button>
        <button type="submit" className="nb-btn-primary" disabled={busy}>{busy ? '正在打开…' : '打开'}</button>
      </div>
    </form>
  </DialogShell>;
}
export function requestFilePaths(browse: Browse, browseFolder: Browse): Promise<string[] | null> {
  return showTransientDialog((finish) => <FileOpenChoice browse={browse} browseFolder={browseFolder} finish={finish} />);
}
