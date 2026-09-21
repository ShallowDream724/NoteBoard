/** User-entered Windows file paths, kept separate from document text and remote URLs. */
export function normalizeFileInput(value: string): string {
  let path = value.trim().replace(/^\uFEFF/, '');
  if ((path.startsWith('"') && path.endsWith('"')) || (path.startsWith("'") && path.endsWith("'"))) {
    path = path.slice(1, -1).trim();
  }
  if (/^file:/i.test(path)) {
    const url = new URL(path);
    path = url.hostname && url.hostname !== 'localhost'
      ? '\\\\' + url.hostname + decodeURIComponent(url.pathname)
      : decodeURIComponent(url.pathname).replace(/^\/(?=[a-z]:)/i, '');
  }
  if (/[\u0000-\u001f]/.test(path) || !/^(?:[a-z]:[\\/]|[\\/]{2}[^\\/])/i.test(path)) {
    throw new Error('请输入完整的本地文件路径');
  }
  const unc = /^[\\/]{2}/.test(path);
  path = path.replace(/[\\/]+/g, '\\');
  return unc ? '\\' + path : path;
}
