import type { Node as DocumentNode } from '@tiptap/pm/model';
import { parseMarkdownDocument } from '../editor-md/documentExtensions';
import { isDisplayMath, type MathDelimiter } from '../editor-md/mathSyntax';
import { ALERT_META, alertKind } from '../editor-md/alertPresentation';
import { buildLogicalTableGrid } from '../editor-md/tableGrid';
import { isSafeHighlightColor } from '../editor-md/markdownHighlight';
import { tableFill } from '../editor-md/tableCellPresentation';
import { documentTableStyle } from '../editor-md/documentPresentation';
import { documentColor } from '../document-style/colors';

type Ast = { t: string; c?: unknown };
type Attributes = Record<string, string>;
const node = (t: string, c?: unknown): Ast => c === undefined ? { t } : { t, c };
const attr = (classes: string[] = [], values: Attributes = {}): unknown[] => ['', classes, Object.entries(values)];
const words = (text: string): Ast[] => text.split(/(\s+)/).filter(Boolean).map(word => /^\s+$/.test(word) ? node('Space') : node('Str', word));
const annotationId = (value: DocumentNode | null) => value?.marks.find(mark => mark.type.name === 'annotationReference')?.attrs.id as string | undefined;
const align = (value: unknown) => ['left', 'center', 'right'].includes(String(value)) ? String(value) : undefined;
const dimension = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? `${value}px`
  : typeof value === 'string' && /^\d+(?:\.\d+)?(?:px|%|cm|mm|in|pt)$/.test(value) ? value : undefined;

/** One direct read of the authoritative tree. Target writers consume semantic
 * Pandoc nodes plus a small presentation vocabulary; no portable/PM round trip. */
export function pandocSource(source: string | DocumentNode): string {
  const document = typeof source === 'string' ? parseMarkdownDocument(source) : source;
  const cellFills = documentTableStyle(document) !== 'three-line';
  const bodies = new Map<string, DocumentNode>(), usedNotes = new Set<string>(), activeNotes = new Set<string>();
  document.descendants(value => {
    if (value.type.name === 'annotationBody') {
      const id = String(value.attrs.id ?? '');
      if (!id || bodies.has(id)) throw new Error('补充说明 ID 缺失或重复，无法完整导出。');
      bodies.set(id, value);
    }
  });
  function children(parent: DocumentNode, convert: (child: DocumentNode) => Ast[]): Ast[] {
    const result: Ast[] = []; parent.forEach(child => result.push(...convert(child))); return result;
  }
  function note(id: string): Ast {
    const body = bodies.get(id);
    if (!body) throw new Error(`补充说明 ${id} 缺少正文，无法完整导出。`);
    if (activeNotes.has(id)) throw new Error('补充说明互相引用，无法转换为脚注。');
    usedNotes.add(id); activeNotes.add(id);
    const content = children(body, block);
    activeNotes.delete(id);
    return node('Note', content);
  }
  function inlines(parent: DocumentNode): Ast[] {
    const result: Ast[] = [];
    parent.forEach((value, _offset, index) => {
      result.push(...inline(value));
      const id = annotationId(value);
      if (id && annotationId(index + 1 < parent.childCount ? parent.child(index + 1) : null) !== id) result.push(note(id));
    });
    if (parent.attrs.annotationId) result.push(note(String(parent.attrs.annotationId)));
    return result;
  }
  function inline(value: DocumentNode): Ast[] {
    let result: Ast[];
    if (value.isText) result = words(value.text ?? '');
    else if (value.type.name === 'hardBreak') result = [node('LineBreak')];
    else if (value.type.name === 'mathInline') result = [node('Math', [node(isDisplayMath(value.attrs.delimiter as MathDelimiter) ? 'DisplayMath' : 'InlineMath'), value.attrs.latex])];
    else if (value.type.name === 'image') {
      const size: Attributes = {};
      for (const key of ['width', 'height']) { const valid = dimension(value.attrs[key]); if (valid) size[key] = valid; }
      result = [node('Image', [attr([], size), words(value.attrs.alt ?? ''), [value.attrs.src, value.attrs.title ?? '']])];
    } else return [node('Code', [attr(), String(value.attrs.raw ?? JSON.stringify(value.toJSON()))])];
    const presentation: Attributes = {};
    for (const mark of [...value.marks].reverse()) {
      const types: Record<string, string> = { bold: 'Strong', italic: 'Emph', strike: 'Strikeout', underline: 'Underline' };
      if (types[mark.type.name]) result = [node(types[mark.type.name], result)];
      else if (mark.type.name === 'code') result = [node('Code', [attr(), value.text ?? ''])];
      else if (mark.type.name === 'link') result = [node('Link', [attr(), result, [mark.attrs.href, mark.attrs.title ?? '']])];
      else if (mark.type.name === 'highlight') presentation['nb-background'] = isSafeHighlightColor(mark.attrs.color) ? mark.attrs.color : '#ffff00';
      else if (mark.type.name === 'textColor' && documentColor(mark.attrs.color)) presentation['nb-color'] = documentColor(mark.attrs.color)!;
      else if (!['conceal', 'annotationReference', 'textColor'].includes(mark.type.name)) throw new Error(`无法导出标记 ${mark.type.name}，请保留原生文档。`);
    }
    return Object.keys(presentation).length ? [node('Span', [attr(['noteboard-presentation'], presentation), result])] : result;
  }
  function paragraphAttributes(value: DocumentNode): Attributes {
    const properties: Attributes = {};
    const alignment = align(value.attrs.textAlign); if (alignment) properties['nb-align'] = alignment;
    if (Number.isInteger(value.attrs.indent) && value.attrs.indent > 0 && value.attrs.indent <= 8) properties['nb-indent'] = String(value.attrs.indent);
    return properties;
  }
  function table(rows: unknown[], widths: number[], header = false, properties: Attributes = {}): Ast {
    const sum = widths.reduce((total, width) => total + width, 0);
    return node('Table', [attr([], properties), [null, []], widths.map(width => [node('AlignDefault'), sum ? node('ColWidth', width / sum) : node('ColWidthDefault')]),
      [attr(), header ? [rows[0]] : []], [[attr(), 0, [], header ? rows.slice(1) : rows]], [attr(), []]]);
  }
  function blockContent(value: DocumentNode): Ast[] {
    switch (value.type.name) {
      case 'documentPresentation': case 'annotationStore': case 'annotationBody': return [];
      case 'paragraph': {
        const properties = paragraphAttributes(value), content = node('Para', inlines(value));
        return [Object.keys(properties).length ? node('Div', [attr(['noteboard-presentation'], properties), [content]]) : content];
      }
      case 'heading': return [node('Header', [value.attrs.level, attr([], paragraphAttributes(value)), inlines(value)])];
      case 'codeBlock': return [node('CodeBlock', [attr(value.attrs.language ? [value.attrs.language] : []), value.textContent])];
      case 'nativeError': return [node('CodeBlock', [attr(), String(value.attrs.raw ?? '')])];
      case 'blockquote': return [node('BlockQuote', children(value, block))];
      case 'horizontalRule': return [node('HorizontalRule')];
      case 'mathBlock': return [node('Para', [node('Math', [node('DisplayMath'), value.attrs.latex])])];
      case 'bulletList': case 'taskList': {
        const items: Ast[][] = []; value.forEach(child => {
          const content = children(child, block);
          if (value.type.name === 'taskList') content.unshift(node('Plain', words(child.attrs.checked ? '[x]' : '[ ]')));
          items.push(content);
        }); return [node('BulletList', items)];
      }
      case 'orderedList': {
        const items: Ast[][] = []; value.forEach(child => items.push(children(child, block)));
        return [node('OrderedList', [[value.attrs.start ?? 1, node('Decimal'), node('Period')], items])];
      }
      case 'githubAlert': {
        const kind = alertKind(value.attrs.kind);
        return [node('BlockQuote', [node('Para', [node('Strong', words(ALERT_META[kind].label))]), ...children(value, block)])];
      }
      case 'disclosure': return [node('Para', [node('Strong', words(String(value.attrs.title || '折叠内容')))]), ...children(value, block)];
      case 'imageCollection': {
        const columns = value.attrs.columns === 3 ? 3 : 2, rows: unknown[] = [];
        for (let start = 0; start < value.childCount; start += columns) {
          const cells: unknown[] = [];
          for (let column = 0; column < columns; column++) {
            const slot = start + column < value.childCount ? value.child(start + column) : null;
            const contents = slot ? children(slot, block) : [];
            cells.push([attr(), node('AlignCenter'), 1, 1, contents.length ? contents : [node('Plain', [])]]);
          }
          rows.push([attr(), cells]);
        }
        return [table(rows, Array(columns).fill(1), false, { 'nb-gallery': 'true' })];
      }
      case 'imageSlot': return children(value, block);
      case 'table': {
        const cells: DocumentNode[][] = [];
        value.forEach(row => { const entries: DocumentNode[] = []; row.forEach(cell => entries.push(cell)); cells.push(entries); });
        const grid = buildLogicalTableGrid(cells, cell => cell.attrs), widths: number[] = Array(grid.width).fill(0);
        for (const row of grid.rows) for (const { cell, column, colspan } of row) {
          if (Array.isArray(cell.attrs.colwidth)) for (let offset = 0; offset < colspan; offset++) {
            const width = Number(cell.attrs.colwidth[offset]); if (width > 0 && Number.isFinite(width)) widths[column + offset] = Math.max(widths[column + offset], width);
          }
        }
        const defined = widths.filter(Boolean), fallback = defined.length ? defined.reduce((sum, width) => sum + width, 0) / defined.length : 0;
        const header = !!grid.rows[0]?.length && grid.rows[0].every(({ cell, rowspan }) => cell.type.name === 'tableHeader' && rowspan === 1);
        const rows = grid.rows.map((entries, index) => [attr(), entries.map(({ cell, colspan, rowspan }) => {
          const properties: Attributes = {};
          const fill = cellFills ? tableFill(cell.attrs.background) : null; if (fill) properties['nb-background'] = fill;
          if (['top', 'middle', 'bottom'].includes(cell.attrs.verticalAlign)) properties['nb-vertical'] = cell.attrs.verticalAlign;
          const alignment = ({ left: 'AlignLeft', center: 'AlignCenter', right: 'AlignRight' } as Record<string, string>)[cell.attrs.textAlign ?? cell.attrs.align] ?? 'AlignDefault';
          return [attr([], properties), node(alignment), Math.min(rowspan, grid.rows.length - index), colspan, children(cell, block)];
        })]);
        return [table(rows, widths.map(width => width || fallback), header, { 'nb-table-style': cellFills ? 'grid' : 'three-line' })];
      }
      default:
        if (value.type.name === 'image') return [node('Para', inline(value))];
        if (['mermaidBlock', 'plantumlBlock', 'infographicBlock'].includes(value.type.name)) return [node('CodeBlock', [attr([value.type.name.replace(/Block$/, '')]), String(value.attrs.code ?? '')])];
        return [node('CodeBlock', [attr(), String(value.attrs.raw ?? JSON.stringify(value.toJSON()))])];
    }
  }
  function block(value: DocumentNode): Ast[] {
    const result = blockContent(value);
    if (value.attrs.annotationId && !['paragraph', 'heading', 'annotationStore', 'annotationBody'].includes(value.type.name)) result.push(node('Para', [note(String(value.attrs.annotationId))]));
    return result;
  }
  const blocks = children(document, block);
  for (const id of bodies.keys()) if (!usedNotes.has(id)) blocks.push(node('Para', [note(id)]));
  return JSON.stringify({ blocks, meta: {} });
}
