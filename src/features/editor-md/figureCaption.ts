import type { JSONContent } from '@tiptap/core';
import { DOMSerializer, type DOMOutputSpec } from '@tiptap/pm/model';
import { documentColor } from '../document-style/colors';
import { TEXT_STYLE_MARKS } from './textStylePolicy';

export const FIGURE_CAPTION_MAX_LENGTH = 10_000;
export function normalizeFigureCaption(value: unknown): string | null {
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() || null : null;
}
export function validateFigureCaption(value: unknown): void {
  if (value !== null && (typeof value !== 'string' || value.length > FIGURE_CAPTION_MAX_LENGTH || value.includes('\0'))) throw new RangeError('Invalid figure caption');
}
/** A caption is plain text even when it contains Markdown punctuation. */
export function markdownFigureCaption(value: unknown, content?: unknown, render?: (content: JSONContent[]) => string): string {
  if (content && render) return render(figureCaptionContent(value, content));
  return (normalizeFigureCaption(value) ?? '').replace(/[\\`*_{}[\]()<>#+.!|~=-]/g, '\\$&').replace(/\n/g, '  \n');
}

const marks = new Set(['bold', 'italic', 'underline', 'strike', 'code', 'link', 'textColor', 'highlight']);
const safeLink = (value: unknown): value is string => typeof value === 'string' && value.length <= FIGURE_CAPTION_MAX_LENGTH
  && !Array.from(value).some(character => character.charCodeAt(0) < 32) && !/^\s*(?:javascript|vbscript|data):/i.test(value);

/** Captions stay outside table rows, but use the same inline mark vocabulary as body text. */
export function validateFigureCaptionContent(value: unknown): void {
  if (value === null) return;
  if (!Array.isArray(value) || value.length > FIGURE_CAPTION_MAX_LENGTH) throw new RangeError('Invalid figure caption content');
  let length = 0;
  for (const item of value as JSONContent[]) {
    if (!item || typeof item !== 'object' || item.content || item.attrs || !['text', 'hardBreak'].includes(item.type ?? '')) throw new RangeError('Invalid caption inline');
    if (item.type === 'text' && (typeof item.text !== 'string' || !item.text || item.text.includes('\0'))) throw new RangeError('Invalid caption text');
    if (item.type === 'hardBreak' && item.text !== undefined) throw new RangeError('Invalid caption break');
    length += item.type === 'text' ? item.text!.length : 1;
    if (length > FIGURE_CAPTION_MAX_LENGTH || (item.marks && (!Array.isArray(item.marks) || item.marks.length > marks.size))) throw new RangeError('Caption is too long');
    for (const mark of item.marks ?? []) {
      if (!mark || !marks.has(mark.type)) throw new RangeError('Invalid caption mark');
      if (['highlight', 'textColor'].includes(mark.type) && mark.attrs?.color != null && !documentColor(mark.attrs.color)) throw new RangeError('Invalid caption color');
      if (mark.type === 'link' && !safeLink(mark.attrs?.href)) throw new RangeError('Invalid caption link');
      if (mark.attrs && Object.entries(mark.attrs).some(([key, item]) => !['href', 'title', 'target', 'rel', 'class', 'color'].includes(key) || (item !== null && typeof item !== 'string'))) throw new RangeError('Invalid caption mark attributes');
    }
  }
}
export function figureCaptionContent(value: unknown, rich?: unknown): JSONContent[] {
  if (rich != null) {
    try { validateFigureCaptionContent(rich); return rich as JSONContent[]; } catch { /* Read legacy text when optional rich data is invalid. */ }
  }
  return (normalizeFigureCaption(value) ?? '').split('\n').flatMap((line, index) => [...(index ? [{ type: 'hardBreak' }] : []), ...(line ? [{ type: 'text', text: line }] : [])]);
}
/** null means no change. Caption text and links remain, regardless of whether
 * the owning figure stores its caption as attributes or editable paragraphs. */
export function clearedFigureCaption(attrs: Record<string, unknown>): JSONContent[] | null {
  if (attrs.captionContent == null) return null;
  const content = figureCaptionContent(attrs.caption, attrs.captionContent);
  let changed = false;
  const next = content.map(item => {
    const marks = item.marks?.filter(mark => !(TEXT_STYLE_MARKS as readonly string[]).includes(mark.type));
    if (marks?.length === item.marks?.length) return item;
    changed = true; return { ...item, marks };
  });
  return changed ? next : null;
}
export function figureCaptionText(content: JSONContent[]): string | null {
  return normalizeFigureCaption(content.map(item => item.type === 'hardBreak' ? '\n' : item.text ?? '').join(''));
}
export function figureCaptionDOM(value: unknown, rich?: unknown): Array<DOMOutputSpec | string> {
  if (rich == null) return [normalizeFigureCaption(value) ?? ''];
  return figureCaptionContent(value, rich).map(item => {
    let output: DOMOutputSpec | string = item.type === 'hardBreak' ? ['br'] : item.text!;
    for (const mark of [...(item.marks ?? [])].reverse()) {
      const tag = ({ bold: 'strong', italic: 'em', underline: 'u', strike: 's', code: 'code' } as Record<string, string>)[mark.type];
      if (tag) output = [tag, {}, output];
      else if (mark.type === 'link') output = ['a', { href: mark.attrs!.href, ...(mark.attrs?.title ? { title: mark.attrs.title } : {}) }, output];
      else if (mark.type === 'textColor') output = ['span', { 'data-text-color': mark.attrs?.color, style: `color:${mark.attrs?.color};print-color-adjust:exact` }, output];
      else if (mark.type === 'highlight') output = ['mark', { 'data-color': mark.attrs?.color, style: `background-color:${mark.attrs?.color ?? '#ffff00'};color:inherit;print-color-adjust:exact` }, output];
    }
    return output;
  });
}
export function parseFigureCaptionContent(element: Element | null): JSONContent[] | null {
  const encoded = element?.getAttribute('data-nb-caption-content');
  if (!encoded) return null;
  try { const content: unknown = JSON.parse(encoded); validateFigureCaptionContent(content); return content as JSONContent[] | null; } catch { return null; }
}
export function renderFigureCaption(element: HTMLElement, caption: unknown, rich?: unknown) {
  element.replaceChildren(...figureCaptionDOM(caption, rich).map(spec => typeof spec === 'string' ? element.ownerDocument.createTextNode(spec) : DOMSerializer.renderSpec(element.ownerDocument, spec).dom));
}
