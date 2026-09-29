import type { Node } from '@tiptap/pm/model';
import type { Decoration, EditorView, NodeView } from '@tiptap/pm/view';
import { observeTableRow, rowViewportMode, rowInViewport, tableRowHeight, isViewportRow } from './tableViewport';

/** Shared row view for main documents and embedded rich-text editors. */
export function createTableRowView(node: Node, view: EditorView, getPos: () => number | undefined, decorations: readonly Decoration[], viewportEnabled = true): NodeView {
  const row = document.createElement('tr');
  // The constructor position is supplied directly by ProseMirror.
  const virtual = isViewportRow(view, getPos(), viewportEnabled);
  let mounted = !virtual || rowViewportMode(decorations) === 'visible';
  const show = () => {
    row.classList.toggle('nb-row-placeholder', !mounted);
    if (mounted) row.removeAttribute('aria-hidden'); else row.setAttribute('aria-hidden', 'true');
  };
  show();
  let shown: unknown;
  const showHeight = (height: unknown) => {
    if (height === shown) return;
    shown = height;
    row.style.height = row.style.minHeight = typeof height === 'number' ? `${height}px` : '';
  };
  showHeight(mounted ? node.attrs.height : tableRowHeight(node));
  const observer = virtual ? observeTableRow(view, row, { getPos, getNode: () => node, isVisible: () => rowInViewport(decorations), mounted }) : undefined;
  return {
    // Keep the row shell stable: replacing a tr invalidates sibling styles for
    // the entire tbody. Cell views virtualize only their editable descendants.
    dom: row, contentDOM: row,
    update(next, nextDecorations) {
      if (next.type !== node.type || isViewportRow(view, getPos(), viewportEnabled) !== virtual) return false;
      node = next; decorations = nextDecorations;
      const nextMounted = !virtual || rowViewportMode(decorations) === 'visible';
      if (nextMounted !== mounted) { mounted = nextMounted; show(); observer?.update(mounted); }
      showHeight(mounted ? node.attrs.height : tableRowHeight(node));
      return true;
    },
    ignoreMutation: mutation => mutation.type === 'attributes' && mutation.target === row,
    destroy: observer?.destroy,
  };
}
