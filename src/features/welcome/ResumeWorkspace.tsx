import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { workspaceHistory, subscribeWorkspaceHistory } from '../session/workspaceHistory';
import { showToast } from '../../stores/toastStore';

export function ResumeWorkspace() {
  const [entries, setEntries] = useState(workspaceHistory);
  const [busy, setBusy] = useState(false);
  useEffect(() => subscribeWorkspaceHistory(() => setEntries(workspaceHistory())), []);
  if (!entries.length) return null;
  return <details className="nb-workspace-recents">
    <summary>继续工作区</summary>
    <div>{entries.map(entry => <button key={entry.root} type="button" disabled={busy}
      title={entry.root} onClick={async () => {
        setBusy(true);
        try {
          const { resumeWorkspace } = await import('../session/closedWindowSession');
          await resumeWorkspace(entry.window);
        } catch (error) { showToast(`无法恢复工作区：${String(error)}`, 'error'); }
        finally { setBusy(false); }
      }}><strong>{entry.root.split(/[\\/]/).filter(Boolean).at(-1) || entry.root}</strong>
      <small>{entry.root}</small><ChevronRight size={14}/></button>)}</div>
  </details>;
}
