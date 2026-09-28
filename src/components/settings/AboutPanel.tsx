// Canonical settings panel; SettingsModal owns navigation and dismissal.
import { RefreshCw, ExternalLink, ChevronRight } from 'lucide-react';
import * as ipc from '../../core/ipc/commands';
import { useUpdateStore } from '../../stores/updateStore';
import { APP_VERSION } from '../../core/version';
import './about.css';

export function AboutPanel() {
  const { checking, checkForUpdates, hasUpdate, updateResult, checkError, openModal } = useUpdateStore();
  return <div className="nb-about">
    <img src="/logo.ico" alt="" width={52} height={52} />
    <div className="nb-about-identity"><h2>NoteBoard</h2><p>笔记、文档与自由画板</p></div>
    <p className="nb-about-version">版本 v{APP_VERSION} <span>·</span> GPL-3.0</p>
    {hasUpdate && <div className="nb-about-update"><span>新版本 v{updateResult?.latestVersion}</span><button type="button" onClick={openModal}>查看更新内容<ChevronRight size={14} aria-hidden="true" /></button></div>}
    {!checking && checkError && <p role="status" className="nb-about-error">{checkError}</p>}
    <div className="nb-about-actions">
      <button type="button" disabled={checking} onClick={() => void checkForUpdates(false)}><RefreshCw size={14} className={checking ? 'nb-about-spinner' : undefined} aria-hidden="true" />{checking ? '正在检查' : '检测更新'}</button>
      <button type="button" onClick={() => void ipc.openExternalUrl('https://github.com/ShallowDream724/NoteBoard').catch(error => console.error('无法打开 GitHub 链接:', error))}><ExternalLink size={14} aria-hidden="true" />GitHub 仓库</button>
    </div>
  </div>;
}
