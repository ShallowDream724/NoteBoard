import { DOMSerializer, type Node } from '@tiptap/pm/model';
import type { Decoration, EditorView, ViewMutationRecord } from '@tiptap/pm/view';
import { PresentedTableCell, PresentedTableHeader } from './tableCellPresentation';
import { cellInViewport, isViewportCell } from './tableViewport';
type CellViewport = { view: EditorView; getPos: () => number | undefined };

/** Attribute edits retain the cell and its editable subtree. The default
 * view replaces a td/th wrapper whenever colwidth or presentation changes. */
export class TableCellView {
  dom: HTMLElement;
  contentDOM?: HTMLElement;
  private mounted: boolean;
  private attributes: Record<string, string>;
  constructor(private node: Node, decorations: readonly Decoration[] = [], private viewport?: CellViewport) {
    this.mounted = this.shouldMount(decorations);
    const rendered = DOMSerializer.renderSpec(document, node.type.spec.toDOM!(node));
    this.dom = rendered.dom as HTMLElement; this.contentDOM = this.mounted ? rendered.contentDOM as HTMLElement : undefined;
    this.attributes = Object.fromEntries([...this.dom.attributes].map(attr => [attr.name, attr.value]));
  }
  private shouldMount(decorations: readonly Decoration[]) {
    return !this.viewport || !isViewportCell(this.viewport.view, this.viewport.getPos(), true) || cellInViewport(decorations);
  }
  update(node: Node, decorations: readonly Decoration[]) {
    if (node.type !== this.node.type) return false;
    if (this.shouldMount(decorations) !== this.mounted) return false;
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
function cellView(enabled: boolean) {
  return ({ node, view, getPos, decorations }: { node: Node; view: EditorView; getPos: () => number | undefined; decorations: readonly Decoration[] }) => new TableCellView(node, decorations, enabled ? { view, getPos } : undefined);
}
export const EditableTableCell = PresentedTableCell.extend({ addNodeView() { return cellView(this.editor.extensionManager.extensions.some(extension => extension.name === 'tableViewport')); } });
export const EditableTableHeader = PresentedTableHeader.extend({ addNodeView() { return cellView(this.editor.extensionManager.extensions.some(extension => extension.name === 'tableViewport')); } });
