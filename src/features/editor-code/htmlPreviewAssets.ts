import { convertFileSrc } from '@tauri-apps/api/core';
import { parse, type DefaultTreeAdapterTypes } from 'parse5';

type Element = DefaultTreeAdapterTypes.Element;
type Render = (loaded: ReadonlyMap<string, string>) => string | undefined;
type Edit = { startOffset: number; endOffset: number; render: Render };
type PlanUrl = (reference: string, allowFont?: boolean) => Render | undefined;

interface AssetFile { path: string; mime: string }
interface HtmlPreviewAssetPlan { source: string; edits: Edit[]; files: Map<string, AssetFile> }
interface HtmlPreviewPlan { assets?: HtmlPreviewAssetPlan; hasScripts: boolean; hasCanvas: boolean }

const htmlNamespace = 'http://www.w3.org/1999/xhtml';
const svgNamespace = 'http://www.w3.org/2000/svg';
const javascriptTypes = new Set([
  'application/ecmascript', 'application/javascript', 'application/x-ecmascript', 'application/x-javascript',
  'text/ecmascript', 'text/javascript', 'text/javascript1.0', 'text/javascript1.1', 'text/javascript1.2',
  'text/javascript1.3', 'text/javascript1.4', 'text/javascript1.5', 'text/jscript', 'text/livescript',
  'text/x-ecmascript', 'text/x-javascript',
]);

function isJavaScript(element: Element): boolean {
  if (element.namespaceURI === svgNamespace) return true;
  const type = element.attrs.find(attr => attr.name === 'type')?.value.toLowerCase();
  const language = element.attrs.find(attr => attr.name === 'language')?.value.toLowerCase();
  const scriptType = type ?? (language ? `text/${language}` : '');
  return scriptType === '' || scriptType === 'module' || javascriptTypes.has(scriptType.trim());
}

const imageTypes: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif', ico: 'image/vnd.microsoft.icon',
};
const fontTypes: Readonly<Record<string, string>> = {
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
};

function applyEdits(source: string, edits: Edit[], loaded: ReadonlyMap<string, string>): string {
  edits.sort((a, b) => a.startOffset - b.startOffset);
  const pieces: string[] = [];
  let offset = 0;
  for (const edit of edits) {
    // HTML tree recovery can give reconstructed elements the same source range.
    if (edit.startOffset < offset) continue;
    const replacement = edit.render(loaded);
    if (replacement === undefined) continue;
    pieces.push(source.slice(offset, edit.startOffset), replacement);
    offset = edit.endOffset;
  }
  if (!pieces.length) return source;
  pieces.push(source.slice(offset));
  return pieces.join('');
}

function localDocumentBase(directory: string, fileName: string): URL | undefined {
  const nativeDirectory = directory.replace(/\\/g, '/');
  if (!/^[a-z]:\//i.test(nativeDirectory)) return;
  const [drive, ...parts] = nativeDirectory.split('/');
  return new URL(`file:///${drive}/${[...parts.filter(Boolean), fileName].map(encodeURIComponent).join('/')}`);
}

function localDriveUrl(url: URL, documentBase: URL): boolean {
  return url.protocol === 'file:' && url.hostname === ''
    && url.pathname.slice(0, 3).toLowerCase() === documentBase.pathname.slice(0, 3).toLowerCase();
}

function getAssetPlanner(base: URL, documentBase: URL, files: Map<string, AssetFile>): PlanUrl {
  return (reference, allowFont) => {
    const value = reference.trim();
    if (!value || /^(?:[#?]|[/\\]{2}|[a-z][a-z\d+.-]*:)/i.test(value)) return;
    try {
      const url = new URL(value, base);
      if (!localDriveUrl(url, documentBase) || /%(?:2f|5c)/i.test(url.pathname)) return;
      // Decode the URL path once. Bare percent signs can be literal filename characters.
      const path = decodeURIComponent(url.pathname.slice(1).replace(/%(?![\da-f]{2})/gi, '%25'));
      const file = path.slice(2);
      if (!file || /[:<>"|?*]/.test(file) || [...file].some(char => char.charCodeAt(0) < 32)) return;
      const extension = /\.([a-z\d]+)$/i.exec(file)?.[1].toLowerCase() ?? '';
      const mime = (Object.hasOwn(imageTypes, extension) && imageTypes[extension])
        || (allowFont && Object.hasOwn(fontTypes, extension) && fontTypes[extension]);
      if (!mime) return;
      const nativePath = path.replace(/\//g, '\\');
      const key = nativePath.toLowerCase();
      if (!files.has(key)) files.set(key, { path: nativePath, mime });
      const fragment = url.hash;
      return loaded => {
        const data = loaded.get(key);
        return data && data + fragment;
      };
    } catch {
      // A malformed URL must not prevent preview.
      return;
    }
  };
}

function planSrcset(srcset: string, plan: PlanUrl): Render | undefined {
  const edits: Edit[] = [];
  const whitespace = /[ \t\n\f\r]/;
  let offset = 0;
  while (offset < srcset.length) {
    // A comma inside the URL (for example a data URL) is not a candidate delimiter.
    while (offset < srcset.length && (whitespace.test(srcset[offset]) || srcset[offset] === ',')) offset++;
    const startOffset = offset;
    while (offset < srcset.length && !whitespace.test(srcset[offset])) offset++;
    let endOffset = offset;
    while (endOffset > startOffset && srcset[endOffset - 1] === ',') endOffset--;
    const render = plan(srcset.slice(startOffset, endOffset));
    if (render) edits.push({ startOffset, endOffset, render });
    if (endOffset !== offset) continue;

    let inParentheses = false;
    while (offset < srcset.length) {
      const char = srcset[offset++];
      if (char === '(') inParentheses = true;
      if (char === ')') inParentheses = false;
      if (char === ',' && !inParentheses) break;
    }
  }
  if (edits.length) return loaded => applyEdits(srcset, edits, loaded);
}

function decodeCssUrl(value: string): string {
  return value.replace(/\\(?:([\da-f]{1,6})(?:\r\n|[\t\n\f\r ])?|\r\n|[\n\f\r]|([^\n\r\f]))/gi,
    (_, hex: string | undefined, literal: string | undefined) => {
      if (!hex) return literal ?? '';
      const code = Number.parseInt(hex, 16);
      return code && code <= 0x10FFFF && !(code >= 0xD800 && code <= 0xDFFF) ? String.fromCodePoint(code) : '\uFFFD';
    });
}

const cssDoubleQuotedBody = String.raw`(?:\\(?:\r\n|[\s\S])|[^"\\\r\n\f])*`;
const cssSingleQuotedBody = String.raw`(?:\\(?:\r\n|[\s\S])|[^'\\\r\n\f])*`;
const cssHexEscape = String.raw`(?:[\da-f]{6}|[\da-f]{1,5}(?![\da-f]))(?:\r\n|[\t\n\f\r ])?`;
const cssUnquotedUrl = String.raw`(?:\\(?:${cssHexEscape}|[^\da-f\r\n\f])|[^"'()\\ \t\n\f\r])*`;

// Tokenize around comments and strings so text like content: "url(x)" is untouched.
const cssUrlTokens = new RegExp([
  String.raw`/\*[\s\S]*?(?:\*/|$)`,
  `"${cssDoubleQuotedBody}"`,
  `'${cssSingleQuotedBody}'`,
  String.raw`(?<![-\w\\#@\u0080-\uFFFF])url\([ \t\n\f\r]*`
    + `(?:"(${cssDoubleQuotedBody})"|'(${cssSingleQuotedBody})'|(${cssUnquotedUrl}))`
    + String.raw`[ \t\n\f\r]*\)`,
].join('|'), 'gi');

function planCss(css: string, plan: PlanUrl): Render | undefined {
  const edits: Edit[] = [];
  for (const match of css.matchAll(cssUrlTokens)) {
    const [token, doubleQuoted, singleQuoted, unquoted] = match;
    const value = doubleQuoted ?? singleQuoted ?? unquoted;
    if (value == null) continue;
    const render = plan(decodeCssUrl(value), true);
    if (!render) continue;
    edits.push({
      startOffset: match.index, endOffset: match.index + token.length,
      render: loaded => {
        const url = render(loaded);
        return url && `url(${JSON.stringify(url)})`;
      },
    });
  }
  if (edits.length) return loaded => applyEdits(css, edits, loaded);
}

function planAttribute(element: Element, name: string, plan: PlanUrl, edits: Edit[]) {
  const value = element.attrs.find(attr => (attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name) === name)?.value;
  const location = element.sourceCodeLocation?.attrs?.[name];
  if (!location || value === undefined) return;
  const render = plan(value);
  if (!render) return;
  edits.push({
    startOffset: location.startOffset, endOffset: location.endOffset,
    render: loaded => {
      const rewritten = render(loaded);
      if (rewritten === undefined || rewritten === value) return;
      const escaped = rewritten.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      return `${name}="${escaped}"`;
    },
  });
}

/** Collect source ranges without giving the parsed document a browsing context. */
export function planHtmlPreview(html: string, directory: string, fileName: string, scriptingEnabled = false): HtmlPreviewPlan {
  const documentBase = localDocumentBase(directory, fileName);
  const parsed = parse(html, { scriptingEnabled, sourceCodeLocationInfo: true });
  const pending: DefaultTreeAdapterTypes.Node[] = [parsed];
  const elements: Element[] = [];
  const preview = { hasScripts: false, hasCanvas: false };
  let baseHref: string | undefined;
  while (pending.length) {
    const node = pending.pop()!;
    if ('tagName' in node) {
      if (!scriptingEnabled && !preview.hasScripts && node.tagName === 'script' && isJavaScript(node)) preview.hasScripts = true;
      if (node.tagName === 'canvas' && node.namespaceURI === htmlNamespace) preview.hasCanvas = true;
      if (node.tagName === 'base' && node.namespaceURI === htmlNamespace) {
        baseHref ??= node.attrs.find(attr => attr.name === 'href')?.value;
      }
      if (node.sourceCodeLocation) elements.push(node);
    }
    if ('childNodes' in node) {
      for (let i = node.childNodes.length - 1; i >= 0; i--) pending.push(node.childNodes[i]);
    }
  }
  if (!documentBase) return preview;
  let base = documentBase;
  if (baseHref !== undefined) {
    try {
      const candidate = new URL(baseHref, documentBase);
      if (candidate.protocol !== 'data:' && candidate.protocol !== 'javascript:') base = candidate;
    } catch { /* A malformed base falls back to the document. */ }
  }
  if (!localDriveUrl(base, documentBase)) return preview;

  const edits: Edit[] = [];
  const files = new Map<string, AssetFile>();
  const plan = getAssetPlanner(base, documentBase, files);
  for (const element of elements) {
    const tag = element.tagName;
    if (tag === 'img' || (tag === 'input' && element.attrs.some(attr => attr.name === 'type' && attr.value.toLowerCase() === 'image'))) {
      planAttribute(element, 'src', plan, edits);
    }
    if (tag === 'img' || tag === 'source') {
      planAttribute(element, 'srcset', value => planSrcset(value, plan), edits);
    }
    if (tag === 'video') planAttribute(element, 'poster', plan, edits);
    if (tag === 'image' && element.namespaceURI === svgNamespace) {
      planAttribute(element, 'href', plan, edits);
      planAttribute(element, 'xlink:href', plan, edits);
    }
    planAttribute(element, 'style', value => planCss(value, plan), edits);
    if (tag === 'style' && element.sourceCodeLocation?.startTag) {
      const { startTag, endTag, endOffset: elementEnd } = element.sourceCodeLocation;
      const startOffset = startTag.endOffset;
      const endOffset = endTag?.startOffset ?? elementEnd;
      const render = planCss(html.slice(startOffset, endOffset), plan);
      if (render) edits.push({ startOffset, endOffset, render });
    }
  }
  return { ...preview, assets: files.size ? { source: html, edits, files } : undefined };
}

function matchesMime(actual: string | undefined, expected: string): boolean {
  if (actual === expected) return true;
  if (expected === 'image/vnd.microsoft.icon') return actual === 'image/x-icon';
  if (expected === 'font/woff' || expected === 'font/woff2') return actual === 'application/font-woff';
  if (expected === 'font/ttf' || expected === 'font/otf') return actual === 'application/font-sfnt';
  return false;
}

function readDataUrl(blob: Blob, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => reader.abort();
    signal.addEventListener('abort', abort, { once: true });
    reader.addEventListener('loadend', () => {
      signal.removeEventListener('abort', abort);
      if (!signal.aborted && typeof reader.result === 'string') resolve(reader.result);
      else reject(signal.reason ?? reader.error ?? new Error('无法读取本地预览资源'));
    }, { once: true });
    reader.readAsDataURL(blob);
  });
}

/** Read in the app origin. An opaque srcDoc may be unable to reach Tauri's asset origin. */
export async function loadHtmlPreviewAssets(plan: HtmlPreviewAssetPlan, signal: AbortSignal): Promise<string> {
  const loaded = new Map<string, string>();
  const files = plan.files.entries();
  const worker = async () => {
    for (const [key, file] of files) {
      signal.throwIfAborted();
      try {
        const response = await fetch(convertFileSrc(file.path), {
          signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
        });
        const mime = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
        if (!response.ok || !matchesMime(mime, file.mime)) {
          await response.body?.cancel();
          continue;
        }
        const blob = await response.blob();
        if (blob.size) loaded.set(key, await readDataUrl(blob.slice(0, blob.size, file.mime), signal));
      } catch {
        signal.throwIfAborted();
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, plan.files.size) }, worker));
  signal.throwIfAborted();
  return applyEdits(plan.source, plan.edits, loaded);
}
