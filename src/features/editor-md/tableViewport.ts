import { Extension } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Selection, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { CellSelection } from '@tiptap/pm/tables';
import { findScrollContainer } from '../../core/dom/scrollContainer';
import { hasSimpleTableRows, isLargeTable } from './tableRowLayout';

const INITIAL_ROWS = 36;
const ESTIMATED_HEIGHT = 40;
interface Row { end: number; visible: boolean }
interface ViewportState { rows: Map<number, Row>; decorations: DecorationSet; selected: Set<number> }
interface Visibility { pos: number; visible: boolean }
export const tableViewportKey = new PluginKey<ViewportState>('tableViewport');
const heights = new WeakMap<Node, number>();

function selectedRows(selection: Selection) {
  const rows = new Set<number>();
  const endpoints = selection instanceof CellSelection ? [selection.$anchorCell, selection.$headCell] : [selection.$anchor, selection.$head];
  for (const resolved of endpoints) {
    for (let depth = resolved.depth; depth > 0; depth--) {
      if (resolved.node(depth).type.spec.tableRole === 'row') { rows.add(resolved.before(depth)); break; }
    }
  }
  return rows;
}
function decoration(pos: number, row: Row, selected: Set<number>) {
  return row.visible || selected.has(pos) ? Decoration.node(pos, row.end, {}, { tableViewport: 'visible', viewportVisible: row.visible }) : null;
}
function build(state: EditorState, previous?: ViewportState, transaction?: Transaction): ViewportState {
  const rows = new Map<number, Row>(), selected = selectedRows(state.selection), decorations: Decoration[] = [];
  const prior = new Map<number, Row>();
  if (previous && transaction) for (const [pos, row] of previous.rows) {
    const mapped = transaction.mapping.mapResult(pos, 1);
    if (!mapped.deleted) prior.set(mapped.pos, row);
  }
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'annotationStore') return false;
    if (node.type.spec.tableRole !== 'table') return;
    if (isLargeTable(node) && hasSimpleTableRows(node)) node.forEach((child, offset, index) => {
      const at = pos + 1 + offset;
      const row = { end: at + child.nodeSize, visible: prior.get(at)?.visible ?? index < INITIAL_ROWS };
      rows.set(at, row); const shown = decoration(at, row, selected); if (shown) decorations.push(shown);
    });
    return false;
  });
  return { rows, selected, decorations: DecorationSet.create(state.doc, decorations) };
}

/** Only visibility is stored here. The complete document, history, clipboard and
 * serialization continue to use the same ProseMirror tree. */
export function createTableViewportPlugin() {
  return new Plugin<ViewportState>({ key: tableViewportKey,
    state: {
      init: (_config, state) => build(state),
      apply(transaction, value, _oldState, state) {
        if (transaction.docChanged) return build(state, value, transaction);
        const changes = transaction.getMeta(tableViewportKey) as Visibility[] | undefined;
        if (!changes && !transaction.selectionSet) return value;
        const selected = selectedRows(state.selection), dirty = new Set<number>();
        for (const pos of value.selected) if (!selected.has(pos)) dirty.add(pos);
        for (const pos of selected) if (!value.selected.has(pos)) dirty.add(pos);
        let rows = value.rows;
        if (changes?.length) {
          rows = new Map(rows);
          for (const change of changes) {
            const row = rows.get(change.pos);
            if (row && row.visible !== change.visible) { rows.set(change.pos, { ...row, visible: change.visible }); dirty.add(change.pos); }
          }
        }
        let decorations = value.decorations;
        for (const pos of dirty) {
          const row = rows.get(pos); if (!row) continue;
          decorations = decorations.remove(decorations.find(pos, row.end, spec => !!spec.tableViewport).filter(item => item.from === pos));
          const shown = decoration(pos, row, selected); if (shown) decorations = decorations.add(state.doc, [shown]);
        }
        return { rows, selected, decorations };
      },
    },
    props: { decorations: state => tableViewportKey.getState(state)?.decorations ?? null },
    view(view) { return {
      update(next, previous) { if (next.state.doc !== previous.doc) controllers.get(next)?.refresh(); },
      destroy() { controllers.get(view)?.destroy(); controllers.delete(view); },
    }; },
  });
}

export const TableViewport = Extension.create({ name: 'tableViewport', addProseMirrorPlugins: () => [createTableViewportPlugin()] });

export function rowViewportMode(decorations: readonly Decoration[]): 'visible' | 'hidden' | undefined {
  return decorations.find(item => item.spec.tableViewport)?.spec.tableViewport;
}
export function isViewportRow(view: EditorView, position: number | undefined, enabled: boolean) {
  if (!enabled || position === undefined) return false;
  const state = tableViewportKey.getState(view.state);
  if (state) return state.rows.has(position);
  // Tiptap installs its plugins after creating the initial view. Avoid briefly
  // constructing the entire cell DOM before that first reconfiguration.
  const table = view.state.doc.resolve(position).parent;
  return table.type.spec.tableRole === 'table' && isLargeTable(table) && hasSimpleTableRows(table);
}
export function rowInViewport(decorations: readonly Decoration[]): boolean {
  return !!decorations.find(item => item.spec.tableViewport)?.spec.viewportVisible;
}
export function tableRowHeight(node: Node) { return Math.max(Number(node.attrs.height) || 0, heights.get(node) ?? ESTIMATED_HEIGHT); }

interface ObservedRow { getPos: () => number | undefined; getNode: () => Node; isVisible: () => boolean; mounted: boolean; intersecting?: boolean }
class ViewportController {
  private rows = new Map<Element, ObservedRow>();
  private mounted = new Set<Element>();
  private pending = new Map<Element, boolean>();
  private frame = 0;
  private intersection: IntersectionObserver;
  private resize: ResizeObserver | null;
  constructor(private view: EditorView) {
    const owner = findScrollContainer(view.dom);
    this.intersection = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const row = this.rows.get(entry.target); if (!row) continue;
        row.intersecting = entry.isIntersecting;
        // DOM rectangles include editor transforms; placeholder CSS needs the
        // unscaled layout height. Only the bounded mounted window is measured.
        if (row.mounted && entry.boundingClientRect.height > 0) heights.set(row.getNode(), (entry.target as HTMLElement).offsetHeight);
        this.pending.set(entry.target, entry.isIntersecting);
      }
      if (!this.frame && this.pending.size) this.frame = requestAnimationFrame(() => this.flush());
    }, { root: owner === view.dom.ownerDocument.documentElement ? null : owner, rootMargin: '800px 0px' });
    this.resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(entries => {
      for (const entry of entries) {
        const row = this.rows.get(entry.target);
        if (row?.mounted) { const height = entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height;
          if (height > 0) heights.set(row.getNode(), height); }
      }
    });
  }
  refresh() {
    // A whole-table replace may reset the initial window while retaining an
    // endpoint's DOM. Its intersection has not changed, so IO will not repeat
    // that observation. Reconcile only the mounted window using cached results.
    for (const element of this.mounted) {
      const row = this.rows.get(element)!;
      if (row.intersecting !== undefined && row.isVisible() !== row.intersecting) this.pending.set(element, row.intersecting);
    }
    if (!this.frame && this.pending.size) this.frame = requestAnimationFrame(() => this.flush());
  }
  private flush() {
    this.frame = 0;
    if (this.view.isDestroyed) return;
    const state = tableViewportKey.getState(this.view.state), changes: Visibility[] = [];
    for (const [element, visible] of this.pending) {
      const row = this.rows.get(element);
      // getPos scans preceding view siblings. In particular, do not resolve the
      // initial observation of every already-hidden row in a large table.
      if (!row || row.isVisible() === visible) continue;
      const pos = row.getPos();
      if (pos !== undefined && state?.rows.get(pos)?.visible !== visible) changes.push({ pos, visible });
    }
    this.pending.clear();
    if (changes.length) this.view.dispatch(this.view.state.tr.setMeta(tableViewportKey, changes).setMeta('addToHistory', false));
  }
  observe(element: Element, row: ObservedRow) {
    this.rows.set(element, row); this.intersection.observe(element); if (row.mounted) this.resize?.observe(element);
    if (row.mounted) this.mounted.add(element);
    return () => { this.rows.delete(element); this.mounted.delete(element); this.pending.delete(element); this.intersection.unobserve(element); this.resize?.unobserve(element); };
  }
  destroy() { cancelAnimationFrame(this.frame); this.intersection.disconnect(); this.resize?.disconnect(); this.rows.clear(); this.mounted.clear(); this.pending.clear(); }
}
const controllers = new WeakMap<EditorView, ViewportController>();
export function observeTableRow(view: EditorView, element: Element, row: ObservedRow) {
  if (typeof IntersectionObserver === 'undefined') return () => {};
  let controller = controllers.get(view);
  if (!controller) { controller = new ViewportController(view); controllers.set(view, controller); }
  return controller.observe(element, row);
}
