import { TableView } from '@tiptap/extension-table';
import type { Node } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import './tableView.css';
import { TableRowLayout } from './tableRowLayout';

/** Keep ProseMirror's complete editable table/selection model. Isolate browser
 * layout and skip distant row paint; ordinary small tables take the same path
 * as upstream. No duplicated cell editor or presentation tree. */
export class EfficientTableView extends TableView {
  private rows: TableRowLayout;
  constructor(node: Node, width: number, view?: EditorView, attributes?: Record<string, unknown>) {
    super(node, width, view, attributes); this.rows = new TableRowLayout(this.table); this.applyPolicy(node);
  }
  private applyPolicy(node: Node) {
    const large = node.childCount >= 100 || node.childCount * (node.firstChild?.childCount ?? 0) >= 600;
    this.dom.classList.toggle('nb-large-table', large);
    let fixed = !!node.firstChild;
    node.firstChild?.forEach(cell => { if (!cell.attrs.colwidth?.every((width: number) => width > 0)) fixed = false; });
    this.table.style.tableLayout = fixed ? 'fixed' : '';
    this.dom.classList.toggle('nb-fixed-columns', fixed);
    this.rows.update(node, large, fixed);
  }
  update(node: Node) {
    if (node === this.node) return true;
    if (node.type !== this.node.type) return false;
    if (node.firstChild !== this.node.firstChild) super.update(node);
    else this.node = node;
    this.applyPolicy(node); return true;
  }
  destroy() { this.rows.clear(); }
}
