import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { annotationId, type AnnotationAnchor, type AnnotationRecord } from './model';

interface AnnotationIndex { records: Map<string, AnnotationRecord>; anchors: AnnotationAnchor[]; decorations: DecorationSet; orphanIds: string[] }
export const annotationIndexKey = new PluginKey<AnnotationIndex>('annotations');

interface Range { from: number; to: number }
// Positions are half-open. An insertion just after a block must not evict its
// anchor: rescanning that insertion cannot visit the preceding block.
const intersects = (a: Range, b: Range) => a.from < b.to && a.to > b.from;
/** Step maps use the document after that step; map them through the remaining steps. */
function touchedRanges(tr: Transaction): Range[] {
  const ranges: Range[] = [];
  tr.steps.forEach((step, index) => {
    const after = tr.mapping.slice(index + 1);
    let mapped = false;
    step.getMap().forEach((_a, _b, from, to) => { mapped = true; ranges.push({ from: after.map(from, -1), to: after.map(to, 1) }); });
    // Marks and attribute steps have empty position maps, but still change semantics.
    if (!mapped) {
      const positions = step as unknown as { from?: number; to?: number; pos?: number };
      const from = positions.from ?? positions.pos;
      if (from !== undefined) ranges.push({ from: after.map(from, -1), to: after.map(positions.to ?? from + 1, 1) });
    }
  });
  for (const range of ranges) {
    range.from = Math.max(0, Math.min(range.from, tr.doc.content.size));
    range.to = Math.max(range.from, Math.min(range.to, tr.doc.content.size));
    const from = tr.doc.resolve(range.from), to = tr.doc.resolve(range.to);
    // A complete textblock is the smallest unit that keeps adjoining mark fragments merged.
    if (from.parent.isTextblock) range.from = from.start();
    if (to.parent.isTextblock) range.to = to.end();
  }
  const merged: Range[] = [];
  for (const range of ranges.sort((a, b) => a.from - b.from)) {
    const previous = merged.at(-1);
    if (previous && previous.to >= range.from) previous.to = Math.max(previous.to, range.to);
    else merged.push(range);
  }
  return merged;
}

function scan(doc: ProseMirrorNode, range: Range, records: Map<string, AnnotationRecord>, anchors: AnnotationAnchor[]) {
  doc.nodesBetween(range.from, range.to, (node, pos) => {
    if (node.type.name === 'annotationBody') {
      const id = annotationId(node.attrs.id); if (id) records.set(id, { id, node, pos });
      return false;
    }
    const blockId = annotationId(node.attrs.annotationId);
    if (blockId) anchors.push({ id: blockId, from: pos, to: pos + node.nodeSize, block: true });
    for (const mark of node.marks) {
      const id = mark.type.name === 'annotationReference' ? annotationId(mark.attrs.id) : null;
      if (id) anchors.push({ id, from: pos, to: pos + node.nodeSize, block: false });
    }
  });
}

function mergeAnchors(anchors: AnnotationAnchor[]): AnnotationAnchor[] {
  const merged: AnnotationAnchor[] = [];
  for (const anchor of anchors.sort((a, b) => a.from - b.from || Number(b.block) - Number(a.block))) {
    const previous = merged.at(-1);
    if (previous?.id === anchor.id && previous.from === anchor.from && previous.to === anchor.to && previous.block === anchor.block) continue;
    if (previous?.id === anchor.id && previous.to === anchor.from && !previous.block && !anchor.block) previous.to = anchor.to;
    else merged.push(anchor);
  }
  return merged;
}

function decorationsFor(doc: ProseMirrorNode, records: Map<string, AnnotationRecord>, anchors: AnnotationAnchor[]): DecorationSet {
      const decorations: Decoration[] = [];
      for (const anchor of anchors) {
        if (!records.has(anchor.id)) continue;
        const block = anchor.block ? doc.nodeAt(anchor.from) : null;
        const inline = !anchor.block || (block?.isTextblock && block.type.name !== 'codeBlock');
        const position = inline ? anchor.to - (anchor.block ? 1 : 0) : anchor.from;
        if (anchor.block) decorations.push(Decoration.node(anchor.from, anchor.to, { class: `nb-annotation-block-anchor${inline ? ' nb-annotation-text-block' : ''}`, 'data-annotation-id': anchor.id }));
        // The table view owns its marker, anchored to the actual table box.
        if (block?.type.name === 'table') continue;
        decorations.push(Decoration.widget(position, () => {
          // Zero-flow markers never wrap a paragraph or add a row after an image.
          // Text markers sit at the last character; other blocks use their top-right corner.
          const marker = document.createElement('span');
          marker.className = inline ? 'nb-annotation-inline-marker' : 'nb-annotation-block-marker';
          marker.contentEditable = 'false';
          const button = document.createElement('button');
          button.type = 'button'; button.className = 'nb-annotation-indicator'; button.textContent = '?';
          button.setAttribute('aria-label', '打开补充说明'); button.dataset.annotationId = anchor.id;
          button.contentEditable = 'false';
          marker.append(button);
          return marker;
        }, { key: `annotation-${anchor.id}-${position}-${inline}`, side: -1, stopEvent: () => true }));
      }
      return DecorationSet.create(doc, decorations);
}

function orphanIds(records: Map<string, AnnotationRecord>, anchors: AnnotationAnchor[]) {
  const referenced = new Set(anchors.map(anchor => anchor.id));
  return [...records.keys()].filter(id => !referenced.has(id));
}

export function createAnnotationIndex(doc: ProseMirrorNode): AnnotationIndex {
  const records = new Map<string, AnnotationRecord>(), found: AnnotationAnchor[] = [];
  scan(doc, { from: 0, to: doc.content.size }, records, found);
  const anchors = mergeAnchors(found);
  return { records, anchors, decorations: decorationsFor(doc, records, anchors), orphanIds: orphanIds(records, anchors) };
}

export function updateAnnotationIndex(tr: Transaction, previous: AnnotationIndex): AnnotationIndex {
  if (!tr.docChanged) return previous;
  const ranges = touchedRanges(tr), records = new Map<string, AnnotationRecord>();
  for (const [id, record] of previous.records) {
    const from = tr.mapping.mapResult(record.pos, 1), to = tr.mapping.map(record.pos + record.node.nodeSize, -1);
    if (from.deletedAcross || to <= from.pos || ranges.some(range => intersects(range, { from: from.pos, to }))) continue;
    records.set(id, from.pos === record.pos ? record : { ...record, pos: from.pos });
  }
  const mapped = previous.anchors.flatMap(anchor => {
    const from = tr.mapping.mapResult(anchor.from, 1), to = tr.mapping.map(anchor.to, -1);
    return from.deletedAcross || to <= from.pos ? [] : [{ ...anchor, from: from.pos, to }];
  });
  const found = mapped.filter(anchor => !ranges.some(range => intersects(range, anchor)));
  for (const range of ranges) scan(tr.doc, range, records, found);
  const anchors = mergeAnchors(found);
  const unchanged = anchors.length === mapped.length && anchors.every((anchor, index) => {
    const other = mapped[index]; return anchor.id === other.id && anchor.from === other.from && anchor.to === other.to && anchor.block === other.block;
  }) && records.size === previous.records.size && [...records.keys()].every(id => previous.records.has(id));
  return { records, anchors, orphanIds: orphanIds(records, anchors),
    decorations: unchanged ? previous.decorations.map(tr.mapping, tr.doc) : decorationsFor(tr.doc, records, anchors) };
}

export const AnnotationBehavior = Extension.create({
  name: 'annotationBehavior',
  addProseMirrorPlugins() {
    return [new Plugin<AnnotationIndex>({
      key: annotationIndexKey,
      state: { init: (_, state) => createAnnotationIndex(state.doc), apply: updateAnnotationIndex },
      props: {
        decorations: state => annotationIndexKey.getState(state)?.decorations ?? DecorationSet.empty,
        nodeViews: { annotationStore: () => {
          const dom = document.createElement('aside'); dom.hidden = true; dom.contentEditable = 'false';
          dom.dataset.annotationStore = ''; dom.setAttribute('aria-hidden', 'true');
          return { dom, ignoreMutation: () => true };
        } },
      },
      appendTransaction(transactions, _previous, state) {
        if (!transactions.some(tr => tr.docChanged)) return null;
        const index = annotationIndexKey.getState(state);
        if (!index?.orphanIds.length) return null;
        const tr = state.tr;
        const removals: { from: number; to: number }[] = [];
        const stores = new Map<number, { node: ProseMirrorNode; bodies: Range[] }>();
        for (const id of index.orphanIds) {
          const record = index.records.get(id)!;
          const position = state.doc.resolve(record.pos), storePos = position.before();
          const store = stores.get(storePos) ?? { node: position.parent, bodies: [] };
          store.bodies.push({ from: record.pos, to: record.pos + record.node.nodeSize }); stores.set(storePos, store);
        }
        for (const [pos, store] of stores) removals.push(...(store.bodies.length === store.node.childCount ? [{ from: pos, to: pos + store.node.nodeSize }] : store.bodies));
        for (const range of removals.sort((a, b) => b.from - a.from)) tr.delete(range.from, range.to);
        return tr.docChanged ? tr : null;
      },
    })];
  },
});
