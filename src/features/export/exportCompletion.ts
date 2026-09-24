import { openDocument } from '../editor-code/orchestration/openDocument';
import { refreshExplorerAfterWrite } from '../explorer/refreshAfterWrite';
import { revealExplorerFile } from '../explorer/explorerActions';
import { useDocumentStore } from '../../stores/documentStore';
import { useWindowStore } from '../../stores/windowStore';
import { showToast } from '../../stores/toastStore';

/** Saving is already committed. A UI/reveal failure must never report that the export failed. */
export async function presentExportedFile(path: string, warnings?: string): Promise<void> {
  const name = path.split(/[\\/]/).pop() ?? path;
  showToast(`导出成功：${name}`, 'success');
  if (warnings) showToast(`导出提示：${warnings}`, 'warning', 8000);
  try {
    await refreshExplorerAfterWrite(path);
    const outcome = await openDocument(path, { exportNotice: { warnings } });
    if (outcome === 'failed') return;
    const key = useWindowStore.getState().activeKey;
    const doc = key ? useDocumentStore.getState().documents.get(key) : undefined;
    if (doc?.dirPath) await revealExplorerFile(doc.key, doc.dirPath, () => useWindowStore.getState().activeKey === key);
  } catch (error) {
    console.error('显示导出文件失败:', error);
    showToast('文件已导出，可在保存位置打开。资源管理器暂时未能更新。', 'warning');
  }
}
