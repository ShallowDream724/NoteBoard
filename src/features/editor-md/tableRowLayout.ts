import type { Node } from '@tiptap/pm/model';

let nextTable = 0;
const simpleTables = new WeakMap<Node, boolean>();
export function hasSimpleTableRows(table: Node) {
  let simple = simpleTables.get(table);
  if (simple === undefined) {
    simple = true;
    const columns = table.firstChild?.childCount;
    table.forEach(row => { if (row.childCount !== columns) simple = false;
      row.forEach(cell => { if (cell.attrs.rowspan > 1 || cell.attrs.colspan > 1) simple = false; }); });
    simpleTables.set(table, simple);
  }
  return simple;
}

export function isLargeTable(table: Node) {
  return table.childCount >= 100 || table.childCount * (table.firstChild?.childCount ?? 0) >= 600;
}

/** A bounded header-only policy: explicit widths stay authoritative, while an
 * automatic column keeps enough room for ordinary text at the current font size. */
export function tableColumnWidths(table: Node): number[] {
  const widths: number[] = [];
  table.firstChild?.forEach(cell => {
    for (let index = 0; index < (cell.attrs.colspan || 1); index++) widths.push(cell.attrs.colwidth?.[index] || 0);
  });
  return widths;
}
export function tableMinimumWidth(widths: readonly number[]): string {
  const automatic = widths.filter(width => !width).length;
  const explicit = widths.reduce((sum, width) => sum + width, 0);
  return `calc(${explicit}px + ${automatic * 8}em)`;
}

/** Independent rows prevent unmounted content from participating in native
 * table sizing. AUTO columns share remaining width without changing the model. */
export class TableRowLayout {
  private id = `nb-row-layout-${++nextTable}`;
  private style: HTMLStyleElement | null = null;
  private widths = '';
  constructor(private table: HTMLTableElement) {}
  update(node: Node, large: boolean) {
    if (!large || !hasSimpleTableRows(node)) { this.clear(); return; }
    const widths = tableColumnWidths(node);
    const key = widths.join(',');
    if (key === this.widths) return;
    if (!this.style) { this.style = document.createElement('style'); this.table.ownerDocument.head.append(this.style); }
    this.widths = key;
    const selector = `table.${this.id}`;
    const automatic = widths.filter(width => !width).length, total = widths.reduce((sum, width) => sum + width, 0);
    this.style.textContent = `${selector}{width:${automatic ? `max(100%,${tableMinimumWidth(widths)})` : `${total}px`}!important;}\n` + widths.map((width, i) => `${selector}>colgroup>col:nth-child(${i + 1}),${selector}>tbody>tr>:nth-child(${i + 1}){width:${width ? `${width}px` : `calc((100% - ${total}px) / ${automatic})`};}`).join('\n');
    this.table.classList.add(this.id, 'nb-isolated-rows');
  }
  clear() { this.table.classList.remove(this.id, 'nb-isolated-rows'); this.style?.remove(); this.style = null; this.widths = ''; }
}
