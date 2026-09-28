import { openDocument } from '../editor-code/orchestration/openDocument';
import { refreshExplorerAfterWrite } from '../explorer/refreshAfterWrite';
import { probeDocument, openWithDefaultApp } from '../../core/ipc/commands';
import { languageFromPath } from '../../core/docKind';
import { formatFileSize } from '../../core/formatFileSize';
import { showToast } from '../../stores/toastStore';

/** Saving is already committed. Metadata or presentation failures cannot undo the export. */
export async function presentExportedFile(path: string, warnings?: string): Promise<void> {
  const name = path.split(/[\\/]/).pop() ?? path;
  let size: number | undefined;
  try {
    const file = await probeDocument(path);
    if (file.exists && !file.isDir) size = file.size;
  } catch (error) {
    console.warn('读取导出文件大小失败:', error);
  }
  showToast(`导出成功：${name}${size === undefined ? '' : `（${formatFileSize(size)}）`}`, 'success');
  if (warnings) showToast(`导出提示：${warnings}`, 'warning', 8000);

  // Refresh only an existing containing workspace, independently of opening the saved file.
  void refreshExplorerAfterWrite(path).catch(error => console.warn('刷新导出目录失败:', error));
  const opensExternally = languageFromPath(path) === 'html';
  try {
    if (opensExternally) {
      await openWithDefaultApp(path);
      return;
    }
    const outcome = await openDocument(path, { exportNotice: { warnings }, explorer: 'preserve' });
    if (outcome !== 'failed') return;
  } catch (error) {
    console.error('显示导出文件失败:', error);
  }
  showToast(opensExternally
    ? '文件已导出，可在保存位置打开。暂时无法启动默认应用。'
    : '文件已导出，可在保存位置打开。暂时无法在标签页中显示。', 'warning');
}
