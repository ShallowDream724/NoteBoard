/** Window-level native drops stay independent of lazily loaded editor runtimes. */
export interface FileDropPoint { x: number; y: number }
export interface NativeFileDropTarget {
  hover(paths: readonly string[], point: FileDropPoint): boolean;
  drop(paths: readonly string[], point: FileDropPoint): boolean;
  clear(): void;
}
type NativeFileDrop = { type: 'enter' | 'drop'; paths: string[]; position: FileDropPoint }
  | { type: 'over'; position: FileDropPoint } | { type: 'leave' };
const targets = new Set<NativeFileDropTarget>();
let hoveringPaths: readonly string[] = [];
let recentDrop: { names: string[]; at: number } | null = null;
export const isImageFilePath = (path: string): boolean => /\.(png|jpe?g|webp|gif|svg|bmp|avif|ico)$/i.test(path);
export function nativeDropToCssPoint(point: FileDropPoint, pixelRatio = window.devicePixelRatio): FileDropPoint {
  const scale = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  return { x: point.x / scale, y: point.y / scale };
}
export function registerNativeFileDropTarget(target: NativeFileDropTarget): () => void {
  targets.add(target);
  return () => { target.clear(); targets.delete(target); };
}
export function clearNativeFileDropTargets(): void {
  hoveringPaths = [];
  for (const target of targets) target.clear();
}
/** True means the live editor claimed the entire image-only drop. */
export function routeNativeFileDrop(event: NativeFileDrop): boolean {
  for (const target of targets) target.clear();
  if (event.type === 'leave') { hoveringPaths = []; return false; }
  if (event.type === 'enter') hoveringPaths = event.paths;
  const paths = event.type === 'drop' ? event.paths : hoveringPaths;
  if (event.type === 'drop') hoveringPaths = [];
  if (!paths.length || !paths.every(isImageFilePath)) return false;
  const point = nativeDropToCssPoint(event.position);
  for (const target of targets) {
    if (!(event.type === 'drop' ? target.drop(paths, point) : target.hover(paths, point))) continue;
    if (event.type === 'drop') recentDrop = { names: paths.map(path => path.split(/[\\/]/).pop()!.toLowerCase()), at: Date.now() };
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
