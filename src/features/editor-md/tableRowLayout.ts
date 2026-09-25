import type { Node } from '@tiptap/pm/model';

let nextTable = 0;
const simpleTables = new WeakMap<Node, boolean>();
function isSimple(table: Node) {
  let simple = simpleTables.get(table);
  if (simple === undefined) {
    simple = true;
    table.forEach(row => row.forEach(cell => { if (cell.attrs.rowspan > 1 || cell.attrs.colspan > 1) simple = false; }));
    simpleTables.set(table, simple);
  }
  return simple;
}

/** Fixed, unmerged large tables can lay out rows independently. The actual
 * table/cell DOM and ProseMirror positions are retained; export is unaffected. */
export class TableRowLayout {
  private id = `nb-row-layout-${++nextTable}`;
  private style: HTMLStyleElement | null = null;
  private widths = '';
  constructor(private table: HTMLTableElement) {}
  update(node: Node, large: boolean, fixed: boolean) {
    if (!large || !fixed || !isSimple(node)) { this.clear(); return; }
    const widths: number[] = []; node.firstChild!.forEach(cell => widths.push(cell.attrs.colwidth[0]));
    const key = widths.join(',');
    if (key === this.widths) return;
    if (!this.style) { this.style = document.createElement('style'); this.table.ownerDocument.head.append(this.style); }
    this.widths = key;
    const selector = `table.${this.id}`;
    this.style.textContent = widths.map((width, i) => `${selector}>colgroup>col:nth-child(${i + 1}),${selector}>tbody>tr>:nth-child(${i + 1}){width:${width}px;}`).join('\n');
    this.table.classList.add(this.id, 'nb-isolated-rows');
  }
  clear() { this.table.classList.remove(this.id, 'nb-isolated-rows'); this.style?.remove(); this.style = null; this.widths = ''; }
}
