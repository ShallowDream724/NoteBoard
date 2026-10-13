import { showToast } from '../../stores/toastStore';

/** Window-level native drops stay independent of lazily loaded editor runtimes. */
export interface FileDropPoint { x: number; y: number }
type FileDropZone = 'workspace' | 'insert' | 'open';
export interface NativeFileDropTarget {
  zone: Exclude<FileDropZone, 'open'>;
  accepts?(paths: readonly string[]): boolean;
  hover(paths: readonly string[], point: FileDropPoint): boolean;
  drop(paths: readonly string[], point: FileDropPoint): boolean;
  clear(): void;
}
export type NativeFileDrop = { type: 'enter' | 'drop'; paths: string[]; position: FileDropPoint }
  | { type: 'over'; position: FileDropPoint } | { type: 'leave' };
const targets = new Set<NativeFileDropTarget>();
let hoveringPaths: readonly string[] = [];
let recentDrop: { names: string[]; at: number } | null = null;
export const isImageFilePath = (path: string): boolean => /\.(png|jpe?g|webp|gif|svg|bmp|avif|ico)$/i.test(path);
export function nativeDropToCssPoint(point: FileDropPoint, pixelRatio = window.devicePixelRatio): FileDropPoint {
  const scale = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  return { x: point.x / scale, y: point.y / scale };
}
/** Read the visible surface, never a rectangle hidden underneath a popup. */
function zoneAtPoint(point: FileDropPoint): FileDropZone | undefined {
  const hit = document.elementFromPoint(point.x, point.y);
  if (!hit || hit.closest('[inert], [role="dialog"], [role="menu"]')) return;
  const zone = hit.closest<HTMLElement>('[data-file-drop-zone]')?.dataset.fileDropZone;
  if (zone === 'workspace' || zone === 'insert' || zone === 'open') return zone;
  return hit.closest('.ProseMirror') ? 'insert' : undefined;
}
export function isNativeFileOpenDropPoint(point: FileDropPoint): boolean {
  return zoneAtPoint(nativeDropToCssPoint(point)) === 'open';
}
export function registerNativeFileDropTarget(target: NativeFileDropTarget): () => void {
  targets.add(target);
  return () => { target.clear(); targets.delete(target); };
}
export function clearNativeFileDropTargets(): void {
  hoveringPaths = [];
  for (const target of targets) target.clear();
}
/** A surface owns rejection too: unsupported document drops must never open tabs. */
export function routeNativeFileDrop(event: NativeFileDrop): boolean {
  const clear = () => { for (const target of targets) target.clear(); };
  if (event.type === 'leave') { hoveringPaths = []; clear(); return false; }
  if (event.type === 'enter') hoveringPaths = event.paths;
  const paths = event.type === 'drop' ? event.paths : hoveringPaths;
  if (event.type === 'drop') hoveringPaths = [];
  if (!paths.length) { clear(); return false; }
  const point = nativeDropToCssPoint(event.position);
  const zone = zoneAtPoint(point);
  for (const target of targets) {
    if (target.zone !== zone) continue;
    if (!(target.accepts ? target.accepts(paths) : paths.every(isImageFilePath))) continue;
    if (!(event.type === 'drop' ? target.drop(paths, point) : target.hover(paths, point))) continue;
    // Keep the active hover alive for folder dwell expansion, but remove every
    // indicator once the drop is claimed (including the editor's own indicator).
    for (const other of targets) if (other !== target || event.type === 'drop') other.clear();
    if (event.type === 'drop') recentDrop = { names: paths.map(path => path.split(/[\\/]/).pop()!.toLowerCase()), at: Date.now() };
    return true;
  }
  clear();
  if (zone === 'workspace' || zone === 'insert') {
    if (event.type === 'drop') {
      recentDrop = { names: paths.map(path => path.split(/[\\/]/).pop()!.toLowerCase()), at: Date.now() };
      showToast(zone === 'workspace' ? '请把文件放到工作区内的文件或文件夹上'
        : paths.every(isImageFilePath) ? '请把图片放到可编辑的正文或图片空位中'
          : '正文支持拖入图片；其他文件请拖到顶部标签栏打开', 'info');
    }
    return true;
  }
  return false;
}
/** WebView native drag handling normally suppresses DOM drop; guard duplicate delivery too. */
export function isNativeFileDropDuplicate(files: readonly File[]): boolean {
  const names = files.map(file => file.name.toLowerCase());
  const same = (paths: readonly string[]) => names.length === paths.length && names.every((name, index) => name === paths[index].split(/[\\/]/).pop()!.toLowerCase());
  return same(hoveringPaths) || Boolean(recentDrop && Date.now() - recentDrop.at < 1000 && same(recentDrop.names));
}
