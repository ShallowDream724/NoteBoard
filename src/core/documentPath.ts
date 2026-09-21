/** Resolve Markdown asset/link paths without depending on editor or window state. */
export function resolveRelativeDocPath(baseDir: string, reference: string): string {
  let path = reference;
  if (/^file:/i.test(path)) {
    try { const url = new URL(path); path = url.hostname ? `//${url.hostname}${url.pathname}` : url.pathname.replace(/^\/(?=[a-z]:)/i, ''); } catch { path = path.replace(/^file:[\\/]+/i, ''); }
  }
  try { path = decodeURIComponent(path); } catch { /* A literal percent is a valid filename character. */ }
  path = path.replace(/\//g, '\\');
  if (/^[a-z]:\\|^\\\\/i.test(path)) return path;
  const parts = baseDir.replace(/\//g, '\\').split('\\').filter(Boolean);
  const floor = baseDir.startsWith('\\\\') || baseDir.startsWith('//') ? 2 : 1;
  for (const part of path.split('\\').filter(Boolean)) {
    if (part === '.') continue;
    if (part === '..') { if (parts.length > floor) parts.pop(); }
    else parts.push(part);
  }
  return (floor === 2 ? '\\\\' : '') + parts.join('\\');
}
