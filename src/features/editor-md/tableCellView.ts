import { DOMSerializer, type Node } from '@tiptap/pm/model';
import type { ViewMutationRecord } from '@tiptap/pm/view';
import { PresentedTableCell, PresentedTableHeader } from './tableCellPresentation';

/** Attribute edits retain the cell and its editable subtree. The default
 * view replaces a td/th wrapper whenever colwidth or presentation changes. */
export class TableCellView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private attributes: Record<string, string>;
  constructor(private node: Node) {
    const rendered = DOMSerializer.renderSpec(document, node.type.spec.toDOM!(node));
    this.dom = rendered.dom as HTMLElement; this.contentDOM = rendered.contentDOM as HTMLElement;
    this.attributes = Object.fromEntries([...this.dom.attributes].map(attr => [attr.name, attr.value]));
  }
  update(node: Node) {
    if (node.type !== this.node.type) return false;
    if (node.attrs !== this.node.attrs) {
      const spec = node.type.spec.toDOM!(node) as [string, Record<string, unknown>, number];
      const next: Record<string, string> = {};
      for (const [name, value] of Object.entries(spec[1] ?? {})) if (value != null) next[name] = String(value);
      for (const name of Object.keys(this.attributes)) if (!(name in next)) this.dom.removeAttribute(name);
      for (const [name, value] of Object.entries(next)) if (value !== this.attributes[name]) this.dom.setAttribute(name, value);
      this.attributes = next;
    }
    this.node = node; return true;
  }
  ignoreMutation(mutation: ViewMutationRecord) { return mutation.type === 'attributes' && mutation.target === this.dom; }
}
export const EditableTableCell = PresentedTableCell.extend({ addNodeView() { return ({ node }) => new TableCellView(node); } });
export const EditableTableHeader = PresentedTableHeader.extend({ addNodeView() { return ({ node }) => new TableCellView(node); } });
