import { useEffect, useRef, useState } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { ExternalLink, FolderOpen, Copy, Check, CircleCheck, ChevronDown } from 'lucide-react';
import { getFileIcon } from './FileIcon';
import * as ipc from '../core/ipc/commands';
import type { Encoding } from '../core/ipc/types';
import { extFromPath } from '../core/docKind';
import { useDocumentStore } from '../stores/documentStore';
import { showToast } from '../stores/toastStore';
import './fileHandoff.css';
import { formatFileSize } from '../core/formatFileSize';
import { openDocumentWithEncoding } from '../features/editor-code/orchestration/openDocument';
import { EncodingChoices } from './statusbar/EncodingChoices';

interface Props { filePath: string; fileName?: string; exportNotice?: { warnings?: string }; encodingRequired?: boolean; }

/** A file handoff shares actions for ordinary attachments and completed exports. */
export function UnsupportedView({ filePath, fileName, exportNotice, encodingRequired }: Props) {
  const [copied, setCopied] = useState(false);
  const [opening, setOpening] = useState(false);
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
  const openWithEncoding = (encoding: Encoding) => perform(async () => {
    setOpening(true);
    try { await openDocumentWithEncoding(filePath, encoding); }
    finally { setOpening(false); }
  });
  return <div className="nb-file-handoff"><section className="nb-file-card" aria-label={exportNotice ? '导出成功' : '文件信息'}>
    {exportNotice && <div className="nb-file-success" role="status"><CircleCheck size={17}/>导出成功</div>}
    <div className="nb-file-icon">{getFileIcon(filePath, { size: 32 })}</div>
    <div className="nb-file-identity"><h2>{name}</h2><div className="nb-file-meta"><span>{ext}</span>{fileSize !== undefined && <span>{formatFileSize(fileSize)}</span>}</div></div>
    <div className="nb-file-description">
      {exportNotice ? <><p>文件已保存。</p><p>可以用系统默认程序查看，或打开所在文件夹。</p></>
        : encodingRequired ? <p>无法自动识别文件编码。请选择编码后打开。</p>
        : <><p>此格式使用系统默认程序打开。</p><p>也可以定位到文件所在位置。</p></>}
      {exportNotice?.warnings && <p className="nb-file-warning">{exportNotice.warnings}</p>}
    </div>
    <div className="nb-file-actions">
      {encodingRequired && <Menu.Root modal={false}>
        <Menu.Trigger className="nb-btn-primary" disabled={opening}>
          {opening ? '正在打开…' : '通过编码打开'}<ChevronDown size={15} />
        </Menu.Trigger>
        <Menu.Portal><Menu.Content className="nb-status-menu" sideOffset={4} collisionPadding={8} aria-label="通过编码打开" data-shortcuts-suspended>
          <EncodingChoices onChoose={encoding => void openWithEncoding(encoding)} />
        </Menu.Content></Menu.Portal>
      </Menu.Root>}
      <button type="button" className={encodingRequired ? 'nb-btn-secondary' : 'nb-btn-primary'} onClick={() => void perform(() => ipc.openWithDefaultApp(filePath))}><ExternalLink size={16}/>用系统默认程序打开</button>
      <div><button type="button" className="nb-btn-secondary" onClick={() => void perform(() => ipc.revealInExplorer(filePath))}><FolderOpen size={15}/>在文件管理器中定位</button>
        <button type="button" className="nb-btn-secondary" onClick={() => void copy()}>{copied ? <Check size={15}/> : <Copy size={15}/>}<span>{copied ? '已复制路径' : '复制完整路径'}</span></button></div>
    </div>
  </section></div>;
}
