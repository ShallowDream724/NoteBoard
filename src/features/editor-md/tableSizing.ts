import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { SizedTableRow } from './markdownTable';

/** The row owns its preview-only height. Ignoring that DOM attribute prevents
 * the mutation observer from committing a transaction on every pointer move. */
export const ResizableTableRow = SizedTableRow.extend({
  addNodeView() {
    return ({ node }) => {
      const row = document.createElement('tr');
      const showHeight = (height: unknown) => { row.style.height = typeof height === 'number' ? `${height}px` : ''; };
      showHeight(node.attrs.height);
      return {
        dom: row, contentDOM: row,
        update(next) { if (next.type !== node.type) return false; node = next; showHeight(node.attrs.height); return true; },
        ignoreMutation: mutation => mutation.type === 'attributes' && mutation.target === row,
      };
    };
  },
});

interface Drag { row: HTMLTableRowElement; pos: number; pointer: number; y: number; height: number; scale: number; next: number; preview: ReturnType<typeof rowPreview>; restoreColumns: () => void }
let previewId = 0;
/** CSSOM updates avoid waking ProseMirror's MutationObserver/selection reads on
 * every frame. Only the gesture's initial marker and final transaction touch DOM. */
function rowPreview(row: HTMLTableRowElement) {
  const name = `nb-row-preview-${++previewId}`, style = row.ownerDocument.createElement('style');
  style.textContent = `.${name} { height: ${row.offsetHeight}px !important; }`;
  row.ownerDocument.head.append(style); row.classList.add(name);
  const rule = style.sheet!.cssRules[0] as CSSStyleRule;
  return { paint(height: number) { rule.style.setProperty('height', `${height}px`, 'important'); },
    dispose() { row.classList.remove(name); style.remove(); } };
}
/** Fix existing geometry during a row gesture so the browser need not repeat
 * intrinsic column measurement on each frame. Read/write O(columns) once. */
function freezeColumns(row: HTMLTableRowElement) {
  const table = row.closest('table')!;
  const columns = Array.from(table.querySelectorAll<HTMLTableColElement>(':scope > colgroup > col'));
  const layout = table.style.tableLayout, width = table.style.width;
  const scale = table.getBoundingClientRect().width / table.offsetWidth || 1;
  const measured = columns.map(column => ({ column, before: column.style.width, width: column.getBoundingClientRect().width / scale }));
  if (!measured.length || measured.some(column => column.width <= 0)) return () => {};
  const tableWidth = table.getBoundingClientRect().width / scale;
  measured.forEach(({ column, width }) => { column.style.width = `${width}px`; });
  table.style.width = `${tableWidth}px`; table.style.tableLayout = 'fixed';
  return () => {
    measured.forEach(({ column, before }) => { column.style.width = before; });
    table.style.width = width; table.style.tableLayout = layout;
  };
}
function rowAtEdge(view: EditorView, event: PointerEvent) {
  const target = event.target as HTMLElement;
  const row = target.closest<HTMLTableRowElement>('tr');
  const cell = target.closest<HTMLElement>('td,th');
  if (!row || !cell || !view.dom.contains(row)) return null;
  const bounds = row.getBoundingClientRect(), cellBounds = cell.getBoundingClientRect();
  // Column boundaries retain the existing horizontal resize gesture.
  if (Math.abs(event.clientX - cellBounds.right) < 5 || Math.abs(event.clientY - bounds.bottom) > 5) return null;
  return row;
}
function rowPosition(view: EditorView, row: HTMLElement): number | null {
  const resolved = view.state.doc.resolve(view.posAtDOM(row, 0));
  for (let depth = resolved.depth; depth > 0; depth--) if (resolved.node(depth).type.name === 'tableRow') return resolved.before(depth);
  return null;
}

export const TableSizing = Extension.create({
  name: 'tableSizing',
  addProseMirrorPlugins() {
    let drag: Drag | null = null, frame = 0, activeView: EditorView | null = null;
    const paint = () => { frame = 0; if (drag) drag.preview.paint(drag.next); };
    const finish = (view: EditorView, commit: boolean) => {
      if (!drag) return;
      const current = drag; drag = null;
      cancelAnimationFrame(frame); frame = 0;
      current.preview.dispose();
      current.restoreColumns();
      view.dom.classList.remove('nb-row-resizing', 'nb-row-resize-ready');
      if (view.dom.hasPointerCapture(current.pointer)) view.dom.releasePointerCapture(current.pointer);
      const node = view.state.doc.nodeAt(current.pos);
      if (commit && node?.type.name === 'tableRow' && Math.abs(current.next - current.height) >= 1) {
        view.dispatch(view.state.tr.setNodeMarkup(current.pos, undefined, { ...node.attrs, height: current.next }));
      }
    };
    return [new Plugin({
      // Cancel temporary DOM state before another transaction updates NodeViews.
      filterTransaction(transaction) { if (transaction.docChanged && drag && activeView) finish(activeView, false); return true; },
      props: { handleDOMEvents: {
        pointermove(view, event) {
          if (drag) {
            drag.next = Math.max(24, Math.min(10000, Math.round(drag.height + (event.clientY - drag.y) / drag.scale)));
            if (!frame) frame = requestAnimationFrame(paint);
            event.preventDefault(); return true;
          }
          view.dom.classList.toggle('nb-row-resize-ready', !!rowAtEdge(view, event));
          return false;
        },
        pointerdown(view, event) {
          if (event.button !== 0) return false;
          const row = rowAtEdge(view, event); if (!row) return false;
          const pos = rowPosition(view, row); if (pos == null) return false;
          const bounds = row.getBoundingClientRect(), height = row.offsetHeight;
          const restoreColumns = freezeColumns(row);
          drag = { row, pos, pointer: event.pointerId, y: event.clientY, height, next: height, scale: bounds.height / height || 1, preview: rowPreview(row), restoreColumns };
          view.dom.setPointerCapture(event.pointerId); view.dom.classList.add('nb-row-resizing');
          event.preventDefault(); return true;
        },
        pointerup(view) { if (!drag) return false; finish(view, true); return true; },
        pointercancel(view) { finish(view, false); return false; },
        lostpointercapture(view) { finish(view, false); return false; },
        pointerleave(view) { if (!drag) view.dom.classList.remove('nb-row-resize-ready'); return false; },
        keydown(view, event) { if (!drag) return false; finish(view, false); return event.key === 'Escape'; },
      } },
      view(view) { activeView = view; return {
        destroy() { finish(view, false); activeView = null; },
      }; },
    })];
  },
});
