import { resolveRelativeDocPath } from './documentPath';

export const NETWORK_IMAGE_BLOCKED = '网络共享图片未自动加载。可在系统文件管理器中手动打开；同一共享目录中的文档可使用相对路径引用。';

export type DocumentImageSource = { kind: 'url'; url: string } | { kind: 'file'; path: string }
  | { kind: 'blocked'; message: string };

/** Decode path aliases before deciding whether an authored reference can reach SMB.
 * Invalid percent sequences must not hide valid encoded separators beside them. */
function decodePath(value: string): string | null {
  for (let depth = 0; depth < 10; depth++) {
    if (!/%[\da-f]{2}/i.test(value)) return value;
    let decoded: string;
    try { decoded = decodeURIComponent(value); }
    catch { decoded = value.replace(/%([\da-f]{2})/gi, (_, byte: string) => String.fromCharCode(parseInt(byte, 16))); }
    if (decoded === value) return value;
    value = decoded;
  }
  // Unbounded nested encoding is ambiguous to downstream URL/native decoders.
  return /%[\da-f]{2}/i.test(value) ? null : value;
}

function normalizePath(path: string): string { return path.replace(/\//g, '\\'); }
function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}
function networkOrDevicePath(path: string): boolean {
  return /^(?:\\\\|\\\?\?\\)/.test(normalizePath(path));
}
function normalizedBase(base: string): string {
  return normalizePath(base).replace(/^\\\\\?\\UNC\\/i, '\\\\');
}
function shareComponents(path: string): RegExpMatchArray | null {
  const parts = normalizePath(path).match(/^\\\\([^\\]+)\\([^\\]+)(?:\\(.*))?$/);
  return parts && !['?', '.', '..'].includes(parts[1]) && !['.', '..'].includes(parts[2]) ? parts : null;
}
function sameShareAbsolute(path: string, baseDirectory: string): string | null {
  const source = shareComponents(path), base = shareComponents(normalizedBase(baseDirectory));
  if (!source || !base || source[1].toLowerCase() !== base[1].toLowerCase() || source[2].toLowerCase() !== base[2].toLowerCase()) return null;
  const tail = (source[3] ?? '').replace(/^[\\/]+/, '');
  if (/^[a-z][\w+.-]*:/i.test(tail)) return null;
  // Force the remaining components to stay relative: the generic resolver also
  // accepts absolute inputs, so repeated separators must not acquire authority.
  const resolved = resolveRelativeDocPath(`\\\\${base[1]}\\${base[2]}`, `.\\${tail}`);
  const finalShare = shareComponents(resolved);
  return finalShare && finalShare[1].toLowerCase() === base[1].toLowerCase()
    && finalShare[2].toLowerCase() === base[2].toLowerCase() ? resolved : null;
}

/** A deliberately opened network document authorizes only its own host/share.
 * Local documents never authorize authored network paths or asset disguises. */
export function resolveDocumentImageSource(reference: string, baseDirectory = ''): DocumentImageSource {
  const blocked = (): DocumentImageSource => ({ kind: 'blocked', message: NETWORK_IMAGE_BLOCKED });
  const source = reference.trim();
  if (!source) return { kind: 'url', url: '' };
  if (/^(?:data:image\/|blob:)/i.test(source)) return { kind: 'url', url: source };
  if (hasControlCharacters(source)) return blocked();
  let path = decodePath(source);
  if (path === null || hasControlCharacters(path)) return blocked();
  let asset = false;
  if (/^(?:asset:|https?:\/\/asset\.localhost(?:[/:?#]|$))/i.test(path)) {
    asset = true;
    try {
      const url = new URL(/^(?:asset:|https?:)/i.test(source) ? source : path);
      if (!['localhost', 'asset.localhost'].includes(url.hostname.toLowerCase()) || url.username || url.password || url.port) return blocked();
      // The first slash belongs to the protocol, not the encoded native path.
      path = decodePath(url.pathname.slice(1));
    } catch { return blocked(); }
    if (path === null) return blocked();
  } else if (/^https?:/i.test(path)) {
    try {
      const url = new URL(/^https?:/i.test(source) ? source : path);
      // URL parsing can normalize backslashes, control characters and authority
      // spelling; inspect its canonical host as well as the original spelling.
      if (url.hostname.toLowerCase().replace(/\.$/, '') === 'asset.localhost') return blocked();
      return { kind: 'url', url: source };
    } catch { return blocked(); }
  }
  if (/^file:/i.test(path)) {
    const fileSource = path;
    try {
      const url = new URL(/^file:/i.test(source) ? source : path);
      path = decodePath(url.hostname && url.hostname.toLowerCase() !== 'localhost'
        ? `//${url.hostname}${url.pathname}` : url.pathname.replace(/^\/(?=[a-z]:)/i, ''));
    } catch { path = fileSource.slice(5); }
    if (path === null) return blocked();
  }
  if (networkOrDevicePath(path)) {
    const permitted = sameShareAbsolute(path, baseDirectory);
    return permitted ? { kind: 'file', path: permitted } : blocked();
  }
  if (/^[a-z][\w+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) return blocked();
  if (asset && !/^[a-z]:[\\/]/i.test(path)) return blocked();
  const absoluteLocal = /^[a-z]:[\\/]/i.test(path);
  if (!baseDirectory && !absoluteLocal) return { kind: 'url', url: source };
  const base = normalizedBase(baseDirectory);
  // Extended/device bases other than an explicit UNC share are not supported.
  if (/^\\\\[?.]\\/.test(base)) return blocked();
  const resolved = resolveRelativeDocPath(base, path);
  if (networkOrDevicePath(resolved)) {
    const resultShare = shareComponents(resolved), baseShare = shareComponents(base);
    if (!resultShare || !baseShare || resultShare[1].toLowerCase() !== baseShare[1].toLowerCase()
      || resultShare[2].toLowerCase() !== baseShare[2].toLowerCase()) return blocked();
  }
  return { kind: 'file', path: resolved };
}

/** Host-side export defense: recompute the path from its authored reference and
 * the explicitly opened directory, rather than trusting a worker path alone. */
export function validateDocumentImageAsset(path: string, reference = path, baseDirectory = ''): boolean {
  const result = resolveDocumentImageSource(reference, baseDirectory);
  return result.kind === 'file' && normalizePath(result.path).toLowerCase() === normalizePath(path).toLowerCase();
}
