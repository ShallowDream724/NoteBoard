import type { JSONContent } from '@tiptap/core';
import { parseClipboardMatrix } from '../../../core/clipboardMatrix';
import { clipboardMathElement, clipboardTextMath } from './htmlMath';
import { figureCaptionText } from '../figureCaption';

/** Import limits bound DOM parsing, schema materialization and one final transaction. */
export const CLIPBOARD_LIMITS = { characters: 16_000_000, nodes: 250_000, depth: 48, cells: 100_000, rules: 2_048, synchronous: 24_000 } as const;
export interface ClipboardImportResult { content: JSONContent[]; diagnostics: string[]; nodes: number; openStart?: number; openEnd?: number; tableScope?: 'row' | 'column' | 'table' | 'cells' }
export class ClipboardImportError extends Error {}
/** Bound text parsing before constructing either paragraph or Markdown trees. */
export function clipboardTextLineCount(raw: string): number {
  if (raw.length > CLIPBOARD_LIMITS.characters) throw new ClipboardImportError('剪贴板内容过大，请分段粘贴');
  let lines = 1;
  for (let at = 0; at < raw.length; at++) if (raw[at] === '\n' || raw[at] === '\r') {
    if (raw[at] === '\r' && raw[at + 1] === '\n') at++;
    if (++lines * 2 > CLIPBOARD_LIMITS.nodes) throw new ClipboardImportError('剪贴板行数过多，请分段粘贴');
  }
  return lines;
}
/** The same text/TSV policy runs synchronously for tiny input and in Worker for large input. */
export function normalizeClipboardText(raw: string, inferTable = false, tableContext = false): ClipboardImportResult {
  const lines = clipboardTextLineCount(raw);
  if (inferTable && (tableContext || (raw.includes('\t') && raw.includes('\n')))) {
    const matrix = parseClipboardMatrix(raw);
    const explicit = matrix && matrix.length >= 2 && matrix[0].length >= 2 && matrix.every(row => row.length === matrix[0].length)
      && !raw.split(/\r?\n/).some(line => /^\s*\t/.test(line) || /^\s*(?:\/\/|[{}]|(?:function|class|if|for|while|return|const|let|var|def|import)\b)/.test(line));
    if (matrix?.length && (tableContext || explicit)) {
      const width = matrix.reduce((maximum, row) => Math.max(maximum, row.length), 0);
      if (width * matrix.length > CLIPBOARD_LIMITS.cells) throw new ClipboardImportError('表格展开后的网格过大，请分段粘贴');
      if (width > 1 || matrix.length > 1) return { content: [{ type: 'table', content: matrix.map(row => ({ type: 'tableRow', content: Array.from({ length: width }, (_, index) => ({ type: 'tableCell', content: [{ type: 'paragraph', ...(row[index] ? { content: [{ type: 'text', text: row[index] }] } : {}) }] })) })) }], nodes: width * matrix.length * 3, diagnostics: [] };
    }
  }
  return { content: raw.replace(/\r\n?/g, '\n').split('\n').map(text => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) })), diagnostics: [], nodes: lines * 2 };
}
type Style = Record<string, string>;
type Mark = NonNullable<JSONContent['marks']>[number];
const skipped = new Set(['SCRIPT', 'STYLE', 'HEAD', 'META', 'LINK', 'IFRAME', 'OBJECT', 'NOSCRIPT', 'SVG']);
const blocks = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE', 'BLOCKQUOTE', 'PRE', 'HR', 'DETAILS']);
const namedColors: Record<string, string> = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', gray: '#808080', grey: '#808080', orange: '#ffa500', purple: '#800080', teal: '#008080', navy: '#000080', silver: '#c0c0c0', maroon: '#800000', lime: '#00ff00', aqua: '#00ffff', fuchsia: '#ff00ff' };
export function clipboardColor(raw: string | undefined): string | null {
  const value = raw?.trim().toLowerCase(); if (!value) return null;
  if (/^#[\da-f]{6}$/.test(value)) return value;
  if (/^#[\da-f]{3}$/.test(value)) return `#${[...value.slice(1)].map(c => c + c).join('')}`;
  const rgb = /^rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)(?:\s*[,/]\s*1(?:\.0+)?)?\s*\)$/.exec(value);
  return rgb ? '#' + rgb.slice(1, 4).map(n => Math.min(255, +n).toString(16).padStart(2, '0')).join('') : namedColors[value] ?? null;
}
function declarations(source: string): Style {
  const result: Style = {};
  for (const declaration of source.split(';')) { const at = declaration.indexOf(':'); if (at > 0) result[declaration.slice(0, at).trim().toLowerCase()] = declaration.slice(at + 1).replace(/\s*!important\s*$/i, '').trim(); }
  return result;
}
export function safeClipboardUrl(raw: string, image = false): string | null {
  const value = raw.trim();
  if (!value) return null;
  for (let index = 0; index < value.length; index++) if (value.charCodeAt(index) <= 31) return null;
  if (/^(https?:|mailto:|tel:)/i.test(value)) return image && !/^https?:/i.test(value) ? null : value;
  if (image && /^data:image\/(?:png|jpeg|gif|webp|bmp);base64,[a-z0-9+/=\s]+$/i.test(value)) return value;
  if (/^(?:[.#/]|[^:\s]+(?:\/|$))/.test(value) && !/^[a-z][\w+.-]*:/i.test(value)) return value;
  return null;
}

/** DOM is detached; only a small allowlist is translated to schema data. No computed styles or HTML survives. */
export function normalizeClipboardDocument(document: Document, inputCharacters: number): ClipboardImportResult {
  if (inputCharacters > CLIPBOARD_LIMITS.characters) throw new ClipboardImportError('剪贴板内容过大，请分段粘贴（每次最多 1600 万字符）');
  const diagnostics = new Set<string>(); let nodes = 0, cells = 0;
  const styleRules = new Map<string, Style>(); let ruleCount = 0;
  for (const element of Array.from(document.querySelectorAll('style'))) {
    for (const match of (element.textContent ?? '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (++ruleCount > CLIPBOARD_LIMITS.rules) { diagnostics.add('部分复杂样式已简化'); break; }
      const style = declarations(match[2]);
      for (const selector of match[1].split(',')) {
        const key = selector.trim().toLowerCase();
        if (!/^(?:[a-z][\w-]*)?(?:\.[\w-]+)?$/.test(key)) continue;
        styleRules.set(key, Object.assign(styleRules.get(key) ?? {}, style));
      }
    }
  }
  function styleFor(element: Element): Style {
    const tag = element.tagName.toLowerCase(), keys = [tag];
    for (const name of (element.getAttribute('class') ?? '').toLowerCase().split(/\s+/)) if (name) keys.push('.' + name, tag + '.' + name);
    const result: Style = {};
    for (const key of keys) Object.assign(result, styleRules.get(key));
    return Object.assign(result, declarations(element.getAttribute('style') ?? ''));
  }
  function count(depth: number) {
    if (++nodes > CLIPBOARD_LIMITS.nodes || depth > CLIPBOARD_LIMITS.depth) throw new ClipboardImportError('剪贴板结构过大或嵌套过深，请分段粘贴');
  }
  function marksFor(element: Element, inherited: Mark[], style: Style): Mark[] {
    const marks = [...inherited], tag = element.tagName.toUpperCase();
    const add = (type: string, attrs?: Record<string, unknown>) => { const at = marks.findIndex(mark => mark.type === type); if (at >= 0) marks.splice(at, 1); marks.push({ type, ...(attrs ? { attrs } : {}) }); };
    if (['B', 'STRONG'].includes(tag) || /^(bold|[6-9]00)$/i.test(style['font-weight'] ?? '')) add('bold');
    if (['I', 'EM'].includes(tag) || style['font-style'] === 'italic') add('italic');
    if (tag === 'U' || style['text-decoration']?.includes('underline')) add('underline');
    if (['S', 'STRIKE', 'DEL'].includes(tag) || style['text-decoration']?.includes('line-through')) add('strike');
    if (tag === 'CODE') add('code');
    const color = clipboardColor(style.color || element.getAttribute('color') || undefined); if (color) add('textColor', { color });
    const highlight = clipboardColor(style['background-color'] || style.background); if (highlight && !['TD', 'TH', 'TABLE', 'TR'].includes(tag)) add('highlight', { color: highlight });
    if (tag === 'MARK' && !highlight) add('highlight', { color: '#ffff00' });
    if (tag === 'A') { const href = safeClipboardUrl(element.getAttribute('href') ?? ''); if (href) add('link', { href }); }
    return marks;
  }
  const paragraph = (content: JSONContent[] = [], attrs?: Record<string, unknown>): JSONContent => ({ type: 'paragraph', ...(attrs ? { attrs } : {}), ...(content.length ? { content } : {}) });
  function alignment(element: Element, style: Style) {
    const textAlign = style['text-align'] || element.getAttribute('align');
    return textAlign && ['left', 'center', 'right'].includes(textAlign) ? { textAlign } : undefined;
  }
  function image(element: Element): JSONContent {
    const raw = element.getAttribute('src') ?? '', src = safeClipboardUrl(raw, true), alt = element.getAttribute('alt') || element.getAttribute('o:title') || '';
    if (!src) { diagnostics.add('无法读取的图片已保留替代文字和来源'); return paragraph([{ type: 'text', text: `[图片：${alt || '不可读取'}${raw ? `；来源：${raw.slice(0, 300)}` : ''}]` }]); }
    return { type: 'image', attrs: { src, alt, title: element.getAttribute('title') } };
  }
  const visibleImageSources = new Set(Array.from(document.querySelectorAll('img')).map(element => element.getAttribute('src')));
  function officeCommentImage(node: globalThis.Node): JSONContent | null {
    if (node.nodeType !== 8 || !/<v:imagedata\b/i.test(node.textContent ?? '')) return null;
    const wrapper = document.createElement('div'); wrapper.innerHTML = node.textContent ?? '';
    const element = Array.from(wrapper.querySelectorAll('*')).find(child => child.tagName.toUpperCase() === 'V:IMAGEDATA');
    return element && !visibleImageSources.has(element.getAttribute('src')) ? image(element) : null;
  }
  const preservesSpaces = (style: Style) => /^(?:pre|pre-wrap|break-spaces)$/.test(style['white-space'] ?? '') || style['mso-spacerun'] === 'yes';
  function wordListMarker(element: Element): string {
    const marker = Array.from(element.querySelectorAll('[style]')).find(child => declarations(child.getAttribute('style') ?? '')['mso-list']?.toLowerCase() === 'ignore');
    if (marker) return marker.textContent ?? '';
    for (const child of Array.from(element.childNodes)) if (child.nodeType === 8 && /mso-list\s*:\s*Ignore/i.test(child.textContent ?? '')) {
      const wrapper = document.createElement('div'); wrapper.innerHTML = child.textContent ?? '';
      const marker = Array.from(wrapper.querySelectorAll('[style]')).find(node => declarations(node.getAttribute('style') ?? '')['mso-list']?.toLowerCase() === 'ignore');
      if (marker) return marker.textContent ?? '';
    }
    return element.textContent ?? '';
  }
  function inline(parent: globalThis.Node, inherited: Mark[], depth: number, preserve = false): JSONContent[] {
    const result: JSONContent[] = [];
    for (const node of Array.from(parent.childNodes)) {
      count(depth);
      if (node.nodeType === 3) { const text = preserve ? node.textContent ?? '' : (node.textContent ?? '').replace(/[\t\r\n ]+/g, ' '); if (text) result.push({ type: 'text', text, ...(inherited.length ? { marks: inherited } : {}) }); continue; }
      if (node.nodeType !== 1) { const fallback = officeCommentImage(node); if (fallback) result.push(fallback); continue; }
      const element = node as Element, tag = element.tagName.toUpperCase(), style = styleFor(element);
      const math = clipboardMathElement(element);
      if (math && style.display !== 'none') { if (math.type === 'mathInline') math.marks = marksFor(element, inherited, style); result.push(math); continue; }
      if (skipped.has(tag) || style['mso-list']?.toLowerCase() === 'ignore' || style.display === 'none') continue;
      if (tag === 'BR') { result.push({ type: 'hardBreak' }); continue; }
      if (tag === 'IMG' || tag === 'V:IMAGEDATA') { result.push(image(element)); continue; }
      result.push(...inline(element, marksFor(element, inherited, style), depth + 1, preserve || preservesSpaces(style)));
    }
    return result;
  }
  function textBlock(element: Element, inherited: Mark[], depth: number): JSONContent[] {
    const style = styleFor(element), marks = marksFor(element, inherited, style), attrs = alignment(element, style);
    const tag = element.tagName.toUpperCase(), type = /^H[1-6]$/.test(tag) ? 'heading' : 'paragraph';
    const output: JSONContent[] = []; let content: JSONContent[] = [];
    const flush = (trimEmpty = false) => { if (content.length && (!trimEmpty || content.some(node => node.type !== 'text' || node.text?.trim()))) output.push({ type, ...(attrs || type === 'heading' ? { attrs: { ...attrs, ...(type === 'heading' ? { level: Number(tag[1]) } : {}) } } : {}), content }); content = []; };
    // Split block images at their original inline position; no second descendant scan.
    for (const child of clipboardTextMath(inline(element, marks, depth + 1, preservesSpaces(style)))) {
      if (child.type === 'image' || child.type === 'paragraph' || child.type === 'mathBlock') { flush(child.type === 'mathBlock'); output.push(child); }
      else content.push(child);
    }
    flush(output.at(-1)?.type === 'mathBlock'); return output.length ? output : [{ type, ...(attrs || type === 'heading' ? { attrs: { ...attrs, ...(type === 'heading' ? { level: Number(tag[1]) } : {}) } } : {}) }];
  }
  function list(element: Element, inherited: Mark[], depth: number): JSONContent {
    const content: JSONContent[] = [];
    for (const child of Array.from(element.children)) {
      if (child.tagName.toUpperCase() !== 'LI') continue;
      const body = flow(child, inherited, depth + 1); if (body[0]?.type !== 'paragraph') body.unshift(paragraph());
      content.push({ type: 'listItem', content: body.length ? body : [paragraph()] });
    }
    return { type: element.tagName.toUpperCase() === 'OL' ? 'orderedList' : 'bulletList', ...(element.tagName.toUpperCase() === 'OL' ? { attrs: { start: Math.max(1, Number(element.getAttribute('start')) || 1) } } : {}), content: content.length ? content : [{ type: 'listItem', content: [paragraph()] }] };
  }
  function table(element: Element, inherited: Mark[], depth: number): JSONContent {
    const rows: JSONContent[] = [];
    const spanEnds = new Map<number, number>(); let activeSpanWidth = 0, maximumWidth = 0;
    for (const row of Array.from(element.querySelectorAll('tr'))) {
      if (row.closest('table') !== element) continue;
      const content: JSONContent[] = [];
      const rowIndex = rows.length; activeSpanWidth -= spanEnds.get(rowIndex) ?? 0;
      let rowWidth = activeSpanWidth;
      for (const cell of Array.from(row.children)) {
        if (!['TD', 'TH'].includes(cell.tagName.toUpperCase())) continue;
        if (++cells > CLIPBOARD_LIMITS.cells) throw new ClipboardImportError('表格过大，请分段粘贴（每次最多 10 万个单元格）');
        const style = styleFor(cell), align = alignment(cell, style), body = flow(cell, marksFor(cell, inherited, style), depth + 1, preservesSpaces(style));
        if (align) for (const block of body) if (['paragraph', 'heading'].includes(block.type ?? '')) block.attrs = { ...block.attrs, ...align };
        const span = (name: string) => Math.min(100, Math.max(1, Number(cell.getAttribute(name)) || 1));
        const colspan = span('colspan'), rowspan = span('rowspan'); rowWidth += colspan;
        if (rowspan > 1) { activeSpanWidth += colspan; spanEnds.set(rowIndex + rowspan, (spanEnds.get(rowIndex + rowspan) ?? 0) + colspan); }
        content.push({ type: cell.tagName.toUpperCase() === 'TH' ? 'tableHeader' : 'tableCell', attrs: { colspan, rowspan, background: clipboardColor(style['background-color'] || style.background || cell.getAttribute('bgcolor') || undefined), verticalAlign: ['top', 'middle', 'bottom'].includes(style['vertical-align']) ? style['vertical-align'] : null }, content: body.length ? body : [paragraph()] });
      }
      if (content.length || rowWidth) {
        rows.push({ type: 'tableRow', content }); maximumWidth = Math.max(maximumWidth, rowWidth);
        if (maximumWidth * rows.length > CLIPBOARD_LIMITS.cells) throw new ClipboardImportError('表格展开后的网格过大，请分段粘贴');
      }
    }
    return rows.length ? { type: 'table', content: rows } : paragraph();
  }
  function flow(parent: globalThis.Node, inherited: Mark[], depth: number, preserve = false): JSONContent[] {
    const result: JSONContent[] = []; let pending: JSONContent[] = [];
    const flush = () => {
      let text: JSONContent[] = [];
      const emit = () => { if (text.some(node => node.type !== 'text' || node.text?.trim())) result.push(paragraph(text)); text = []; };
      for (const child of clipboardTextMath(pending)) { if (child.type === 'mathBlock') { emit(); result.push(child); } else text.push(child); }
      emit(); pending = [];
    };
    let wordLists: { level: number; id: string; node: JSONContent }[] = [];
    for (const node of Array.from(parent.childNodes)) {
      count(depth);
      if (node.nodeType === 3) { const text = preserve ? node.textContent ?? '' : (node.textContent ?? '').replace(/[\t\r\n ]+/g, ' '); if (text) pending.push({ type: 'text', text, ...(inherited.length ? { marks: inherited } : {}) }); continue; }
      if (node.nodeType !== 1) { const fallback = officeCommentImage(node); if (fallback) { flush(); result.push(fallback); } continue; }
      const element = node as Element, tag = element.tagName.toUpperCase(), style = styleFor(element);
      const math = clipboardMathElement(element);
      if (math && style.display !== 'none') {
        if (math.type === 'mathBlock') { flush(); result.push(math); }
        else { math.marks = marksFor(element, inherited, style); pending.push(math); }
        continue;
      }
      if (skipped.has(tag) || style.display === 'none') continue;
      if (tag === 'FIGURE' && element.querySelectorAll('img').length === 1 && element.querySelector('figcaption')) {
        flush();
        const picture = image(element.querySelector('img')!), caption = element.querySelector('figcaption')!;
        if (picture.type === 'image') {
          const content = inline(caption, [], depth + 1, true).filter(child => child.type === 'text' || child.type === 'hardBreak');
          picture.attrs = { ...picture.attrs, caption: figureCaptionText(content), captionContent: content.length ? content : null };
          result.push(picture);
        } else result.push(picture, ...textBlock(caption, inherited, depth + 1));
        continue;
      }
      if (tag === 'BR') { pending.push({ type: 'hardBreak' }); continue; }
      if (!blocks.has(tag) && tag !== 'IMG' && tag !== 'V:IMAGEDATA') {
        if (Array.from(element.children).some(child => blocks.has(child.tagName.toUpperCase()))) {
          flush(); result.push(...flow(element, marksFor(element, inherited, style), depth + 1, preserve || preservesSpaces(style))); continue;
        }
        for (const child of inline(element, marksFor(element, inherited, style), depth + 1, preserve || preservesSpaces(style))) {
          if (child.type === 'image' || child.type === 'paragraph' || child.type === 'mathBlock') { flush(); result.push(child); } else pending.push(child);
        }
        continue;
      }
      flush();
      if (tag === 'P' && /\bl\d+\s+level\d+/.test(style['mso-list'] ?? '')) {
        const level = Math.min(9, Number(/level(\d+)/.exec(style['mso-list'])?.[1]) || 1);
        const id = (style['mso-list'] ?? '').replace(/\s*level\d+\s*/, ' ').trim();
        const marker = wordListMarker(element);
        const type = /^\s*(?:\d+|[a-zA-Z]+|[一二三四五六七八九十百]+)[.)、．]/.test(marker) ? 'orderedList' : 'bulletList';
        const body = textBlock(element, inherited, depth), item: JSONContent = { type: 'listItem', content: body };
        if (body[0]?.type !== 'paragraph') body.unshift(paragraph());
        while (wordLists.length && (wordLists.at(-1)!.id !== id || wordLists.at(-1)!.level > level || (wordLists.at(-1)!.level === level && wordLists.at(-1)!.node.type !== type))) wordLists.pop();
        let current = wordLists.at(-1);
        if (!current || current.level < level) {
          const next: JSONContent = { type, ...(type === 'orderedList' ? { attrs: { start: Number(/^\s*(\d+)/.exec(marker)?.[1]) || 1 } } : {}), content: [] };
          if (current) current.node.content!.at(-1)!.content!.push(next); else result.push(next);
          current = { level, id, node: next }; wordLists.push(current);
        }
        current.node.content!.push(item); continue;
      }
      wordLists = [];
      if (tag === 'IMG' || tag === 'V:IMAGEDATA') result.push(image(element));
      else if (tag === 'UL' || tag === 'OL') result.push(list(element, inherited, depth));
      else if (tag === 'TABLE') result.push(table(element, inherited, depth));
      else if (tag === 'HR') result.push({ type: 'horizontalRule' });
      else if (tag === 'PRE') result.push({ type: 'codeBlock', content: element.textContent ? [{ type: 'text', text: element.textContent }] : [] });
      else if (tag === 'BLOCKQUOTE') { const content = flow(element, inherited, depth + 1); result.push({ type: 'blockquote', content: content.length ? content : [paragraph()] }); }
      else if (['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(tag)) result.push(...textBlock(element, inherited, depth));
      else result.push(...flow(element, marksFor(element, inherited, style), depth + 1, preserve || preservesSpaces(style)));
    }
    flush(); return result;
  }
  const content = flow(document.body ?? document.documentElement, [], 0);
  return { content: content.length ? content : [paragraph()], diagnostics: [...diagnostics], nodes };
}
