import { Extension, type JSONContent, type MarkdownParseHelpers, type MarkdownToken } from '@tiptap/core';
import { commandSpec, parseParameters } from './registry';
import { followingBlockStart } from '../editor-md/markdownLexer';
import { readMath } from '../editor-md/mathSyntax';
import { IMAGE_GRID_MAX_CELLS, IMAGE_GRID_MAX_COLUMNS } from '../../core/document/imageGrid';

export interface Group { from: number; to: number; text: string }
export interface InlineCommand { raw: string; name: string; parameters: string; groups: Group[]; error?: string }
const escaped = (source: string, index: number) => { let slashes = 0; while (index && source[--index] === '\\') slashes++; return slashes % 2 === 1; };

/** Only a complete opaque region can hide braces from the outer group. */
function opaqueEnd(source: string, index: number): number {
  const math = readMath(source, index); if (math) return math.end;
  if (source[index] === '`' && !escaped(source, index)) {
    let end = index; while (source[end] === '`') end++;
    const delimiter = source.slice(index, end); let close = source.indexOf(delimiter, end);
    while (close >= 0 && (source[close - 1] === '`' || source[close + delimiter.length] === '`')) close = source.indexOf(delimiter, close + delimiter.length);
    if (close >= 0) return close + delimiter.length;
  }
  // Markdown destinations have their own parenthesis scope (including escaped braces).
  if (source[index] === ']' && source[index + 1] === '(' && !escaped(source, index)) {
    let depth = 1;
    for (let i = index + 2; i < source.length; i++) {
      if (escaped(source, i)) continue;
      if (source[i] === '(') depth++;
      if (source[i] === ')' && --depth === 0) return i + 1;
    }
  }
  return index;
}
function groupEnd(source: string, start: number, open: string, close: string): number {
  let depth = 1;
  for (let index = start + 1; index < source.length; index++) {
    if (/\r?\n[ \t]*\r?\n/.test(source.slice(index, index + 5))) return -1;
    if (escaped(source, index)) continue;
    const opaque = opaqueEnd(source, index); if (opaque > index) { index = opaque - 1; continue; }
    if (source[index] === open) depth++;
    if (source[index] === close && --depth === 0) return index;
  }
  return -1;
}
export function readInlineCommand(source: string): InlineCommand | null {
  const opening = /^\\([a-z]+)(?=[[{])/i.exec(source); if (!opening) return null;
  const name = commandSpec(opening[1])?.name ?? opening[1].toLowerCase();
  let cursor = opening[0].length, parameters = ''; const groups: Group[] = [];
  const fail = (error: string): InlineCommand => ({ raw: source.split(/\r?\n[ \t]*\r?\n/)[0], name, parameters, groups, error });
  if (source[cursor] === '[') {
    const close = groupEnd(source, cursor, '[', ']'); if (close < 0) return fail('参数未闭合');
    parameters = source.slice(cursor + 1, close); cursor = close + 1;
  }
  const params = parseParameters(name, parameters, false);
  const count = name === 'note' && (params.values.ref || /\bref\s*=/i.test(parameters)) ? 1 : commandSpec(name)?.groups ?? 1;
  for (let group = 0; group < count; group++) {
    if (group || parameters) while (/[ \t]/.test(source[cursor] ?? '') && cursor < source.length) cursor++;
    if (source[cursor] !== '{') return fail('缺少内容组');
    const close = groupEnd(source, cursor, '{', '}'); if (close < 0) return fail('内容组未闭合');
    groups.push({ from: cursor + 1, to: close, text: source.slice(cursor + 1, close) }); cursor = close + 1;
  }
  return { raw: source.slice(0, cursor), name, parameters, groups, ...(params.error ? { error: params.error } : {}) };
}
/** Markdown emphasis delimiters cannot pair through a command's content groups. */
export function maskAuthoringInline(source: string): string {
  const parts: string[] = []; let cursor = 0, previous = 0;
  while (cursor < source.length) {
    const opaque = opaqueEnd(source, cursor); if (opaque > cursor) { cursor = opaque; continue; }
    if (source[cursor] === '\\' && !escaped(source, cursor)) {
      const command = readInlineCommand(source.slice(cursor));
      if (command) { parts.push(source.slice(previous, cursor), 'a'.repeat(command.raw.length)); cursor += command.raw.length; previous = cursor; continue; }
    }
    cursor++;
  }
  parts.push(source.slice(previous)); return parts.join('');
}
export interface BlockCommand { raw: string; name: string; parameters: string; body: string; bodyFrom: number; closed: boolean }
export function readBlockCommand(source: string): BlockCommand | null {
  const opening = /^( {0,3})(:{3,})[ \t]+([a-z][a-z0-9-]*)([^\r\n]*)(?:\r?\n|$)/i.exec(source); if (!opening) return null;
  const stack = [opening[2].length], baseIndent = opening[1].length;
  const lines = /([^\n]*)(?:\n|$)/g; lines.lastIndex = opening[0].length;
  let code: { marker: string; length: number } | null = null, math: string | null = null, line: RegExpExecArray | null;
  while ((line = lines.exec(source)) && line[0]) {
    const text = line[1].replace(/\r$/, ''), fence = /^ {0,3}(`{3,}|~{3,})/.exec(text);
    if (code) { if (new RegExp(`^ {0,3}${code.marker}{${code.length},}[ \\t]*$`).test(text)) code = null; continue; }
    if (math) { if (text.trim() === math) math = null; continue; }
    if (fence) { code = { marker: fence[1][0], length: fence[1].length }; continue; }
    if (/^ {0,3}(\$\$|\\\[)[ \t]*$/.test(text)) { math = text.trim() === '$$' ? '$$' : '\\]'; continue; }
    const boundary = /^( {0,3})(:{3,})(?:[ \t]+([a-z][a-z0-9-]*)(?:[ \t].*)?|[ \t]*)$/i.exec(text);
    if (!boundary || boundary[1].length !== baseIndent) continue;
    if (boundary[3]) stack.push(boundary[2].length);
    else {
      const ancestor = stack.lastIndexOf(boundary[2].length); if (ancestor < 0) continue;
      stack.length = ancestor;
      if (!stack.length) return { raw: source.slice(0, lines.lastIndex), name: opening[3].toLowerCase(), parameters: opening[4].trim(), body: source.slice(opening[0].length, line.index), bodyFrom: opening[0].length, closed: true };
    }
  }
  return { raw: source, name: opening[3].toLowerCase(), parameters: opening[4].trim(), body: source.slice(opening[0].length), bodyFrom: opening[0].length, closed: false };
}

type RichToken = MarkdownToken & { command: InlineCommand | BlockCommand; groupTokens?: MarkdownToken[][]; tokens?: MarkdownToken[] };
export interface SourceRecord { raw: string; kind: string; error?: string; bodyFrom?: number; groups?: Group[] }
export const sourceRecords = new WeakMap<JSONContent, SourceRecord>();
export function nodeSource(node: JSONContent): SourceRecord | undefined { return (node as JSONContent & { authoringSource?: SourceRecord }).authoringSource ?? sourceRecords.get(node); }
function record<T extends JSONContent>(node: T, raw: string, kind: string, error?: string): T { const value = { raw, kind, error }; sourceRecords.set(node, value); (node as JSONContent & { authoringSource?: SourceRecord }).authoringSource = value; return node; }
function literal(raw: string, error?: string): JSONContent { return record({ type: 'text', text: raw, marks: [{ type: 'authoringLiteral' }] }, raw, 'inline', error); }
function rawBlock(raw: string, error?: string): JSONContent { return record({ type: 'authoringRaw', content: raw ? [{ type: 'text', text: raw }] : undefined }, raw, 'block', error); }
const nonempty = (content: JSONContent[]) => content.length ? content : [{ type: 'paragraph' }];
const hasType = (nodes: JSONContent[], types: string[]): boolean => nodes.some(node => types.includes(node.type ?? '') || node.marks?.some(mark => types.includes(mark.type)) || hasType(node.content ?? [], types));
function inline(token: RichToken, helpers: MarkdownParseHelpers): JSONContent[] {
  const command = token.command as InlineCommand, { values, error } = parseParameters(command.name, command.parameters, false);
  if (command.error || error || !commandSpec(command.name)) return [literal(command.raw, command.error ?? error ?? '未知命令')];
  if (command.name === 'native') {
    if (values.version !== 1) return [literal(command.raw, '不支持的原生保留版本')];
    try { const bytes = Uint8Array.from(atob(command.groups[0].text.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0)), value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); if (!value || typeof value.type !== 'string') throw new Error(); return [record({ type: 'authoringNative', attrs: { value, inline: true } }, command.raw, 'native-inline')]; } catch { return [literal(command.raw, '原生行内保留内容无效')]; }
  }
  const groups = token.groupTokens?.map(tokens => helpers.parseInline(tokens)) ?? [];
  if (command.name === 'note') {
    if (!groups[0]?.some(node => node.type !== 'text' || node.text?.trim()) || hasType(groups[0], ['link', 'annotationReference', 'image']) || (groups[1] && (!groups[1].some(node => node.type !== 'text' || node.text?.trim()) || hasType(groups[1], ['annotationReference'])))) return [literal(command.raw, '说明锚点和正文不能为空，且不能嵌套交互说明')];
    // Resolve direct bodies and shared references together after the host parser finishes.
    return [record({ type: 'authoringNote', attrs: { ref: values.ref ?? null }, content: groups[0], ...(groups[1] ? { authoringBody: groups[1] } : {}) }, command.raw, 'note')];
  }
  const mark = ({ b: 'bold', i: 'italic', s: 'strike', u: 'underline', blur: 'conceal', color: 'textColor', bg: 'highlight' } as Record<string, string>)[command.name];
  const attrs = command.name === 'color' ? { color: values.color } : command.name === 'bg' ? { color: values.bg } : undefined;
  // Applying marks ourselves also covers math atoms, unlike manager.applyMarkToContent.
  const marked = (groups[0] ?? []).map(node => node.marks?.some(existing => existing.type === mark) ? node : ({ ...node, marks: [...(node.marks ?? []), { type: mark, ...(attrs ? { attrs } : {}) }] }));
  return marked.length === 1 ? [record(marked[0], command.raw, command.name)] : marked;
}
function block(token: RichToken, helpers: MarkdownParseHelpers): JSONContent | JSONContent[] {
  const command = token.command as BlockCommand, spec = commandSpec(command.name, true), name = spec?.name ?? command.name;
  const { values, error } = parseParameters(name, command.parameters, true);
  if (!command.closed || !spec || error) return rawBlock(command.raw, !command.closed ? '块围栏未闭合' : error ?? '未知块');
  if (name === 'native') {
    if (values.version !== 1) return rawBlock(command.raw, '不支持的原生保留版本');
    try { const value = JSON.parse(command.body); if (!value || typeof value !== 'object' || typeof value.type !== 'string' || value.type === 'doc') return rawBlock(command.raw, '原生保留内容无效'); return record({ type: 'authoringNative', attrs: { value } }, command.raw, 'native'); } catch { return rawBlock(command.raw, '原生保留JSON无效'); }
  }
  const parsedChildren = (helpers.parseBlockChildren ?? helpers.parseChildren)(token.tokens ?? []), children: JSONContent[] = [];
  // Marked retains its list-item lexical state while tokenizing an extension
  // body. Its `text` tokens are still paragraphs in this independent region.
  let inlineRun: JSONContent[] = [];
  const flush = () => { if (inlineRun.length) { children.push({ type: 'paragraph', content: inlineRun }); inlineRun = []; } };
  for (const child of parsedChildren) { if (['text', 'hardBreak', 'mathInline', 'authoringNote'].includes(child.type ?? '') || (child.type === 'authoringNative' && child.attrs?.inline)) inlineRun.push(child); else { flush(); children.push(child); } }
  flush();
  if (name === 'annotation' || name === 'explain') return record({ type: name === 'annotation' ? 'authoringDefinition' : 'authoringExplain', attrs: values, content: nonempty(children) }, command.raw, name);
  if (name === 'fold') return record({ type: 'disclosure', attrs: { title: values.title, open: values.open ?? false }, content: nonempty(children) }, command.raw, name);
  if (['note', 'tip', 'important', 'warning', 'caution'].includes(name)) return record({ type: 'githubAlert', attrs: { kind: name, title: values.title ?? null, icon: values.icon ?? null, backgroundColor: values.bg ?? null, borderColor: values.border ?? null }, content: nonempty(children) }, command.raw, name);
  if (['left', 'center', 'right', 'bg'].includes(name)) {
    return nonempty(children).map(child => {
      const attrs = { ...(child.attrs ?? {}) };
      if (name === 'bg') {
        if (!['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem', 'mathBlock'].includes(child.type ?? '')) return rawBlock(command.raw, `此内容不支持块底色`);
        attrs[child.type === 'mathBlock' ? 'background' : 'blockBackground'] = values.bg;
      } else { const key = child.type === 'table' ? 'tableAlign' : ['image', 'imageCollection'].includes(child.type ?? '') ? 'align' : 'textAlign'; if (!attrs[key]) attrs[key] = name; }
      return record({ ...child, attrs }, command.raw, name);
    });
  }
  if (name === 'table') {
    let table = children[0]; const dimensions = values.size as number[] | undefined;
    if (!children.length && dimensions) table = { type: 'table', content: Array.from({ length: dimensions[0] }, (_, row) => ({ type: 'tableRow', content: Array.from({ length: dimensions[1] }, () => ({ type: row ? 'tableCell' : 'tableHeader', content: [{ type: 'paragraph' }] })) })) };
    if (table?.type !== 'table' || children.length > 2 || (children[1] && children[1].type !== 'paragraph')) return rawBlock(command.raw, '表格块必须包含一张表及最多一段表注');
    const rows = table.content ?? [], cols = rows[0]?.content?.length ?? 0, widths = values.widths as number[] | undefined;
    if ((dimensions && (dimensions[0] !== rows.length || dimensions[1] !== cols)) || (widths && widths.length !== cols)) return rawBlock(command.raw, '表格尺寸或列宽与正文不一致');
    if (widths) for (const row of rows) row.content?.forEach((cell, col) => { cell.attrs = { ...cell.attrs, colwidth: [widths[col]] }; });
    table.attrs = { ...table.attrs, tableAlign: values.align ?? null, ...(children[1] ? { caption: children[1].content?.map(node => node.text ?? '').join('') ?? '', captionContent: children[1].content } : {}) };
    return record(table, command.raw, name);
  }
  if (name === 'pic' || name === 'slide') {
    const dimensions = values.grid as number[] | undefined;
    if (dimensions && (dimensions[1] > IMAGE_GRID_MAX_COLUMNS || dimensions[0] * dimensions[1] > IMAGE_GRID_MAX_CELLS) || (name === 'slide' && Number(values['print-cols'] ?? 2) > IMAGE_GRID_MAX_COLUMNS)) return rawBlock(command.raw, `图片布局最多${IMAGE_GRID_MAX_COLUMNS}列、${IMAGE_GRID_MAX_CELLS}格`);
    if (name === 'pic' && !dimensions) {
      if (children[0]?.type !== 'image' || children.length > 2 || (children[1] && children[1].type !== 'paragraph')) return rawBlock(command.raw, '单图块必须包含一张图片及最多一段图注');
      const image = children[0]; image.attrs = { ...image.attrs, align: values.align ?? 'center', width: values.width ?? '100%', ...(children[1] ? { caption: children[1].content?.map(node => node.text ?? '').join('') ?? '', captionContent: children[1].content } : {}) };
      return record(image, command.raw, name);
    }
    const slots: JSONContent[] = [];
    if (children.length && (children.length !== 1 || !['bulletList', 'orderedList'].includes(children[0].type ?? ''))) return rawBlock(command.raw, '图片项必须使用顶层列表');
    for (const item of children[0]?.content ?? []) {
      const contents = (item.content ?? []).filter(node => node.type !== 'paragraph' || node.content?.length);
      // The host parser may leave an image inside the first paragraph.
      if (contents[0]?.type === 'paragraph' && contents[0].content?.[0]?.type === 'image') { const first = contents.shift()!, caption = first.content!.slice(1); if (caption[0]?.type === 'text') { caption[0] = { ...caption[0], text: caption[0].text?.replace(/^\r?\n/, '') }; if (!caption[0].text) caption.shift(); } contents.unshift(first.content![0], ...(caption.length ? [{ type: 'paragraph', content: caption }] : [])); }
      if (contents.filter(node => node.type === 'image').length > 1 || contents.some(node => !['image', 'paragraph'].includes(node.type ?? '')) || (contents.length && contents[0].type !== 'image')) return rawBlock(command.raw, '每个图片项只允许一张主图和文字图注');
      if (contents.length > 2) { const paragraphs = contents.slice(1); contents.splice(1, contents.length - 1, { type: 'paragraph', content: paragraphs.flatMap((paragraph, index) => [...(index ? [{ type: 'hardBreak' }] : []), ...(paragraph.content ?? [])]) }); }
      slots.push({ type: 'imageSlot', content: contents });
    }
    const capacity = dimensions ? dimensions[0] * dimensions[1] : slots.length;
    if (slots.length > capacity || capacity > 10000) return rawBlock(command.raw, '图片项超出宫格容量');
    while (slots.length < capacity) slots.push({ type: 'imageSlot' });
    if (!slots.length) slots.push({ type: 'imageSlot' });
    return record({ type: 'imageCollection', attrs: { layout: name === 'slide' ? 'carousel' : 'grid', columns: name === 'slide' ? values['print-cols'] ?? 2 : dimensions![1], align: values.align ?? 'center', width: values.width ?? '100%' }, content: slots }, command.raw, name);
  }
  return rawBlock(command.raw, '未识别块');
}

export const DeclarativeInline = Extension.create({
  name: 'authoringInlineSyntax', markdownTokenName: 'authoringInlineSyntax',
  markdownTokenizer: { name: 'authoringInlineSyntax', level: 'inline', start: source => source.search(/\\[a-z]+[[{]/i),
    tokenize(source, _tokens, lexer) {
      const command = readInlineCommand(source); if (!command) return undefined;
      return { type: 'authoringInlineSyntax', raw: command.raw, command, groupTokens: command.error || command.name === 'native' ? [] : command.groups.map(group => lexer.inlineTokens(group.text)) };
    } },
  parseMarkdown(token, helpers) { return inline(token as RichToken, helpers); },
});
export const DeclarativeBlock = Extension.create({
  name: 'authoringBlockSyntax', markdownTokenName: 'authoringBlockSyntax',
  markdownTokenizer: { name: 'authoringBlockSyntax', level: 'block', start: source => followingBlockStart(source, /^ {0,3}:{3,}[ \t]+[a-z]/im),
    tokenize(source, _tokens, lexer) {
      const command = readBlockCommand(source); if (!command) return undefined;
      const spec = commandSpec(command.name, true), params = parseParameters(command.name, command.parameters, true);
      return { type: 'authoringBlockSyntax', raw: command.raw, command, tokens: command.closed && spec && !params.error && command.name !== 'native' ? lexer.blockTokens(command.body) : [] };
    } },
  parseMarkdown(token, helpers) { return block(token as RichToken, helpers); },
});
