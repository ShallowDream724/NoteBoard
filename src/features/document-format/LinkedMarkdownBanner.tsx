import { useCallback, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, ExternalLink, RefreshCw } from 'lucide-react';
import { acceptLinkedMarkdownOverwrite, getLinkedMarkdownConflict, subscribeLinkedMarkdownConflicts, unlinkMarkdownAssociation } from './linkedMarkdownUpdates';
import './linkedMarkdownBanner.css';

export function LinkedMarkdownBanner({ docKey }: { docKey: string }) {
  const read = useCallback(() => getLinkedMarkdownConflict(docKey), [docKey]);
  const conflict = useSyncExternalStore(subscribeLinkedMarkdownConflicts, read, read);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  if (!conflict) return null;
  const busy = busyKey === docKey, message = error?.key === docKey ? error.message : conflict.message;
  const unlink = conflict.reason === 'unreadable';
  const overwrite = async () => {
    setBusyKey(docKey); setError(null);
    try {
      if (!await (unlink ? unlinkMarkdownAssociation(docKey) : acceptLinkedMarkdownOverwrite(docKey))) return;
      const { saveDocument } = await import('../editor-code/orchestration/saveDocument');
      await saveDocument(docKey);
    } catch (cause) { setError({ key: docKey, message: cause instanceof Error ? cause.message : '更新失败，请重试' }); }
    finally { setBusyKey(current => current === docKey ? null : current); }
  };
  const openMarkdown = async () => {
    try { const { openDocument } = await import('../editor-code/orchestration/openDocument'); await openDocument(conflict.markdownPath); }
    catch (cause) { setError({ key: docKey, message: cause instanceof Error ? cause.message : '无法打开关联 Markdown' }); }
  };
  return <div className="nb-linked-markdown-banner" role="status" aria-live="polite">
    <AlertTriangle size={15} aria-hidden="true"/>
    <span className="nb-linked-markdown-message" title={message}>{message}</span>
    <div className="nb-linked-markdown-actions">
      <button type="button" title="打开关联 Markdown 查看" disabled={busy} onClick={() => { void openMarkdown(); }}><ExternalLink size={13}/>打开 Markdown 查看</button>
      <button type="button" title={unlink ? '解除 Markdown 关联并保存 NB' : '保留 NB 并更新关联 Markdown'} disabled={busy} onClick={() => { void overwrite(); }}><RefreshCw size={13}/>{busy ? '正在更新…' : unlink ? '解除关联并保存' : '保留 NB 并更新 Markdown'}</button>
    </div>
  </div>;
}
