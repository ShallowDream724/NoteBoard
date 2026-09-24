import { useEffect, useRef, useState } from 'react';
import { ExternalLink, FolderOpen, Copy, Check, CircleCheck } from 'lucide-react';
import { getFileIcon } from './FileIcon';
import * as ipc from '../core/ipc/commands';
import { extFromPath } from '../core/docKind';
import { useDocumentStore } from '../stores/documentStore';
import { showToast } from '../stores/toastStore';
import './fileHandoff.css';

interface Props { filePath: string; fileName?: string; exportNotice?: { warnings?: string }; }
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** A file handoff shares actions for ordinary attachments and completed exports. */
export function UnsupportedView({ filePath, fileName, exportNotice }: Props) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const fileSize = useDocumentStore(s => s.documents.get(filePath)?.size);
  const name = fileName || filePath.split(/[\\/]/).pop() || filePath;
  const ext = extFromPath(filePath).toUpperCase() || '文件';
  const perform = async (action: () => Promise<unknown>) => {
    try { await action(); } catch (error) { showToast(`无法完成操作：${String(error)}`, 'error'); }
  };
  const copy = () => perform(async () => {
    await navigator.clipboard.writeText(filePath);
    setCopied(true); clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  });
  return <div className="nb-file-handoff"><section className="nb-file-card" aria-label={exportNotice ? '导出成功' : '文件信息'}>
    {exportNotice && <div className="nb-file-success" role="status"><CircleCheck size={17}/>导出成功</div>}
    <div className="nb-file-icon">{getFileIcon(filePath, { size: 32 })}</div>
    <div className="nb-file-identity"><h2>{name}</h2><div className="nb-file-meta"><span>{ext}</span>{fileSize !== undefined && <span>{formatFileSize(fileSize)}</span>}</div></div>
    <div className="nb-file-description">
      {exportNotice ? <><p>文件已保存。</p><p>可以用系统默认程序查看，或打开所在文件夹。</p></> : <><p>这是一个 {ext} 文件。</p><p>NoteBoard 可编辑 Markdown、文本与画板。</p><p>请使用系统默认程序查看此文件。</p></>}
      {exportNotice?.warnings && <p className="nb-file-warning">{exportNotice.warnings}</p>}
    </div>
    <div className="nb-file-actions">
      <button type="button" className="nb-btn-primary" onClick={() => void perform(() => ipc.openWithDefaultApp(filePath))}><ExternalLink size={16}/>用系统默认程序打开</button>
      <div><button type="button" className="nb-btn-secondary" onClick={() => void perform(() => ipc.revealInExplorer(filePath))}><FolderOpen size={15}/>在文件管理器中定位</button>
        <button type="button" className="nb-btn-secondary" onClick={() => void copy()}>{copied ? <Check size={15}/> : <Copy size={15}/>}<span>{copied ? '已复制路径' : '复制完整路径'}</span></button></div>
    </div>
  </section></div>;
}
