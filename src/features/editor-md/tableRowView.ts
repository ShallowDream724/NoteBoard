import type { Node } from '@tiptap/pm/model';
import type { Decoration, EditorView, NodeView } from '@tiptap/pm/view';
import { observeTableRow, rowViewportMode, rowInViewport, tableRowHeight, isViewportRow } from './tableViewport';

/** Shared row view for main documents and embedded rich-text editors. */
export function createTableRowView(node: Node, view: EditorView, getPos: () => number | undefined, decorations: readonly Decoration[], viewportEnabled = true): NodeView {
  const row = document.createElement('tr');
  // The constructor position is supplied directly by ProseMirror.
  const virtual = isViewportRow(view, getPos(), viewportEnabled);
  const mode = virtual ? rowViewportMode(decorations) ?? 'hidden' : undefined;
  const mounted = mode !== 'hidden';
  if (!mounted) { row.className = 'nb-row-placeholder'; row.setAttribute('aria-hidden', 'true'); }
  let shown: unknown;
  const showHeight = (height: unknown) => {
    if (height === shown) return;
    shown = height;
    row.style.height = row.style.minHeight = typeof height === 'number' ? `${height}px` : '';
  };
  showHeight(mounted ? node.attrs.height : tableRowHeight(node));
  const unobserve = mode ? observeTableRow(view, row, { getPos, getNode: () => node, isVisible: () => rowInViewport(decorations), mounted }) : undefined;
  return {
    dom: row, contentDOM: mounted ? row : undefined,
    update(next, nextDecorations) {
      if (next.type !== node.type || (virtual ? rowViewportMode(nextDecorations) ?? 'hidden' : undefined) !== mode) return false;
      node = next; decorations = nextDecorations;
      showHeight(mounted ? node.attrs.height : tableRowHeight(node));
      return true;
    },
    ignoreMutation: mutation => mutation.type === 'attributes' && mutation.target === row,
    destroy: unobserve,
  };
}
