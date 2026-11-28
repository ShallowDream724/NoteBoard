import { useState } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { useDocumentStore } from '../../stores/documentStore';
import { reloadFromDisk, overwriteFromEditor } from '../external/externalChangeActions';
import './externalChangeBanner.css';

type Resolution = 'overwrite' | 'reload';

function ConflictActions({ docKey }: { docKey: string }) {
  const [pending, setPending] = useState<Resolution | null>(null);

  async function resolve(action: Resolution) {
    if (pending) return;
    setPending(action);
    try {
      if (action === 'overwrite') await overwriteFromEditor(docKey);
      else await reloadFromDisk(docKey);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="nb-external-change-actions" aria-busy={pending !== null}>
      <button type="button" className="nb-btn-secondary" disabled={pending !== null}
        title="将当前编辑内容写入磁盘" onClick={() => void resolve('overwrite')}>
        {pending === 'overwrite' ? '正在覆盖…' : '覆盖磁盘文件'}
      </button>
      <button type="button" className="nb-btn-secondary" disabled={pending !== null}
        title="用磁盘文件替换当前编辑内容" onClick={() => void resolve('reload')}>
        {pending === 'reload' ? '正在加载…' : '重新加载'}
      </button>
    </div>
  );
}

export function ExternalChangeBanner({ docKey }: { docKey: string }) {
  const status = useDocumentStore(s => s.getDocument(docKey)?.externalStatus);
  const dirty = useDocumentStore(s => s.getDocument(docKey)?.isDirty);
  if (status !== 'modified' && status !== 'renamed') return null;

  return (
    <div className="nb-external-change-banner">
      <span className="nb-external-change-message" role="status">
        {status === 'modified' ? <AlertTriangle size={16} aria-hidden="true" /> : <Info size={16} aria-hidden="true" />}
        <span>{status === 'renamed' ? '文件已被外部重命名。标签页标题已自动更新。'
          : dirty ? '文件已被外部程序修改。当前有未保存的更改。' : '文件已被外部程序修改。'}</span>
      </span>
      {status === 'modified' && <ConflictActions key={docKey} docKey={docKey} />}
    </div>
  );
}
