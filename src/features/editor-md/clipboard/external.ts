import type { JSONContent } from '@tiptap/core';
import { documentParser } from '../documentExtensions';
import { annotationBodyContent, remapAnnotationIds } from '../annotations/model';
import { CLIPBOARD_LIMITS, ClipboardImportError, clipboardTextLineCount, normalizeClipboardDocument, normalizeClipboardText, safeClipboardUrl, type ClipboardImportResult } from './normalize';

export const MARKDOWN_MIMES = ['text/markdown', 'text/x-markdown'] as const;
const isClipboardHtmlEnvelope = (raw: string) => /^(?:Version:|StartHTML:)/i.test(raw) && /\r?\nStartFragment:\s*-?\d+/i.test(raw);
/** Native Windows clipboard exports may include the CF_HTML transport header. */
export function clipboardHtmlSource(raw: string): string {
  if (!isClipboardHtmlEnvelope(raw)) return raw;
  const start = raw.indexOf('<');
  return start >= 0 ? raw.slice(start).replace(/\0+$/, '') : '';
}
function selectClipboardHtmlFragment(document: Document, raw: string): void {
  if (!isClipboardHtmlEnvelope(raw) || !raw.includes('<!--StartFragment-->') || !raw.includes('<!--EndFragment-->')) return;
  let inside = false, count = 0;
  const prune = (parent: globalThis.Node, depth: number): boolean => {
    if (depth > CLIPBOARD_LIMITS.depth) throw new ClipboardImportError('剪贴板结构过大或嵌套过深，请分段粘贴');
    let kept = false;
    for (const child of Array.from(parent.childNodes)) {
      if (++count > CLIPBOARD_LIMITS.nodes) throw new ClipboardImportError('剪贴板结构超过导入限制');
      if (child.nodeType === 8 && child.textContent?.trim() === 'StartFragment') { inside = true; parent.removeChild(child); continue; }
      if (child.nodeType === 8 && child.textContent?.trim() === 'EndFragment') { inside = false; parent.removeChild(child); continue; }
      const selected = inside;
      const keep = child.nodeType === 1 && child.childNodes.length ? prune(child, depth + 1) : selected;
      if (keep) kept = true; else parent.removeChild(child);
    }
    return kept;
  };
  // Retain ancestor table/list/paragraph structure and all head style rules.
  prune(document.body, 0);
}
/** Only an unreadable image by itself may use the clipboard bitmap alternative.
 * Never replace a Word/Excel document or a text selection with its screenshot. */
export function needsClipboardImageFallback(raw: string): boolean {
  if (raw.length > CLIPBOARD_LIMITS.synchronous) return false;
  const document = new DOMParser().parseFromString(clipboardHtmlSource(raw), 'text/html');
  try { selectClipboardHtmlFragment(document, raw); } catch { return false; }
  let images = 0, readable = false, other = false;
  const visit = (parent: globalThis.Node, depth: number) => {
    if (depth > CLIPBOARD_LIMITS.depth) { other = true; return; }
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === 3) { other ||= Boolean(child.textContent?.trim()); continue; }
      if (child.nodeType === 8) {
        if (/<v:imagedata\b/i.test(child.textContent ?? '')) images++;
        continue;
      }
      if (child.nodeType !== 1) continue;
      const element = child as Element, tag = element.tagName.toUpperCase();
      if (['HEAD', 'STYLE', 'SCRIPT', 'META', 'LINK'].includes(tag)) continue;
      if (tag === 'IMG' || tag === 'V:IMAGEDATA') { images++; readable ||= Boolean(safeClipboardUrl(element.getAttribute('src') ?? '', true)); continue; }
      if (['TABLE', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'HR'].includes(tag) || /^H[1-6]$/.test(tag)) other = true;
      visit(child, depth + 1);
    }
  };
  visit(document.body, 0);
  return images > 0 && !readable && !other;
}
export interface ExternalTextOptions {
  inferTable?: boolean;
  tableContext?: boolean;
  inferMarkdown?: boolean;
  stripAnnotations?: boolean;
}

/** A cheap gate only; the shared document grammar decides whether syntax is real. */
function markdownCandidate(raw: string): boolean {
  return /(^|\n) {0,3}(?:#{1,6}(?:\s|$)|>|[-+*]\s|\d+[.)]\s|`{3,}|~{3,}|(?:[-*_][ \t]*){3,}$)|[`*_$~]|\\[([]|!?\[[^\]\n]+\](?:\(|\[)|\n {0,3}(?:=+|-+)[ \t]*(?:\n|$)|\|[^\n]*\n[ \t]*\|?\s*:?-{3,}/m.test(raw);
}

function markdownResult(raw: string, options: ExternalTextOptions, explicit: boolean): ClipboardImportResult | null {
  if (!explicit && !markdownCandidate(raw)) return null;
  const parsed = documentParser().manager.parse(raw);
  const stack = (parsed.content ?? []).map(node => ({ node, depth: 0 }));
  const diagnostics = new Set<string>(); let nodes = 0, semantic = false, cells = 0;
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    if (++nodes > CLIPBOARD_LIMITS.nodes || depth > CLIPBOARD_LIMITS.depth) throw new ClipboardImportError('剪贴板结构过大或嵌套过深，请分段粘贴');
    semantic ||= !['paragraph', 'text', 'hardBreak'].includes(node.type ?? '') || Boolean(node.marks?.length);
    if (node.type === 'tableCell' || node.type === 'tableHeader') {
      cells += Math.max(1, Number(node.attrs?.colspan) || 1) * Math.max(1, Number(node.attrs?.rowspan) || 1);
      if (cells > CLIPBOARD_LIMITS.cells) throw new ClipboardImportError('表格展开后的网格过大，请分段粘贴');
    }
    if (node.type === 'image') {
      const rawUrl = String(node.attrs?.src ?? ''), src = safeClipboardUrl(rawUrl, true);
      if (src) node.attrs = { ...node.attrs, src };
      else {
        diagnostics.add('无法读取的图片已保留替代文字和来源');
        const text = `[图片：${node.attrs?.alt || '不可读取'}${rawUrl ? `；来源：${rawUrl.slice(0, 300)}` : ''}]`;
        node.type = 'paragraph'; delete node.attrs; node.content = [{ type: 'text', text }];
      }
    }
    if (node.marks) node.marks = node.marks.filter(mark => {
      if (mark.type !== 'link') return true;
      const href = safeClipboardUrl(String(mark.attrs?.href ?? ''));
      if (href) mark.attrs = { ...mark.attrs, href };
      return Boolean(href);
    });
    for (const child of node.content ?? []) stack.push({ node: child, depth: depth + 1 });
  }
  if (!explicit && !semantic) return null;
  const content = options.stripAnnotations ? annotationBodyContent(parsed.content ?? []) : remapAnnotationIds(parsed).content ?? [];
  return { content, nodes, diagnostics: [...diagnostics] };
}

/** TSV inference and Markdown parsing share the same policy in the UI and Worker. */
export function normalizeExternalText(raw: string, options: ExternalTextOptions = {}, explicitMarkdown = false): ClipboardImportResult {
  // Apply text size/line limits before the Markdown parser allocates its token tree.
  clipboardTextLineCount(raw);
  let plain: ClipboardImportResult | undefined;
  if (!explicitMarkdown && options.inferTable && (options.tableContext || raw.includes('\t') && raw.includes('\n'))) {
    plain = normalizeClipboardText(raw, true, options.tableContext);
    if (plain.content[0]?.type === 'table') return plain;
  }
  return (explicitMarkdown || options.inferMarkdown ? markdownResult(raw, options, explicitMarkdown) : null) ?? plain ?? normalizeClipboardText(raw);
}

/** Source editors wrap raw text in presentation-only spans/divs/pre elements.
 * Real HTML headings, lists, tables, links and Office paragraphs keep HTML ownership. */
function wrappedMarkdownSource(document: Document, plainText?: string): string | null {
  const body = document.body ?? document.documentElement;
  const allowed = new Set(['DIV', 'SPAN', 'BR', 'PRE', 'CODE', 'META']);
  for (const element of Array.from(body.querySelectorAll('*'))) {
    if (!allowed.has(element.tagName.toUpperCase()) || /\bmso-|\bMso(?:Normal|List)/i.test(`${element.getAttribute('style') ?? ''} ${element.getAttribute('class') ?? ''}`)) return null;
    const language = /(?:^|\s)language-([\w+-]+)/i.exec(element.getAttribute('class') ?? '')?.[1] ?? element.getAttribute('data-language');
    if (language && !/^(?:md|markdown|text|plaintext)$/i.test(language)) return null;
  }
  const fragments: string[] = [];
  const collect = (parent: globalThis.Node, depth: number) => {
    if (depth > CLIPBOARD_LIMITS.depth) throw new ClipboardImportError('剪贴板结构过大或嵌套过深，请分段粘贴');
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === 3) { fragments.push(child.textContent ?? ''); continue; }
      if (child.nodeType !== 1) continue;
      const tag = (child as Element).tagName.toUpperCase();
      if (tag === 'META') continue;
      if (tag === 'BR') { fragments.push('\n'); continue; }
      const block = tag === 'DIV' || tag === 'PRE';
      if (block && fragments.length && !fragments.at(-1)?.endsWith('\n')) fragments.push('\n');
      const before = fragments.length;
      collect(child, depth + 1);
      if (block && (fragments.length === before || !fragments.at(-1)?.endsWith('\n'))) fragments.push('\n');
    }
  };
  collect(body, 0);
  const source = fragments.join('').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
  if (plainText !== undefined) {
    const plain = plainText.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
    const comparable = (value: string) => value.replace(/[ \t]+(?=\n|$)/g, '').trim();
    if (comparable(source) !== comparable(plain)) return null;
    return plainText;
  }
  return source.replace(/\n$/, '');
}

function hasReadableContent(nodes: JSONContent[]): boolean {
  return nodes.some(node => node.type !== 'paragraph' && node.type !== 'text' || Boolean(node.text?.trim()) || hasReadableContent(node.content ?? []));
}

export function normalizeExternalHtml(document: Document, input: number | string, plainText: string | undefined, options: ExternalTextOptions = {}): ClipboardImportResult {
  const inputCharacters = typeof input === 'string' ? input.length : input;
  if (inputCharacters > CLIPBOARD_LIMITS.characters) throw new ClipboardImportError('剪贴板内容过大，请分段粘贴');
  if (typeof input === 'string') selectClipboardHtmlFragment(document, input);
  if (options.inferMarkdown) {
    const source = wrappedMarkdownSource(document, plainText);
    if (source !== null) {
      const normalized = normalizeExternalText(source, { ...options, inferTable: false });
      if (normalized.content.some(node => node.type !== 'paragraph' || node.content?.some(child => child.type !== 'text' || child.marks?.length))) return normalized;
    }
  }
  const normalized = normalizeClipboardDocument(document, inputCharacters);
  return !hasReadableContent(normalized.content) && plainText?.trim()
    ? normalizeExternalText(plainText, options) : normalized;
}
