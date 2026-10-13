import { Extension } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Selection, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { CellSelection } from '@tiptap/pm/tables';
import { AttrStep } from '@tiptap/pm/transform';
import { findScrollContainer } from '../../core/dom/scrollContainer';
import { hasSimpleTableRows, isLargeTable } from './tableRowLayout';

const INITIAL_ROWS = 36;
const ESTIMATED_HEIGHT = 40;
const ROW_BATCH = 16;
interface Row { end: number; index: number; visible: boolean; node: Node }
interface Table { end: number; node: Node; rows: number[] }
interface ViewportState { rows: Map<number, Row>; tables: Map<number, Table>; decorations: DecorationSet; selected: Set<number> }
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
  if (!row.visible && !selected.has(pos)) return [];
  const result = [Decoration.node(pos, row.end, {}, { tableViewport: 'visible', viewportVisible: row.visible })];
  // Resolve cell offsets only for the mounted window, not every cell in a large
  // table after each keystroke. Immutable row nodes already own their structure.
  row.node.forEach((cell, offset) => result.push(Decoration.node(pos + 1 + offset,
    pos + 1 + offset + cell.nodeSize, {}, { tableCellViewport: 'visible' })));
  return result;
}
function build(state: EditorState): ViewportState {
  const rows = new Map<number, Row>(), tables = new Map<number, Table>(), selected = selectedRows(state.selection), decorations: Decoration[] = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'annotationStore') return false;
    if (node.type.spec.tableRole !== 'table') return;
    if (isLargeTable(node) && hasSimpleTableRows(node)) {
      const positions: number[] = [];
      node.forEach((child, offset, index) => {
        const at = pos + 1 + offset;
        const row = { end: at + child.nodeSize, index, node: child, visible: index < INITIAL_ROWS };
        positions.push(at); rows.set(at, row); decorations.push(...decoration(at, row, selected));
      });
      tables.set(pos, { node, end: pos + node.nodeSize, rows: positions });
    }
    return false;
  });
  return { rows, tables, selected, decorations: DecorationSet.create(state.doc, decorations) };
}

/** Find inserted or newly qualifying tables only in changed document ranges.
 * Attribute-only steps have empty maps; the existing table index detects those
 * by immutable node identity instead. Annotation bodies own their own editor. */
function changedTables(transaction: Transaction, doc: Node) {
  const tables = new Map<number, Node>();
  const ancestor = (position: number) => {
    const resolved = doc.resolve(position);
    for (let depth = 1; depth <= resolved.depth; depth++) {
      const node = resolved.node(depth);
      if (node.type.name === 'annotationStore') return;
      if (node.type.spec.tableRole === 'table') { tables.set(resolved.before(depth), node); return; }
    }
  };
  const scan = (from: number, to: number, index: number) => {
    const remaining = transaction.mapping.slice(index + 1);
    from = Math.max(0, Math.min(doc.content.size, remaining.map(from, -1)));
    to = Math.max(from, Math.min(doc.content.size, remaining.map(to, 1)));
    ancestor(from); ancestor(to);
    doc.nodesBetween(from, to, (node, pos) => {
      if (node.type.name === 'annotationStore') return false;
      if (node.type.spec.tableRole === 'table') { tables.set(pos, node); return false; }
    });
  };
  transaction.steps.forEach((step, index) => {
    let mapped = false;
    step.getMap().forEach((_oldFrom, _oldTo, from, to) => { mapped = true; scan(from, to, index); });
    if (!mapped) {
      // A merged table is not in the viewport index yet. Removing its last
      // span with AttrStep (or an application attribute step) can qualify it.
      const positions = step as unknown as { from?: number; to?: number; pos?: number };
      const from = positions.from ?? positions.pos;
      if (from !== undefined) scan(from, positions.to ?? from + 1, index);
    }
  });
  return tables;
}

function documentTableAt(doc: Node, position: number) {
  const resolved = doc.resolve(position);
  for (let depth = 1; depth <= resolved.depth; depth++) {
    const role = resolved.node(depth);
    if (role.type.name === 'annotationStore' || role.type.spec.tableRole === 'table') return undefined;
  }
  const node = doc.nodeAt(position);
  return node?.type.spec.tableRole === 'table' ? node : undefined;
}

function updateDocument(transaction: Transaction, value: ViewportState, state: EditorState): ViewportState {
  const selected = selectedRows(state.selection), candidates = changedTables(transaction, state.doc);
  const tables = new Map<number, Table>(), prior = new Map<number, Row>();
  let rows = value.rows, decorations = value.decorations.map(transaction.mapping, state.doc);
  const mutableRows = () => { if (rows === value.rows) rows = new Map(rows); return rows; };
  const removeDecorations = (from: number, to: number) => {
    decorations = decorations.remove(decorations.find(from, to, spec => !!spec.tableViewport || !!spec.tableCellViewport)
      .filter(item => item.from >= from && item.to <= to));
  };
  for (const [pos, table] of value.tables) {
    const mapped = transaction.mapping.mapResult(pos, 1), node = mapped.deleted ? undefined : documentTableAt(state.doc, mapped.pos);
    // Position/alignment attributes do not alter row identity or eligibility.
    const attributesOnly = transaction.steps.every(step => step instanceof AttrStep && step.pos === pos);
    if (mapped.pos === pos && node?.type === table.node.type && (node.content === table.node.content || attributesOnly)) {
      tables.set(pos, node === table.node ? table : { ...table, node }); continue;
    }
    if (node?.type.spec.tableRole === 'table') candidates.set(mapped.pos, node);
    removeDecorations(transaction.mapping.map(pos, -1), transaction.mapping.map(table.end, 1));
    for (const at of table.rows) {
      const row = value.rows.get(at)!;
      mutableRows().delete(at);
      const next = transaction.mapping.mapResult(at, 1);
      if (!next.deleted) prior.set(next.pos, row);
    }
  }
  for (const [pos, node] of candidates) {
    // A changed range may include an untouched neighbouring table.
    if (tables.get(pos)?.node === node) continue;
    if (!isLargeTable(node) || !hasSimpleTableRows(node)) continue;
    const positions: number[] = [], added: Decoration[] = [];
    node.forEach((child, offset, index) => {
      const at = pos + 1 + offset;
      const row = { end: at + child.nodeSize, index, node: child, visible: prior.get(at)?.visible ?? index < INITIAL_ROWS };
      positions.push(at); mutableRows().set(at, row); added.push(...decoration(at, row, selected));
    });
    tables.set(pos, { node, end: pos + node.nodeSize, rows: positions });
    decorations = decorations.add(state.doc, added);
  }
  const dirty = new Set<number>();
  for (const pos of value.selected) {
    const at = transaction.mapping.map(pos, 1);
    if (!selected.has(at)) dirty.add(at);
  }
  for (const pos of selected) if (!value.selected.has(pos)) dirty.add(pos);
  for (const pos of dirty) {
    const row = rows.get(pos); if (!row) continue;
    removeDecorations(pos, row.end);
    decorations = decorations.add(state.doc, decoration(pos, row, selected));
  }
  return { rows, tables, selected, decorations };
}

/** Only visibility is stored here. The complete document, history, clipboard and
 * serialization continue to use the same ProseMirror tree. */
export function createTableViewportPlugin() {
  return new Plugin<ViewportState>({ key: tableViewportKey,
    state: {
      init: (_config, state) => build(state),
      apply(transaction, value, _oldState, state) {
        if (transaction.docChanged) return updateDocument(transaction, value, state);
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
          decorations = decorations.remove(decorations.find(pos, row.end, spec => !!spec.tableViewport || !!spec.tableCellViewport)
            .filter(item => item.from >= pos && item.to <= row.end));
          decorations = decorations.add(state.doc, decoration(pos, row, selected));
        }
        return { rows, tables: value.tables, selected, decorations };
      },
    },
    props: { decorations: state => tableViewportKey.getState(state)?.decorations ?? null },
    view(view) {
      // ProseMirror recreates plugin views whenever a toolbar registers a plugin,
      // but retains row node views. Reattach their observers to that same registry.
      controllers.get(view)?.resume();
      return {
      update(next, previous) { if (next.state.doc !== previous.doc) controllers.get(next)?.refresh(); },
      destroy() { controllers.get(view)?.pause(); },
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
export function isViewportCell(view: EditorView, position: number | undefined, enabled: boolean) {
  if (!enabled || position === undefined) return false;
  const resolved = view.state.doc.resolve(position);
  return resolved.parent.type.spec.tableRole === 'row' && isViewportRow(view, resolved.before(), enabled);
}
export function cellInViewport(decorations: readonly Decoration[]) {
  return decorations.some(item => item.spec.tableCellViewport === 'visible');
}
export function tableRowHeight(node: Node) { return Math.max(Number(node.attrs.height) || 0, heights.get(node) ?? ESTIMATED_HEIGHT); }

interface ObservedRow { getPos: () => number | undefined; getNode: () => Node; isVisible: () => boolean; mounted: boolean; intersecting?: boolean }
class ViewportController {
  private rows = new Map<Element, ObservedRow>();
  private mounted = new Set<Element>();
  private pending = new Map<Element, boolean>();
  private frame = 0;
  private intersection: IntersectionObserver | undefined;
  private resize: ResizeObserver | undefined;
  constructor(private view: EditorView) { this.resume(); }
  resume() {
    this.pause();
    const owner = findScrollContainer(this.view.dom);
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
    }, { root: owner === this.view.dom.ownerDocument.documentElement ? null : owner, rootMargin: '800px 0px' });
    this.resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(entries => {
      for (const entry of entries) {
        const row = this.rows.get(entry.target);
        if (row?.mounted) { const height = entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height;
          if (height > 0) heights.set(row.getNode(), height); }
      }
    });
    for (const [element, row] of this.rows) {
      this.intersection.observe(element);
      if (row.mounted) this.resize?.observe(element);
    }
  }
  pause() { cancelAnimationFrame(this.frame); this.frame = 0; this.intersection?.disconnect(); this.resize?.disconnect(); this.intersection = undefined; this.resize = undefined; this.pending.clear(); }
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
    const state = tableViewportKey.getState(this.view.state), changes: Visibility[] = [], visited = new Set<Element>();
    for (const [element, visible] of this.pending) {
      const row = this.rows.get(element);
      // getPos scans preceding view siblings. In particular, do not resolve the
      // initial observation of every already-hidden row in a large table.
      if (!row || row.isVisible() === visible) continue;
      const pos = row.getPos();
      const indexed = pos === undefined ? undefined : state?.rows.get(pos);
      if (!indexed) continue;
      const start = indexed.index - indexed.index % ROW_BATCH;
      const first = element.parentElement?.children[start];
      if (!first || visited.has(first)) continue;
      visited.add(first);
      // Change a small contiguous batch at once, with the existing 800px look-
      // ahead. This avoids invalidating table styles for every crossed row while
      // retaining at most two partial batches beyond the viewport window.
      const batch: ObservedRow[] = [];
      for (let next: Element | null = first; next && batch.length < ROW_BATCH; next = next.nextElementSibling) {
        const member = this.rows.get(next); if (!member) break;
        batch.push(member);
      }
      const wanted = batch.some(member => member.intersecting);
      for (const member of batch) {
        if (member.isVisible() === wanted) continue;
        const at = member.getPos();
        if (at !== undefined && state?.rows.get(at)?.visible !== wanted) changes.push({ pos: at, visible: wanted });
      }
    }
    this.pending.clear();
    if (changes.length) this.view.dispatch(this.view.state.tr.setMeta(tableViewportKey, changes).setMeta('addToHistory', false));
  }
  observe(element: Element, row: ObservedRow) {
    this.rows.set(element, row); this.intersection?.observe(element); if (row.mounted) this.resize?.observe(element);
    if (row.mounted) this.mounted.add(element);
    return { update: (mounted: boolean) => {
      row.mounted = mounted;
      if (mounted) { this.mounted.add(element); this.resize?.observe(element); }
      else { this.mounted.delete(element); this.resize?.unobserve(element); }
    }, destroy: () => {
      this.rows.delete(element); this.mounted.delete(element); this.pending.delete(element); this.intersection?.unobserve(element); this.resize?.unobserve(element);
      if (!this.rows.size) { this.pause(); controllers.delete(this.view); }
    } };
  }
}
const controllers = new WeakMap<EditorView, ViewportController>();
export function observeTableRow(view: EditorView, element: Element, row: ObservedRow) {
  if (typeof IntersectionObserver === 'undefined') return undefined;
  let controller = controllers.get(view);
  if (!controller) { controller = new ViewportController(view); controllers.set(view, controller); }
  return controller.observe(element, row);
}
