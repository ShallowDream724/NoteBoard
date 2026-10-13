import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { documentColor } from './colors';
import { readableInkStyle } from './readableInk';

const key = new PluginKey<DecorationSet>('readable-document-ink');
interface Range { from: number; to: number }
const COLOR_ATTRIBUTES = ['blockTextColor', 'textColor', 'blockBackground', 'background', 'backgroundColor'] as const;

function decorations(doc: Node, from: number, to: number): Decoration[] {
  const result: Decoration[] = [];
  const inherited: { end: number; color: string | null; background: string | null }[] = [{ end: doc.content.size + 1, color: null, background: null }];
  doc.nodesBetween(from, to, (node, pos) => {
    while (inherited.length > 1 && pos >= inherited.at(-1)!.end) inherited.pop();
    if (node.type.name === 'annotationStore' || node.type.spec.code) return false;
    const parent = inherited.at(-1)!, attrs = node.attrs;
    let color = documentColor(attrs.blockTextColor ?? attrs.textColor) ?? parent.color;
    let background = documentColor(attrs.blockBackground ?? attrs.background ?? attrs.backgroundColor) ?? parent.background;
    if (!node.isInline) {
      inherited.push({ end: pos + node.nodeSize, color, background });
      return;
    }
    for (const mark of node.marks) {
      if (mark.type.name === 'textColor') color = documentColor(mark.attrs.color) ?? color;
      if (mark.type.name === 'highlight') background = typeof mark.attrs.color === 'string' ? mark.attrs.color : '#fef08a';
    }
    const style = readableInkStyle(color, background);
    if (style) result.push(Decoration.inline(pos, pos + node.nodeSize, { class: 'nb-readable-ink', style }));
    return false;
  });
  return result;
}

function changedRanges(tr: Transaction): Range[] {
  const ranges: Range[] = [], doc = tr.doc;
  const scan = (from: number, to: number, index: number, attributes: boolean) => {
    const mapping = tr.mapping.slice(index + 1);
    from = Math.max(0, Math.min(doc.content.size, mapping.map(from, -1)));
    to = Math.max(from, Math.min(doc.content.size, mapping.map(to, 1)));
    if (attributes) to = Math.max(to, Math.min(doc.content.size, from + (doc.nodeAt(from)?.nodeSize ?? 0)));
    const start = doc.resolve(from), end = doc.resolve(to);
    // Adding/removing a container's opening/closing token can leave a zero-size
    // mapped range even though every descendant inherited a different fill.
    if (start.depth) from = start.start();
    if (end.depth) to = end.end();
    if (from === to) to = Math.min(doc.content.size, from + (doc.nodeAt(from)?.nodeSize ?? 0));
    if (from < to) ranges.push({ from, to });
  };
  tr.steps.forEach((step, index) => {
    let hasMap = false;
    step.getMap().forEach((_oldFrom, _oldTo, from, to) => { hasMap = true; scan(from, to, index, false); });
    if (!hasMap) {
      const point = step as unknown as { from?: number; to?: number; pos?: number; attr?: string; attrs?: Record<string, unknown>;
        cells?: unknown; patches?: { background?: string | null; content?: unknown }[] };
      if (point.pos !== undefined) {
        // Metadata, alignment and width steps deliberately have empty maps.
        // Compare actual color values, including full-attribute undo patches,
        // before deciding to revisit a potentially 10,000-row container.
        if (point.attrs || point.attr) {
          const before = tr.docs[index].nodeAt(point.pos), after = (tr.docs[index + 1] ?? tr.doc).nodeAt(point.pos);
          if (before && after && COLOR_ATTRIBUTES.every(name => before.attrs[name] === after.attrs[name])) return;
        }
        if (point.cells) return;
        if (point.patches && !point.patches.some(patch => patch.content !== undefined || Object.hasOwn(patch, 'background'))) return;
      }
      const from = point.from ?? point.pos;
      if (from !== undefined) scan(from, point.to ?? from, index, point.pos !== undefined);
    }
  });
  ranges.sort((a, b) => a.from - b.from);
  return ranges.reduce<Range[]>((merged, range) => {
    const last = merged.at(-1);
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to); else merged.push(range);
    return merged;
  }, []);
}

/** No observers, timers or theme subscriptions. A keystroke only rebuilds its
 * affected text block; attribute-only container edits rebuild that container. */
export function createReadableInkPlugin() {
  return new Plugin<DecorationSet>({ key,
    state: {
      init: (_, state) => DecorationSet.create(state.doc, decorations(state.doc, 0, state.doc.content.size)),
      apply(tr, previous) {
        if (!tr.docChanged) return previous;
        const ranges = changedRanges(tr);
        let moved = false;
        for (const map of tr.mapping.maps) map.forEach(() => { moved = true; });
        if (!ranges.length && !moved) return previous;
        let next = previous.map(tr.mapping, tr.doc);
        for (const { from, to } of ranges) {
          next = next.remove(next.find(from, to));
          next = next.add(tr.doc, decorations(tr.doc, from, to));
        }
        return next;
      },
    },
    props: { decorations: state => key.getState(state) },
  });
}
