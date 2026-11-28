import { useRef, useState } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { useDocumentStore } from '../../stores/documentStore';
import { showToast } from '../../stores/toastStore';
import './externalChangeBanner.css';

type Action = 'overwrite' | 'reload' | 'compare';
type DiffDialogComponent = typeof import('./ExternalChangeDiffDialog').default;

function ConflictActions({ docKey, canCompare }: { docKey: string; canCompare: boolean }) {
  const [pending, setPending] = useState<Action | null>(null);
  const [DiffDialog, setDiffDialog] = useState<DiffDialogComponent | null>(null);
  const compareButton = useRef<HTMLButtonElement>(null);

  async function run(action: Action) {
    if (pending || DiffDialog) return;
    setPending(action);
    try {
      if (action === 'compare') {
        const { default: component } = await import('./ExternalChangeDiffDialog');
        setDiffDialog(() => component);
      } else {
        const { reloadFromDisk, overwriteFromEditor } = await import('./externalChangeActions');
        if (action === 'overwrite') await overwriteFromEditor(docKey);
        else await reloadFromDisk(docKey);
      }
    } catch (error) {
      console.error('加载文件冲突操作失败:', error);
      showToast('无法打开此操作，请重试。', 'error');
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      <div className="nb-external-change-actions" aria-busy={pending !== null}>
        {canCompare && (
          <button ref={compareButton} type="button" className="nb-btn-secondary" disabled={pending !== null}
            aria-haspopup="dialog" onClick={() => void run('compare')}>
            {pending === 'compare' ? '正在打开…' : '查看差异'}
          </button>
        )}
        <button type="button" className="nb-btn-secondary" disabled={pending !== null || !!DiffDialog}
          title="将当前编辑内容写入磁盘" onClick={() => void run('overwrite')}>
          {pending === 'overwrite' ? '正在覆盖…' : '覆盖磁盘文件'}
        </button>
        <button type="button" className="nb-btn-secondary" disabled={pending !== null || !!DiffDialog}
          title="用磁盘文件替换当前编辑内容" onClick={() => void run('reload')}>
          {pending === 'reload' ? '正在加载…' : '重新加载'}
        </button>
      </div>
      {DiffDialog && (
        <DiffDialog docKey={docKey} restoreFocusTo={compareButton} onDismiss={() => setDiffDialog(null)} />
      )}
    </>
  );
}

export function ExternalChangeBanner({ docKey }: { docKey: string }) {
  const status = useDocumentStore(s => s.getDocument(docKey)?.externalStatus);
  const dirty = useDocumentStore(s => s.getDocument(docKey)?.isDirty);
  const kind = useDocumentStore(s => s.getDocument(docKey)?.kind);
  if (status !== 'modified' && status !== 'renamed') return null;

  return (
    <div className="nb-external-change-banner">
      <span className="nb-external-change-message" role="status">
        {status === 'modified' ? <AlertTriangle size={16} aria-hidden="true" /> : <Info size={16} aria-hidden="true" />}
        <span>{status === 'renamed' ? '文件已被外部重命名。标签页标题已自动更新。'
          : dirty ? '文件已被外部程序修改。当前有未保存的更改。' : '文件已被外部程序修改。'}</span>
      </span>
      {status === 'modified' && <ConflictActions key={docKey} docKey={docKey} canCompare={kind === 'markdown' || kind === 'code'} />}
    </div>
  );
}
