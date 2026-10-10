import { Fragment, type Node } from '@tiptap/pm/model';
import { NodeSelection, TextSelection, type Selection, type Transaction } from '@tiptap/pm/state';
import { NodeAttributesStep } from '../nodeAttributesStep';
import type { Mapping } from '@tiptap/pm/transform';
import { NumberingAttributesStep, type NumberingPatch } from './attributesStep';

export const isOrdered = (node: Node | null | undefined): boolean => node?.type.name === 'orderedList';
export const MAX_NUMBERING_START = 999_999_999;
export const validStart = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= MAX_NUMBERING_START;
// Generated continuations may exceed the input's nine-digit limit.
export const startOf = (node: Node) => Number.isSafeInteger(node.attrs.start) && node.attrs.start > 0 ? node.attrs.start as number : 1;

/** A continuation belongs to the previous ordered sibling in the same content
 * container. Intervening paragraphs/media never consume an ordinal. No ids or
 * global document registry: copying a subtree cannot retain cross-document links. */
export function orderedSegmentAttrs(list: Node, retained: number, hasPrefix = retained > 0) {
  return { ...list.attrs, start: startOf(list) + retained, numbering: hasPrefix ? 'continue' : list.attrs.numbering };
}
export interface ListEntry { node: Node; pos: number; parent: Node; parentPos: number; slot: number }
export function orderedAt(doc: Node, selection: Selection): { entry: ListEntry; itemIndex: number } | null {
  if (selection instanceof NodeSelection && isOrdered(selection.node)) {
    const at = selection.$from;
    return { entry: { node: selection.node, pos: at.pos, parent: at.parent, parentPos: at.depth ? at.before() : -1, slot: at.index() }, itemIndex: 0 };
  }
  const at = selection.$from;
  for (let depth = at.depth; depth > 0; depth--) {
    const node = at.node(depth);
    if (isOrdered(node)) return { entry: { node, pos: at.before(depth), parent: at.node(depth - 1), parentPos: depth > 1 ? at.before(depth - 1) : -1, slot: at.index(depth - 1) }, itemIndex: Math.min(at.index(depth), node.childCount - 1) };
  }
  if (!selection.empty && !(selection instanceof NodeSelection)) {
    let found: ReturnType<typeof orderedAt> = null;
    doc.nodesBetween(selection.from, selection.to, (node, pos) => {
      if (found || node.isTextblock) return false;
      if (!isOrdered(node)) return true;
      node.forEach((item, offset, itemIndex) => {
        if (found) return;
        item.forEach((child, childOffset) => {
          const from = pos + offset + childOffset + 3, to = from + child.content.size;
          if (!found && child.isTextblock && (from === to ? selection.from <= from && selection.to > from : selection.from < to && selection.to > from)) {
            const parent = doc.resolve(pos);
            found = { entry: { node, pos, parent: parent.parent, parentPos: parent.depth ? parent.before() : -1, slot: parent.index() }, itemIndex };
          }
        });
      });
      return !found;
    });
    return found;
  }
  return null;
}
export function orderedSiblings(entry: ListEntry): ListEntry[] {
  const result: ListEntry[] = [];
  entry.parent.forEach((node, offset, slot) => { if (isOrdered(node)) result.push({ ...entry, node, pos: entry.parentPos + 1 + offset, slot }); });
  return result;
}
export function linkedGroup(entry: ListEntry): ListEntry[] {
  const siblings = orderedSiblings(entry), index = siblings.findIndex(item => item.pos === entry.pos);
  let from = index, to = index;
  while (from > 0 && siblings[from].node.attrs.numbering === 'continue') from--;
  while (to + 1 < siblings.length && siblings[to + 1].node.attrs.numbering === 'continue') to++;
  return siblings.slice(from, to + 1);
}

/** One structural action's normalization. Text input does not call this walk;
 * each item count is O(1), and unchanged text/media subtrees are never entered. */
export function normalizeNumbering(tr: Transaction, before?: Node, mapping?: Mapping): void {
  type Origin = { list: Node; group: Node; start: number };
  const origins = new WeakMap<Node, Origin>();
  const mappedOrigins = new Map<number, Origin>();
  const patches: NumberingPatch[] = [];
  function remember(parent: Node, parentPos: number) {
    let group: Node | null = null;
    parent.forEach((node, offset) => {
      const pos = parentPos + 1 + offset;
      if (isOrdered(node)) {
        if (node.attrs.numbering !== 'continue' || !group) group = node;
        const origin = { list: node, group, start: startOf(group) };
        origins.set(node, origin);
        const mapped = mapping?.mapResult(pos, 1);
        if (mapped && !mapped.deletedAfter) mappedOrigins.set(mapped.pos, origin);
        node.forEach(item => { origins.set(item, origin); if (item.firstChild) origins.set(item.firstChild, origin); });
      }
      if (!node.isTextblock && !node.isLeaf && !['annotationStore', 'annotationBody'].includes(node.type.name)) remember(node, pos);
    });
  }
  if (before) remember(before, -1);
  function visit(parent: Node, parentPos: number) {
    let previous: { start: number; count: number; group: Node; source?: Node } | null = null;
    parent.forEach((node, offset) => {
      const pos = parentPos + 1 + offset;
      if (isOrdered(node)) {
        let origin = origins.get(node) ?? mappedOrigins.get(pos);
        for (let index = 0; !origin && index < node.childCount; index++) {
          const item = node.child(index); origin = origins.get(item) ?? (item.firstChild ? origins.get(item.firstChild) : undefined);
        }
        let mode = node.attrs.numbering, start = startOf(node);
        // Built-in Enter/lift can split a wrapper while copying its attributes.
        // Recognize surviving item identities only during structural edits.
        if (origin && node !== origin.list && previous?.source === origin.list && mode === origin.list.attrs.numbering) mode = 'continue';
        if (mode === 'continue') {
          const explicitlyLinked = origin && node.attrs.numbering !== origin.list.attrs.numbering;
          if (origin && !explicitlyLinked && (!previous || previous.group !== origin.group)) {
            mode = null; start = origin.start; // The group's head was removed; do not attach to an unrelated group.
          } else if (previous) start = previous.start + previous.count;
          else { mode = null; start = origin?.start ?? start; }
        }
        if (start !== node.attrs.start || mode !== node.attrs.numbering) patches.push({ pos, attrs: { start, numbering: mode } });
        previous = { start, count: node.childCount, group: mode === 'continue' && previous ? previous.group : origin?.group ?? node, source: origin?.list };
      }
      if (!node.isTextblock && !node.isLeaf && !['annotationStore', 'annotationBody'].includes(node.type.name)) visit(node, pos);
    });
  }
  visit(tr.doc, -1);
  if (patches.length) tr.step(new NumberingAttributesStep(patches));
}

/** Preserve selection by retained textblock identity through wrapper splits.
 * Only structural commands use this, never pointer movement or normal typing. */
export function preserveListSelection(tr: Transaction, original: Selection, mappingStart = 0): void {
  let anchor: number | undefined, head: number | undefined, nodePos: number | undefined;
  tr.doc.descendants((node, pos) => {
    if (original instanceof NodeSelection && (node === original.node || node.type === original.node.type && node.firstChild === original.node.firstChild)) nodePos ??= pos;
    if (node === original.$anchor.parent) anchor = pos + 1 + original.$anchor.parentOffset;
    if (node === original.$head.parent) head = pos + 1 + original.$head.parentOffset;
    return !node.isTextblock;
  });
  const map = tr.mapping.slice(mappingStart);
  if (nodePos !== undefined && original instanceof NodeSelection) tr.setSelection(NodeSelection.create(tr.doc, nodePos));
  else tr.setSelection(TextSelection.between(tr.doc.resolve(anchor ?? map.map(original.anchor)), tr.doc.resolve(head ?? map.map(original.head))));
}

export function splitOrderedAt(tr: Transaction, entry: ListEntry, index: number, attrs: Record<string, unknown>) {
  if (!index) { tr.step(new NodeAttributesStep(entry.pos, attrs)); return entry.pos; }
  let cut = 0; for (let i = 0; i < index; i++) cut += entry.node.child(i).nodeSize;
  const prefix = entry.node.copy(entry.node.content.cut(0, cut));
  const suffix = entry.node.type.create({ ...orderedSegmentAttrs(entry.node, index), annotationId: null, ...attrs }, entry.node.content.cut(cut), entry.node.marks);
  tr.replaceWith(entry.pos, entry.pos + entry.node.nodeSize, Fragment.fromArray([prefix, suffix]));
  return entry.pos + prefix.nodeSize;
}
