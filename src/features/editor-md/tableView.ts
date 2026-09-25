import { TableView } from '@tiptap/extension-table';
import type { Node } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import './tableView.css';
import { TableRowLayout, isLargeTable, hasSimpleTableRows } from './tableRowLayout';
import { tableAlignment, tableAlignmentMargins } from './tableAlignment';

/** Independent row layout supports TableViewport's bounded content DOM while
 * ProseMirror retains the complete table and selection model. Small and merged
 * tables continue to use native layout. */
export class EfficientTableView extends TableView {
  private rows: TableRowLayout;
  constructor(node: Node, width: number, view?: EditorView, attributes?: Record<string, unknown>) {
    super(node, width, view, attributes); this.rows = new TableRowLayout(this.table); this.applyPolicy(node);
  }
  private applyPolicy(node: Node) {
    const large = isLargeTable(node);
    this.dom.classList.toggle('nb-large-table', large);
    let fixed = !!node.firstChild;
    node.firstChild?.forEach(cell => { if (!cell.attrs.colwidth?.every((width: number) => width > 0)) fixed = false; });
    this.table.style.tableLayout = fixed ? 'fixed' : '';
    this.dom.classList.toggle('nb-fixed-columns', fixed);
    this.rows.update(node, large);
    this.applyAlignment(node);
  }
  private applyAlignment(node: Node) {
    const alignment = tableAlignment(node.attrs.tableAlign);
    if (alignment) this.table.dataset.tableAlign = alignment;
    else delete this.table.dataset.tableAlign;
    Object.assign(this.table.style, tableAlignmentMargins(alignment));
  }
  update(node: Node) {
    if (node === this.node) return true;
    if (node.type !== this.node.type) return false;
    // Attribute-only edits reuse all rows, including the cached layout policy.
    // Do not rescan a 10k-row table when changing its position.
    if (node.content === this.node.content) { this.node = node; this.applyAlignment(node); return true; }
    // A row without a visibility decoration is a placeholder only inside a
    // qualifying table. Recreate descendants when that policy changes.
    if ((isLargeTable(node) && hasSimpleTableRows(node)) !== (isLargeTable(this.node) && hasSimpleTableRows(this.node))) return false;
    if (node.firstChild !== this.node.firstChild) super.update(node);
    else this.node = node;
    this.applyPolicy(node); return true;
  }
  destroy() { this.rows.clear(); }
}
