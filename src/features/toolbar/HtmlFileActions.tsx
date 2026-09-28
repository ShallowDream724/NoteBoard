import { useState } from 'react';
import { Copy, ExternalLink, FolderOpen, Save, SaveAll } from 'lucide-react';
import { openWithDefaultApp, revealInExplorer } from '../../core/ipc/commands';
import { useDocumentStore } from '../../stores/documentStore';
import { showToast } from '../../stores/toastStore';
import { ToolbarButton, ToolbarDivider } from './ToolbarComponents';

/** HTML stays in the shared source editor; file actions reuse its save barriers. */
export function HtmlFileActions({ docKey }: { docKey: string }) {
  const [busy, setBusy] = useState(false);
  const document = useDocumentStore(state => state.documents.get(docKey));
  const isFile = !docKey.startsWith('untitled:') && document?.externalStatus !== 'deleted';
  const run = (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    void Promise.resolve().then(action).catch(error => {
      showToast(`操作失败：${error instanceof Error ? error.message : String(error)}`, 'error');
    }).finally(() => setBusy(false));
  };
  const save = async () => (await import('../editor-code/orchestration/saveDocument')).saveDocument(docKey);
  const copySource = async () => {
    const { flushDocument } = await import('../session/documentSession');
    const snapshot = await flushDocument(docKey, 'export');
    if (snapshot?.content == null) throw new Error('源码尚未就绪，请稍后重试');
    await navigator.clipboard.writeText(snapshot.content);
    showToast('已复制 HTML 源码', 'success');
  };
  return <>
    <ToolbarButton icon={<ExternalLink size={15} />} label="浏览器打开" compactLabel
      title="用系统默认应用打开已保存的 HTML（通常为浏览器）" disabled={busy || !isFile}
      onClick={() => run(() => openWithDefaultApp(docKey))} />
    <ToolbarButton icon={<Save size={15} />} title="保存 HTML 源码" shortcut="Ctrl+S"
      disabled={busy || document?.readonly} onClick={() => run(save)} />
    <ToolbarButton icon={<Copy size={15} />} title="复制 HTML 源码" disabled={busy}
      onClick={() => run(copySource)} />
    <ToolbarButton icon={<SaveAll size={15} />} title="HTML 另存为" shortcut="Ctrl+Shift+S" disabled={busy}
      onClick={() => run(async () => (await import('../editor-code/orchestration/saveDocument')).saveAs(docKey, ''))} />
    <ToolbarButton icon={<FolderOpen size={15} />} label="打开所在文件夹" compactLabel
      title="在资源管理器中显示" disabled={busy || !isFile}
      onClick={() => run(() => revealInExplorer(docKey))} />
    <ToolbarDivider />
  </>;
}
