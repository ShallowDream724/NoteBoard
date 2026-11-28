import type { JSONContent } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';
import type { AuthoringSpan } from './types';
import { parseColor } from './registry';
import { readMath, readMathBlock } from '../editor-md/mathSyntax';
import { nativeInlineEncoding, nativeJsonSpans } from './nativeJsonSpans';

export interface WrittenAuthoring { text: string; spans: AuthoringSpan[] }
const quote = (value: unknown) => JSON.stringify(String(value ?? ''));
// Escape the closing bracket to protect literal links. Escaping both brackets
// would turn prose such as files=[a, b] into a TeX display-math delimiter pair.
const escapeText = (text: string) => text.replace(/[\\`*_\]{}<>!~|#$+=.\-:&]/g, '\\$&');
export function writeAuthoring(document: JSONContent, schema?: Schema): WrittenAuthoring {
  let text = ''; const spans: AuthoringSpan[] = [];
  const append = (value: string) => { text += value; };
  const defaults = (type: string) => (schema?.nodes[type]?.spec.attrs ?? {});
  function unexpected(node: JSONContent, allowed: string[]) {
    const attrs = node.attrs ?? {}, baseline = defaults(node.type ?? '');
    return Object.keys(attrs).some(key => !allowed.includes(key) && JSON.stringify(attrs[key]) !== JSON.stringify(baseline[key]?.default));
  }
  const percent = (value: unknown) => typeof value === 'string' && /^\d+(?:\.\d+)?%$/.test(value) && parseFloat(value) > 0 && parseFloat(value) <= 100;
  function markSupported(mark: NonNullable<JSONContent['marks']>[number]) {
    const allowed: Record<string, string[]> = { bold: [], italic: [], strike: [], underline: [], conceal: [], textColor: ['color'], highlight: ['color'], annotationReference: ['id'], link: ['href', 'title'], code: [] };
    if (!allowed[mark.type]) return false;
    const baseline = schema?.marks[mark.type]?.spec.attrs ?? {};
    if (Object.entries(mark.attrs ?? {}).some(([key, value]) => !allowed[mark.type].includes(key) && JSON.stringify(value) !== JSON.stringify(baseline[key]?.default))) return false;
    if (mark.type === 'textColor' || mark.type === 'highlight') return typeof mark.attrs?.color === 'string' && parseColor(mark.attrs.color) === mark.attrs.color;
    if (mark.type === 'annotationReference') return typeof mark.attrs?.id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(mark.attrs.id);
    if (mark.type === 'link') return typeof mark.attrs?.href === 'string' && !/[\s<>]/.test(mark.attrs.href) && (mark.attrs?.title === null || mark.attrs?.title === undefined || typeof mark.attrs.title === 'string' && !!mark.attrs.title && !/[\r\n]/.test(mark.attrs.title));
    return true;
  }
  function imageSupported(node: JSONContent, slot = false) {
    const attrs = node.attrs ?? {};
    if (node.marks?.length || unexpected(node, slot ? ['src', 'alt', 'title'] : ['src', 'alt', 'title', 'width', 'align', 'caption', 'captionContent', 'annotationId'])) return false;
    if (typeof attrs.src !== 'string' || typeof attrs.alt !== 'string' || /[\s<>]/.test(attrs.src) || /[\r\n]/.test(attrs.alt) || (attrs.title !== null && (typeof attrs.title !== 'string' || !attrs.title || /[\r\n]/.test(attrs.title)))) return false;
    if (!slot && (!percent(attrs.width) || !['left', 'center', 'right'].includes(attrs.align))) return false;
    return slot || captionSupported(attrs);
  }
  function captionSupported(attrs: Record<string, unknown>) {
    const rich = attrs.captionContent;
    if (rich === null || rich === undefined) return attrs.caption === null || attrs.caption === undefined;
    if (!Array.isArray(rich) || !rich.length || rich.some(node => node.type !== 'text')) return false;
    return attrs.caption === rich.map(node => node.text ?? '').join('');
  }
  const listTypes = new Set(['bulletList', 'orderedList', 'taskList']);
  function needsNativeListContainer(node: JSONContent): boolean {
    return !!node.content?.some(item => {
      const nested = item.content?.filter(child => listTypes.has(child.type ?? '')) ?? [];
      // A Markdown item cannot reliably retain several sibling list segments
      // when some segments become fenced native blocks. Preserve their common
      // list container rather than letting indentation change their ancestry.
      return nested.length > 1 || nested.some(child => !!child.marks?.length || unexpected(child, ['start']) || needsNativeListContainer(child));
    });
  }
  function literal(value: string, path: number[], kind: 'text' | 'attribute' = 'text', escape = true) {
    const from = text.length, offsets: number[] = [];
    for (let i = 0; i < value.length; i++) { const part = escape ? escapeText(value[i]) : value[i]; offsets.push(text.length + part.length - 1); append(part); }
    offsets.push(text.length); spans.push({ path, kind, from, to: text.length, contentFrom: from, contentTo: text.length, offsets });
  }
  function native(node: JSONContent, path: number[]) {
    const json = JSON.stringify(node, null, 2), fence = ':'.repeat(Math.max(3, ...[...json.matchAll(/^(:+)/gm)].map(match => match[1].length + 1)));
    const from = text.length; append(`${fence} native version=1\n`); const payloadFrom = text.length; append(json); spans.push(...nativeJsonSpans(json, node, path, offset => payloadFrom + offset)); append(`\n${fence}`); spans.push({ path, from, to: text.length, kind: 'node' });
  }
  function nativeInline(node: JSONContent, path: number[]) {
    const json = JSON.stringify(node), { encoded, offsets } = nativeInlineEncoding(json), from = text.length;
    append('\\native[version=1]{'); const payloadFrom = text.length; append(encoded); spans.push(...nativeJsonSpans(json, node, path, offset => payloadFrom + offsets[offset], 'base64json')); append('}'); spans.push({ path, from, to: text.length, kind: 'node' });
  }
  function image(node: JSONContent, path: number[]) {
    const attrs = node.attrs ?? {}, from = text.length;
    append(`![${String(attrs.alt ?? '').replace(/[\\[\]]/g, '\\$&')}](${String(attrs.src ?? '').replace(/[\\()]/g, '\\$&')}${attrs.title !== null && attrs.title !== undefined ? ' ' + quote(attrs.title) : ''})`);
    spans.push({ path, from, to: text.length, kind: 'node' });
  }
  function inline(nodes: JSONContent[], path: number[]) {
    nodes.forEach((node, index) => {
      const ownPath = [...path, index], from = text.length;
      if (node.type === 'hardBreak' && index === nodes.length - 1) { nativeInline(node, ownPath); return; }
      if (!['text', 'hardBreak', 'mathInline'].includes(node.type ?? '')) { nativeInline(node, ownPath); return; }
      const marks = node.marks ?? [], close: string[] = [];
      if (marks.some(mark => !markSupported(mark)) || unexpected(node, node.type === 'mathInline' ? ['latex', 'delimiter'] : [])) { nativeInline(node, ownPath); return; }
      if (node.type === 'text' && (/\n[ \t]*\n|[ \t]{2,}\n|(?:^|\n)(?: {4}|\t)/.test(node.text ?? '') || marks.some(mark => mark.type === 'code') && /[\r\n]/.test(node.text ?? ''))) { nativeInline(node, ownPath); return; }
      if (node.type === 'mathInline') {
        const delimiter = String(node.attrs?.delimiter ?? '$'), latex = String(node.attrs?.latex ?? ''), end = delimiter === '\\(' ? '\\)' : delimiter;
        const match = readMath(delimiter + latex + end);
        if (!['$', '\\('].includes(delimiter) || !match || match.latex !== latex) { nativeInline(node, ownPath); return; }
      }
      for (const mark of marks) {
        const commands: Record<string, string> = { bold: 'b', italic: 'i', strike: 's', underline: 'u', conceal: 'blur', textColor: 'color', highlight: 'bg', annotationReference: 'note' };
        if (commands[mark.type]) {
          const parameter = ['textColor', 'highlight'].includes(mark.type) ? `[${String(mark.attrs?.color ?? '')}]` : mark.type === 'annotationReference' ? `[ref=${String(mark.attrs?.id ?? '')}]` : '';
          append(`\\${commands[mark.type]}${parameter}{`); close.unshift('}');
        } else if (mark.type === 'link') { append('['); close.unshift(`](${String(mark.attrs?.href ?? '').replace(/[()\\]/g, '\\$&')}${mark.attrs?.title !== null && mark.attrs?.title !== undefined ? ' ' + quote(mark.attrs.title) : ''})`); }
      }
      if (node.type === 'mathInline') {
        const delimiter = String(node.attrs?.delimiter ?? '$'), end = delimiter === '\\(' ? '\\)' : delimiter === '\\[' ? '\\]' : delimiter;
        append(delimiter); literal(String(node.attrs?.latex ?? ''), ownPath, 'attribute', false); append(end);
      } else if (node.type === 'hardBreak') append('  \n');
      else if (marks.some(mark => mark.type === 'code')) {
        const content = node.text ?? '', fence = '`'.repeat(Math.max(1, ...[...content.matchAll(/`+/g)].map(match => match[0].length + 1)));
        append(fence); const pad = content.startsWith('`') || content.endsWith('`') || (/^ .+ $/.test(content)) ? ' ' : ''; append(pad); literal(content, ownPath, 'text', false); append(pad + fence);
      } else literal(node.text ?? '', ownPath, 'text', !marks.some(mark => mark.type === 'authoringLiteral'));
      close.forEach(append); spans.push({ path: ownPath, from, to: text.length, kind: 'node' });
    });
  }
  function wrap(header: string, body: () => void) {
    // Longer fences make nested blocks unambiguous while preserving host scopes.
    const start = text.length; append('::: ' + header + '\n'); const bodyStart = text.length; body();
    const content = text.slice(bodyStart), length = Math.max(3, ...[...content.matchAll(/^(:{3,})/gm)].map(match => match[1].length + 1));
    if (length > 3) { const extra = ':'.repeat(length - 3); text = text.slice(0, start) + extra + text.slice(start); for (const span of spans) if (span.from >= bodyStart) { span.from += extra.length; span.to += extra.length; if (span.contentFrom !== undefined) span.contentFrom += extra.length; if (span.contentTo !== undefined) span.contentTo += extra.length; if (span.offsets) span.offsets = span.offsets.map(offset => offset + extra.length); } }
    append('\n' + ':'.repeat(length));
  }
  function children(nodes: JSONContent[], path: number[]) { nodes.forEach((child, index) => { if (index) append(/^(?:bulletList|orderedList|taskList)$/.test(child.type ?? '') && /^(?:bulletList|orderedList|taskList)$/.test(nodes[index - 1].type ?? '') ? '\n\n<!-- noteboard-list-boundary -->\n\n' : '\n\n'); block(child, [...path, index]); }); }
  function block(node: JSONContent, path: number[], suppressPresentation = false) {
    const from = text.length, attrs = node.attrs ?? {}, type = node.type ?? '';
    if (listTypes.has(type) && needsNativeListContainer(node)) { native(node, path); return; }
    const allowed: Record<string, string[]> = {
      paragraph: ['textAlign', 'blockBackground', 'annotationId'], heading: ['level', 'textAlign', 'blockBackground', 'annotationId'], blockquote: ['blockBackground', 'annotationId'],
      bulletList: ['blockBackground', 'annotationId'], orderedList: ['start', 'blockBackground', 'annotationId'], taskList: ['blockBackground', 'annotationId'],
      codeBlock: ['language', 'annotationId'], horizontalRule: ['annotationId'], mathBlock: ['latex', 'delimiter', 'textAlign', 'background', 'annotationId'],
      mermaidBlock: ['code', 'annotationId'], plantumlBlock: ['code', 'annotationId'], infographicBlock: ['code', 'annotationId'],
      disclosure: ['title', 'open', 'annotationId'], githubAlert: ['kind', 'title', 'icon', 'backgroundColor', 'borderColor', 'annotationId'],
      image: ['src', 'alt', 'title', 'width', 'align', 'caption', 'captionContent', 'annotationId'], imageCollection: ['layout', 'columns', 'width', 'align', 'annotationId'], table: ['tableAlign', 'caption', 'captionContent', 'annotationId'],
      annotationStore: [], annotationBody: ['id'], authoringRaw: [],
    };
    if (!allowed[type] || unexpected(node, allowed[type]) || node.marks?.length) { native(node, path); return; }
    // Markdown interprets whitespace-only lines as block separators. Keep an
    // actual whitespace text node distinct from an empty paragraph.
    if (type === 'paragraph' && node.content?.length && node.content.every(child => child.type === 'text' && /^[\t \r\n]+$/.test(child.text ?? ''))) { native(node, path); return; }
    // ATX headings end at a physical newline. Rich editing can produce a
    // single heading containing several lines, which must remain one node.
    if (type === 'heading' && node.content?.some(child => child.type === 'hardBreak' || /[\r\n]/.test(child.text ?? ''))) { native(node, path); return; }
    if (type === 'image' && !imageSupported(node) || type === 'table' && !captionSupported(attrs) || type === 'disclosure' && (typeof attrs.title !== 'string' || !attrs.title.trim() || /[\r\n\t]/.test(attrs.title))) { native(node, path); return; }
    if (type === 'mathBlock') { const delimiter = String(attrs.delimiter ?? '$$'), latex = String(attrs.latex ?? ''), match = readMathBlock(delimiter + '\n' + latex + '\n' + (delimiter === '\\[' ? '\\]' : delimiter)); if (!['$$', '\\['].includes(delimiter) || !match || match.latex !== latex) { native(node, path); return; } }
    if (type === 'codeBlock' && (attrs.language !== null && (typeof attrs.language !== 'string' || !/^[a-zA-Z0-9_+.-]+$/.test(attrs.language)))) { native(node, path); return; }
    if (!suppressPresentation && ((attrs.textAlign && JSON.stringify(attrs.textAlign) !== JSON.stringify(defaults(type).textAlign?.default)) || attrs.blockBackground || attrs.background)) {
      if (attrs.blockBackground || attrs.background) wrap(`bg ${attrs.blockBackground ?? attrs.background}`, () => {
        const strippedAttrs: Record<string, unknown> = { ...attrs, annotationId: null }; if ('blockBackground' in attrs) strippedAttrs.blockBackground = defaults(type).blockBackground?.default; if ('background' in attrs) strippedAttrs.background = defaults(type).background?.default;
        block({ ...node, attrs: strippedAttrs }, path);
      });
      else wrap(String(attrs.textAlign), () => block({ ...node, attrs: { ...attrs, annotationId: null } }, path, true));
    } else if (type === 'authoringRaw') native(node, path);
    else if (type === 'paragraph' || type === 'heading') { if (type === 'heading') append('#'.repeat(Number(attrs.level ?? 1)) + ' '); inline(node.content ?? [], path); }
    else if (type === 'horizontalRule') append('---');
    else if (type === 'mathBlock') { const delimiter = String(attrs.delimiter ?? '$$'); append(delimiter + '\n'); literal(String(attrs.latex ?? ''), path, 'attribute', false); append('\n' + (delimiter === '\\[' ? '\\]' : delimiter)); }
    else if (['codeBlock', 'mermaidBlock', 'plantumlBlock', 'infographicBlock'].includes(type)) {
      const code = type === 'codeBlock' ? node.content?.map(child => child.text ?? '').join('') ?? '' : String(attrs.code ?? '');
      const fence = '`'.repeat(Math.max(3, ...[...code.matchAll(/`+/g)].map(match => match[0].length + 1))), language = type === 'codeBlock' ? String(attrs.language ?? '') : type.replace('Block', '').replace('plantuml', 'plantuml');
      append(fence + language + '\n'); literal(code, type === 'codeBlock' ? [...path, 0] : path, type === 'codeBlock' ? 'text' : 'attribute', false); append('\n' + fence);
    } else if (type === 'blockquote') {
      // Render into the same buffer, then add quote prefixes while remapping spans.
      const bodyStart = text.length; children(node.content ?? [], path); const body = text.slice(bodyStart); prefixRegion(bodyStart, body, '> ');
    } else if (['bulletList', 'orderedList', 'taskList'].includes(type)) {
      if (node.content?.some(item => unexpected(item, ['checked']))) { native(node, path); return; }
      (node.content ?? []).forEach((item, index) => { if (index) append('\n'); const start = text.length; children(item.content ?? [], [...path, index]); const body = text.slice(start), prefix = type === 'orderedList' ? `${Number(attrs.start ?? 1) + index}. ` : type === 'taskList' ? `- [${item.attrs?.checked ? 'x' : ' '}] ` : '- '; prefixRegion(start, body, prefix, ' '.repeat(prefix.length)); });
    } else if (type === 'disclosure') wrap(`fold ${quote(attrs.title)}${attrs.open ? ' open' : ''}`, () => children(node.content ?? [], path));
    else if (type === 'githubAlert') wrap(`${attrs.kind ?? 'note'}${attrs.title !== null && attrs.title !== undefined ? ' title=' + quote(attrs.title) : ''}${attrs.icon ? ' icon=' + quote(attrs.icon) : ''}${attrs.backgroundColor ? ' bg=' + attrs.backgroundColor : ''}${attrs.borderColor ? ' border=' + attrs.borderColor : ''}`, () => children(node.content ?? [], path));
    else if (type === 'image') wrap(`pic ${attrs.align ?? 'center'} ${attrs.width ?? '100%'}`, () => { image(node, path); if (attrs.captionContent?.length || attrs.caption) { append('\n\n'); if (Array.isArray(attrs.captionContent)) inline(attrs.captionContent, path); else append(escapeText(String(attrs.caption))); } });
    else if (type === 'imageCollection') {
      const slots = node.content ?? [], columns = Number(attrs.columns ?? 2);
      if (slots.some(slot => slot.marks?.length || unexpected(slot, []) || slot.content?.some(child => child.type === 'image' ? !imageSupported(child, true) : child.type !== 'paragraph' || child.marks?.length || unexpected(child, [])))) { native(node, path); return; }
      if (attrs.layout !== 'carousel' && slots.length % columns !== 0) { native(node, path); return; }
      wrap(`${attrs.layout === 'carousel' ? 'slide print-cols=' + columns : 'pic ' + (slots.length / columns) + '*' + columns} ${attrs.align ?? 'center'} ${attrs.width ?? '100%'}`, () => {
        slots.forEach((slot, index) => { if (index) append('\n'); append('-'); if (!slot.content?.length) return; append(' '); slot.content.forEach((child, childIndex) => { if (childIndex) append('\n  '); if (child.type === 'image') image(child, [...path, index, childIndex]); else { const start = text.length; inline(child.content ?? [], [...path, index, childIndex]); const body = text.slice(start); if (body.includes('\n')) prefixRegion(start, body, '', '  '); } }); });
      });
    } else if (type === 'table') {
      const rows = node.content ?? [], columns = rows[0]?.content?.length ?? 0;
      const supported = rows.length > 0 && columns > 0 && rows.every((row, r) => !row.marks?.length && !unexpected(row, []) && row.content?.length === columns && row.content.every((cell, c) => !cell.marks?.length && !unexpected(cell, ['colspan', 'rowspan', 'colwidth', 'align']) && (!cell.attrs?.colspan || cell.attrs.colspan === 1) && (!cell.attrs?.rowspan || cell.attrs.rowspan === 1) && JSON.stringify(cell.attrs?.colwidth) === JSON.stringify(rows[0].content![c].attrs?.colwidth) && cell.attrs?.align === rows[0].content![c].attrs?.align && cell.type === (r ? 'tableCell' : 'tableHeader') && cell.content?.length === 1 && cell.content[0].type === 'paragraph' && !cell.content[0].marks?.length && !unexpected(cell.content[0], []) && !cell.content[0].content?.some(child => child.type === 'hardBreak' || child.text?.includes('\n'))));
      if (!supported) { native(node, path); return; }
      const widths = rows[0].content!.map(cell => cell.attrs?.colwidth?.[0]);
      if (rows[0].content!.some(cell => cell.attrs?.colwidth !== null && cell.attrs?.colwidth !== undefined) && !rows[0].content!.every(cell => Array.isArray(cell.attrs?.colwidth) && cell.attrs.colwidth.length === 1 && typeof cell.attrs.colwidth[0] === 'number' && cell.attrs.colwidth[0] > 0)) { native(node, path); return; }
      wrap(`table${attrs.tableAlign ? ' ' + attrs.tableAlign : ''}${widths.every(Boolean) ? ' widths=[' + widths.join(',') + ']' : ''}`, () => {
        rows.forEach((row, r) => { if (r) append('\n'); append('| '); row.content!.forEach((cell, c) => { if (c) append(' | '); inline(cell.content![0].content ?? [], [...path, r, c, 0]); }); append(' |'); if (!r) append('\n| ' + row.content!.map(cell => cell.attrs?.align === 'center' ? ':---:' : cell.attrs?.align === 'right' ? '---:' : cell.attrs?.align === 'left' ? ':---' : '---').join(' | ') + ' |'); });
        if (attrs.captionContent?.length || attrs.caption) { append('\n\n'); if (Array.isArray(attrs.captionContent)) inline(attrs.captionContent, path); else append(escapeText(String(attrs.caption))); }
      });
    } else if (type === 'annotationStore') children(node.content ?? [], path);
    else if (type === 'annotationBody') wrap(`annotation id=${attrs.id}`, () => children(node.content ?? [], path));
    spans.push({ path, from, to: text.length, kind: 'node' });
    if (attrs.annotationId) { append('\n\n'); wrap(`explain ref=${attrs.annotationId}`, () => {}); }
  }
  function prefixRegion(start: number, body: string, first: string, following = first) {
    const lineStarts = [0]; for (let i = 0; i < body.length; i++) if (body[i] === '\n') lineStarts.push(i + 1);
    const translate = (position: number) => { const relative = position - start; return position + first.length + lineStarts.slice(1).filter(offset => offset <= relative).length * following.length; };
    for (const span of spans) if (span.from >= start) { span.from = translate(span.from); span.to = translate(span.to); if (span.contentFrom !== undefined) span.contentFrom = translate(span.contentFrom); if (span.contentTo !== undefined) span.contentTo = translate(span.contentTo); if (span.offsets) span.offsets = span.offsets.map(translate); }
    text = text.slice(0, start) + body.split('\n').map((line, index) => (index ? following : first) + line).join('\n');
  }
  if (document.type === 'doc') children(document.content ?? [], []); else block(document, []);
  return { text, spans };
}
