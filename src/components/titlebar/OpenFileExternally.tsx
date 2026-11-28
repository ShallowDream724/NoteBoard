import { useState } from 'react';
import { ExternalLink, Globe } from 'lucide-react';
import { getFileFormat } from '../../core/fileFormats';
import { openWithDefaultApp } from '../../core/ipc/commands';
import { useWindowStore } from '../../stores/windowStore';
import { useDocumentStore } from '../../stores/documentStore';
import { showToast } from '../../stores/toastStore';
import { Tooltip } from '../Tooltip';

export function OpenFileExternally() {
  const tab = useWindowStore(state => state.activeTab());
  const available = useDocumentStore(state => !!tab && state.getDocument(tab.key)?.externalStatus !== 'deleted');
  const [opening, setOpening] = useState(false);
  if (!tab?.path || !available || tab.toolKind || !['code', 'pdf', 'image'].includes(tab.kind)) return null;
  const path = tab.path;
  const html = getFileFormat(path).preview === 'html';
  const label = html ? '在浏览器中打开' : '用系统默认应用打开';
  const open = async () => {
    if (opening) return;
    setOpening(true);
    try { await openWithDefaultApp(path); }
    catch (error) { showToast(`打开失败：${error instanceof Error ? error.message : error}`, 'error'); }
    finally { setOpening(false); }
  };
  return <Tooltip content={tab.isDirty ? `${label}（磁盘上已保存的版本）` : label} side="bottom">
    <button type="button" className="titlebar-action" aria-label={label} disabled={opening}
      onClick={() => void open()}>{html ? <Globe size={16}/> : <ExternalLink size={16}/>}</button>
  </Tooltip>;
}
