import { useEffect, useState, type ReactNode } from 'react';
import { AlertCircle, Check, Copy } from 'lucide-react';
import type { ExportItem, LayoutIssue } from './model';

/** Sidebar feedback keeps layout decisions separate from content projection notes. */
export function ExportSidebarFeedback({ issues = [], items, notes, accepted, onNavigate, onAccept }: {
  issues?: LayoutIssue[]; items: ReadonlyMap<string, ExportItem>; notes: string[]; accepted: boolean;
  onNavigate: (id: string) => void; onAccept: (accepted: boolean) => void;
}) {
  const blocked = issues.some(issue => issue.blocking);
  return <>
    {!!issues.length && <section className="export-sidebar-section export-layout-issues" aria-label="排版检查"><h4>排版检查</h4>
      <div className="export-issue-list">{issues.slice(0, 100).map((issue, index) => <button key={index} className={`export-issue${issue.blocking ? ' is-blocking' : ''}`} onClick={() => onNavigate(issue.id)}><AlertCircle size={15}/><span>{items.get(issue.id)?.label && <strong>{items.get(issue.id)!.label}</strong>}<span>{issue.message}</span></span></button>)}</div>
      {blocked && <label className="export-check export-acceptance"><input type="checkbox" checked={accepted} onChange={event => onAccept(event.target.checked)}/><span>仍按预览导出<small>含缺失或裁切内容</small></span></label>}
    </section>}
    {!!notes.length && <section className="export-sidebar-section export-content-notes" role="status"><h4>内容处理说明</h4><div className="export-note">{notes.map(message => <p key={message}>{message}</p>)}</div></section>}
  </>;
}

/** Full diagnostics remain copyable; only the visible excerpt is bounded. */
export function ExportDiagnostics({ message, details, children }: { message: string; details: string; children?: ReactNode }) {
  const [copied, setCopied] = useState(false), [copyFailed, setCopyFailed] = useState(false);
  useEffect(() => { setCopied(false); setCopyFailed(false); }, [details]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(details); setCopied(true); setCopyFailed(false); }
    catch { setCopyFailed(true); }
  };
  return <div className="export-diagnostics">
    <span role="status" tabIndex={message ? 0 : undefined}>{message ? message.slice(0, 12000) : children}{message.length > 12000 ? '\n后续内容请复制查看。' : ''}{copyFailed ? '\n复制失败，可选中文字后按 Ctrl+C。' : ''}</span>
    {!!details && <button className="export-copy" title="复制完整报错" onClick={() => void copy()}>{copied ? <Check size={15}/> : <Copy size={15}/>} {copied ? '已复制' : '复制报错'}</button>}
  </div>;
}
