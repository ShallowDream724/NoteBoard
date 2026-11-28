import { convertFileSrc } from '@tauri-apps/api/core';
import { parse, type DefaultTreeAdapterTypes } from 'parse5';

type Element = DefaultTreeAdapterTypes.Element;
type Edit = { startOffset: number; endOffset: number; replacement: string };
type ResolveUrl = (reference: string) => string | undefined;

function applyEdits(source: string, edits: Edit[]): string {
  if (!edits.length) return source;
  edits.sort((a, b) => a.startOffset - b.startOffset);
  const pieces: string[] = [];
  let offset = 0;
  for (const edit of edits) {
    // HTML tree recovery can give reconstructed elements the same source range.
    if (edit.startOffset < offset) continue;
    pieces.push(source.slice(offset, edit.startOffset), edit.replacement);
    offset = edit.endOffset;
  }
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

function getAssetResolver(base: URL, documentBase: URL): ResolveUrl {
  return reference => {
    const value = reference.trim();
    if (!value || /^(?:[#?]|[/\\]{2}|[a-z][a-z\d+.-]*:)/i.test(value)) return;
    try {
      const url = new URL(value, base);
      if (!localDriveUrl(url, documentBase) || /%(?:2f|5c)/i.test(url.pathname)) return;
      // Decode the URL path once. Bare percent signs can be literal filename characters.
      const path = decodeURIComponent(url.pathname.slice(1).replace(/%(?![\da-f]{2})/gi, '%25'));
      const file = path.slice(2);
      if (!file || /[:<>"|?*]/.test(file) || [...file].some(char => char.charCodeAt(0) < 32)) return;
      return convertFileSrc(path.replace(/\//g, '\\')) + url.search + url.hash;
    } catch {
      // A malformed URL or an unavailable desktop bridge must not prevent preview.
      return;
    }
  };
}

function rewriteSrcset(srcset: string, resolve: ResolveUrl): string {
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
    const replacement = resolve(srcset.slice(startOffset, endOffset));
    if (replacement) edits.push({ startOffset, endOffset, replacement });
    if (endOffset !== offset) continue;

    let inParentheses = false;
    while (offset < srcset.length) {
      const char = srcset[offset++];
      if (char === '(') inParentheses = true;
      if (char === ')') inParentheses = false;
      if (char === ',' && !inParentheses) break;
    }
  }
  return applyEdits(srcset, edits);
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

function rewriteCss(css: string, resolve: ResolveUrl): string {
  return css.replace(cssUrlTokens, (match, doubleQuoted?: string, singleQuoted?: string, unquoted?: string) => {
    const value = doubleQuoted ?? singleQuoted ?? unquoted;
    if (value == null) return match;
    const url = resolve(decodeCssUrl(value));
    return url ? `url(${JSON.stringify(url)})` : match;
  });
}

function rewriteAttribute(element: Element, name: string, rewrite: ResolveUrl, edits: Edit[]) {
  const value = element.attrs.find(attr => (attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name) === name)?.value;
  const location = element.sourceCodeLocation?.attrs?.[name];
  if (!location || value === undefined) return;
  const rewritten = rewrite(value);
  if (rewritten === undefined || rewritten === value) return;
  const escaped = rewritten.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  edits.push({ startOffset: location.startOffset, endOffset: location.endOffset, replacement: `${name}="${escaped}"` });
}

/** Rewrite display resources in the srcDoc projection, without serializing the rest of the HTML. */
export function rewriteHtmlPreviewAssets(html: string, directory: string, fileName: string, scriptingEnabled = false): string {
  const documentBase = localDocumentBase(directory, fileName);
  if (!documentBase) return html;
  const parsed = parse(html, { scriptingEnabled, sourceCodeLocationInfo: true });
  const pending: DefaultTreeAdapterTypes.Node[] = [parsed];
  const elements: Element[] = [];
  let baseHref: string | undefined;
  while (pending.length) {
    const node = pending.pop()!;
    if ('tagName' in node) {
      if (node.tagName === 'base' && node.namespaceURI === 'http://www.w3.org/1999/xhtml') {
        baseHref ??= node.attrs.find(attr => attr.name === 'href')?.value;
      }
      if (node.sourceCodeLocation) elements.push(node);
    }
    if ('childNodes' in node) {
      for (let i = node.childNodes.length - 1; i >= 0; i--) pending.push(node.childNodes[i]);
    }
  }
  let base = documentBase;
  if (baseHref !== undefined) {
    try {
      const candidate = new URL(baseHref, documentBase);
      if (candidate.protocol !== 'data:' && candidate.protocol !== 'javascript:') base = candidate;
    } catch { /* A malformed base falls back to the document. */ }
  }
  if (!localDriveUrl(base, documentBase)) return html;

  const edits: Edit[] = [];
  const resolve = getAssetResolver(base, documentBase);
  for (const element of elements) {
    const tag = element.tagName;
    if (tag === 'img' || (tag === 'input' && element.attrs.some(attr => attr.name === 'type' && attr.value.toLowerCase() === 'image'))) {
      rewriteAttribute(element, 'src', resolve, edits);
    }
    if (tag === 'img' || tag === 'source') {
      rewriteAttribute(element, 'srcset', value => rewriteSrcset(value, resolve), edits);
    }
    if (tag === 'video') rewriteAttribute(element, 'poster', resolve, edits);
    if (tag === 'image' && element.namespaceURI === 'http://www.w3.org/2000/svg') {
      rewriteAttribute(element, 'href', resolve, edits);
      rewriteAttribute(element, 'xlink:href', resolve, edits);
    }
    rewriteAttribute(element, 'style', value => rewriteCss(value, resolve), edits);
    if (tag === 'style' && element.sourceCodeLocation?.startTag) {
      const { startTag, endTag, endOffset: elementEnd } = element.sourceCodeLocation;
      const startOffset = startTag.endOffset;
      const endOffset = endTag?.startOffset ?? elementEnd;
      const css = html.slice(startOffset, endOffset);
      const replacement = rewriteCss(css, resolve);
      if (replacement !== css) edits.push({ startOffset, endOffset, replacement });
    }
  }
  return applyEdits(html, edits);
}
