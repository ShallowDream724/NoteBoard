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
const node = (t: string, c?: unknown): Ast => c === undefined ? { t } : { t, c };
const attr = (classes: string[] = [], values: string[][] = []): unknown[] => ['', classes, values];
function children(parent: DocumentNode, convert: (child: DocumentNode) => Ast[]): Ast[] {
  const result: Ast[] = []; parent.forEach(child => result.push(...convert(child))); return result;
}
function inline(value: DocumentNode): Ast[] {
  let result: Ast[];
  if (value.isText) result = (value.text ?? '').split(/(\s+)/).filter(Boolean).map(word => /^\s+$/.test(word) ? node('Space') : node('Str', word));
  else if (value.type.name === 'hardBreak') result = [node('LineBreak')];
  else if (value.type.name === 'mathInline') result = [node('Math', [node(isDisplayMath(value.attrs.delimiter as MathDelimiter) ? 'DisplayMath' : 'InlineMath'), value.attrs.latex])];
  else if (value.type.name.toLowerCase().includes('image')) result = [node('Image', [attr(), [node('Str', value.attrs.alt ?? '')], [value.attrs.src, value.attrs.title ?? '']])];
  else result = children(value, inline);
  for (const mark of [...value.marks].reverse()) {
    const types: Record<string, string> = { bold: 'Strong', italic: 'Emph', strike: 'Strikeout', underline: 'Underline' };
    if (types[mark.type.name]) result = [node(types[mark.type.name], result)];
    else if (mark.type.name === 'code') result = [node('Code', [attr(), value.text ?? ''])];
    else if (mark.type.name === 'link') result = [node('Link', [attr(), result, [mark.attrs.href, mark.attrs.title ?? '']])];
    else if (mark.type.name === 'highlight') {
      const color = isSafeHighlightColor(mark.attrs.color) ? mark.attrs.color : '#ffff00';
      result = [node('Span', [attr(['highlight'], [['data-color', color], ['style', `background-color: ${color}`]]), result])];
    }
    else if (mark.type.name === 'textColor' && documentColor(mark.attrs.color)) result = [node('Span', [attr(['noteboard-presentation'], [['style', `color:${documentColor(mark.attrs.color)}`]]), result])];
  }
  return result;
}
function block(value: DocumentNode, cellFills = true): Ast[] {
  const recurse = (child: DocumentNode) => block(child, cellFills);
  const paragraphStyle = [ ['left','center','right'].includes(value.attrs.textAlign) ? `text-align:${value.attrs.textAlign}` : '',
    Number.isInteger(value.attrs.indent) && value.attrs.indent > 0 && value.attrs.indent <= 8 ? `margin-left:${value.attrs.indent * 2}em` : '' ].filter(Boolean).join(';');
  switch (value.type.name) {
    case 'paragraph': { const content = node('Para', children(value, inline)); return [paragraphStyle ? node('Div', [attr(['noteboard-presentation'], [['style', paragraphStyle]]), [content]]) : content]; }
    case 'heading': return [node('Header', [value.attrs.level, paragraphStyle ? attr(['noteboard-presentation'], [['style', paragraphStyle]]) : attr(), children(value, inline)])];
    case 'codeBlock': return [node('CodeBlock', [attr(value.attrs.language ? [value.attrs.language] : []), value.textContent])];
    case 'blockquote': return [node('BlockQuote', children(value, recurse))];
    case 'horizontalRule': return [node('HorizontalRule')];
    case 'mathBlock': return [node('Para', [node('Math', [node('DisplayMath'), value.attrs.latex])])];
    case 'bulletList': case 'taskList': {
      const items: Ast[][] = []; value.forEach(child => {
        const content = children(child, recurse);
        if (value.type.name === 'taskList') {
          const marker = [node('Str', child.attrs.checked ? '[x]' : '[ ]'), node('Space')];
          if (content[0]?.t === 'Para') content[0].c = [...marker, ...(content[0].c as Ast[])];
          else content.unshift(node('Para', marker));
        }
        items.push(content);
      }); return [node('BulletList', items)];
    }
    case 'orderedList': {
      const items: Ast[][] = []; value.forEach(child => items.push(children(child, recurse)));
      return [node('OrderedList', [[value.attrs.start ?? 1, node('Decimal'), node('Period')], items])];
    }
    case 'githubAlert': {
      const kind = alertKind(value.attrs.kind);
      return [node('Div', [attr(['github-alert', `github-alert-${kind}`], [['custom-style', `NoteBoard ${ALERT_META[kind].label}`]]),
        [node('Para', [node('Strong', [node('Str', ALERT_META[kind].label)])]), ...children(value, recurse)]])];
    }
    case 'table': {
      const cells: DocumentNode[][] = [];
      value.forEach(row => { const entries: DocumentNode[] = []; row.forEach(cell => entries.push(cell)); cells.push(entries); });
      const grid = buildLogicalTableGrid(cells, cell => cell.attrs);
      // A spanning first row must stay in the same Pandoc section as its body.
      const header = !!grid.rows[0]?.length && grid.rows[0].every(({ cell, rowspan }) => cell.type.name === 'tableHeader' && rowspan === 1);
      const rows: unknown[] = grid.rows.map((entries, index) => [attr(), entries.map(({ cell, colspan, rowspan }) => {
        const color = cellFills && cell.type.name !== 'tableHeader' ? tableFill(cell.attrs.background) : null;
        const vertical = ['top','middle','bottom'].includes(cell.attrs.verticalAlign) ? `vertical-align:${cell.attrs.verticalAlign}` : '';
        const styles = [color ? `background-color:${color}` : '', vertical].filter(Boolean).join(';');
        const alignment = ({ left: 'AlignLeft', center: 'AlignCenter', right: 'AlignRight' } as Record<string,string>)[cell.attrs.textAlign ?? cell.attrs.align] ?? 'AlignDefault';
        return [styles ? attr([...(color ? ['noteboard-cell-fill'] : []), ...(vertical ? ['noteboard-presentation'] : [])], [['style', styles]]) : attr(),
          node(alignment), Math.min(rowspan, grid.rows.length - index), colspan, children(cell, recurse)];
      })]);
      return [node('Table', [attr(), [null, []], Array.from({ length: grid.width }, () => [node('AlignDefault'), node('ColWidthDefault')]),
        [attr(), header ? [rows.shift()] : []], [[attr(), 0, [], rows]], [attr(), []]])];
    }
    default:
      if (value.type.name.toLowerCase().includes('image')) return [node('Para', inline(value))];
      if (value.attrs.code != null) return [node('CodeBlock', [attr([value.type.name.replace(/Block$/, '')]), String(value.attrs.code)])];
      return children(value, recurse);
  }
}
/** Pass math as semantic AST nodes; Pandoc never re-interprets currency/delimiters. */
export function pandocSource(source: string | DocumentNode): string {
  const doc = typeof source === 'string' ? parseMarkdownDocument(source) : source;
  const fills = documentTableStyle(doc) !== 'three-line';
  return JSON.stringify({ blocks: children(doc, value => block(value, fills)), meta: {} });
}
