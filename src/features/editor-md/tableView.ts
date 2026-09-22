import { TableView } from '@tiptap/extension-table';
import type { Node } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import './tableView.css';

/** Keep ProseMirror's complete editable table/selection model. Isolate browser
 * layout and skip distant row paint; ordinary small tables take the same path
 * as upstream. No duplicated cell editor or presentation tree. */
export class EfficientTableView extends TableView {
  constructor(node: Node, width: number, view?: EditorView, attributes?: Record<string, unknown>) {
    super(node, width, view, attributes); this.applyPolicy(node);
  }
  private applyPolicy(node: Node) {
    this.dom.classList.toggle('nb-large-table', node.childCount >= 100 || node.childCount * (node.firstChild?.childCount ?? 0) >= 600);
  }
  update(node: Node) { if (!super.update(node)) return false; this.applyPolicy(node); return true; }
}
