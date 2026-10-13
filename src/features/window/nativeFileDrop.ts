import { isNativeFileOpenDropPoint, routeNativeFileDrop, type NativeFileDrop } from '../../core/editor/fileDropTargets';
import { useLayoutStore } from '../../stores/layoutStore';
import { showToast } from '../../stores/toastStore';

/** Opening files is an explicit drop destination, never a failed insertion fallback. */
export async function handleWindowFileDrop(event: NativeFileDrop, open: (paths: string[]) => Promise<void>): Promise<void> {
  const consumed = routeNativeFileDrop(event);
  const opensFiles = event.type !== 'leave' && !consumed && isNativeFileOpenDropPoint(event.position);
  useLayoutStore.getState().setIsDraggingFile((event.type === 'enter' || event.type === 'over') && opensFiles);
  if (event.type !== 'drop' || !event.paths.length || consumed) return;
  if (opensFiles) await open(event.paths);
  else showToast('请将文件拖到顶部标签栏或主页打开', 'info');
}
