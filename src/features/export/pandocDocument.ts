import type { Node as DocumentNode } from '@tiptap/pm/model';
import { parseMarkdownDocument } from '../editor-md/markdownDocument';
import { isDisplayMath, type MathDelimiter } from '../editor-md/mathSyntax';
import { ALERT_META, alertKind } from '../editor-md/alertPresentation';

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
    else if (mark.type.name === 'highlight') result = [node('Span', [attr(['highlight']), result])];
  }
  return result;
}
function block(value: DocumentNode): Ast[] {
  switch (value.type.name) {
    case 'paragraph': return [node('Para', children(value, inline))];
    case 'heading': return [node('Header', [value.attrs.level, attr(), children(value, inline)])];
    case 'codeBlock': return [node('CodeBlock', [attr(value.attrs.language ? [value.attrs.language] : []), value.textContent])];
    case 'blockquote': return [node('BlockQuote', children(value, block))];
    case 'horizontalRule': return [node('HorizontalRule')];
    case 'mathBlock': return [node('Para', [node('Math', [node('DisplayMath'), value.attrs.latex])])];
    case 'bulletList': case 'taskList': {
      const items: Ast[][] = []; value.forEach(child => {
        const content = children(child, block);
        if (value.type.name === 'taskList') {
          const marker = [node('Str', child.attrs.checked ? '[x]' : '[ ]'), node('Space')];
          if (content[0]?.t === 'Para') content[0].c = [...marker, ...(content[0].c as Ast[])];
          else content.unshift(node('Para', marker));
        }
        items.push(content);
      }); return [node('BulletList', items)];
    }
    case 'orderedList': {
      const items: Ast[][] = []; value.forEach(child => items.push(children(child, block)));
      return [node('OrderedList', [[value.attrs.start ?? 1, node('Decimal'), node('Period')], items])];
    }
    case 'githubAlert': {
      const kind = alertKind(value.attrs.kind);
      return [node('Div', [attr(['github-alert', `github-alert-${kind}`], [['custom-style', `NoteBoard ${ALERT_META[kind].label}`]]),
        [node('Para', [node('Strong', [node('Str', ALERT_META[kind].label)])]), ...children(value, block)]])];
    }
    case 'table': {
      const rows: unknown[] = []; let header = false; let columns = 0;
      value.forEach((row, _offset, index) => {
        const cells: unknown[] = []; columns = Math.max(columns, row.childCount);
        if (index === 0) header = Array.from({ length: row.childCount }, (_, i) => row.child(i)).every(cell => cell.type.name === 'tableHeader');
        row.forEach(cell => cells.push([attr(), node('AlignDefault'), cell.attrs.rowspan ?? 1, cell.attrs.colspan ?? 1, children(cell, block)]));
        rows.push([attr(), cells]);
      });
      return [node('Table', [attr(), [null, []], Array.from({ length: columns }, () => [node('AlignDefault'), node('ColWidthDefault')]),
        [attr(), header ? [rows.shift()] : []], [[attr(), 0, [], rows]], [attr(), []]])];
    }
    default:
      if (value.type.name.toLowerCase().includes('image')) return [node('Para', inline(value))];
      if (value.attrs.code != null) return [node('CodeBlock', [attr([value.type.name.replace(/Block$/, '')]), String(value.attrs.code)])];
      return children(value, block);
  }
}
/** Pass math as semantic AST nodes; Pandoc never re-interprets currency/delimiters. */
export function pandocSource(markdown: string): string {
  return JSON.stringify({ blocks: children(parseMarkdownDocument(markdown), block), meta: {} });
}
