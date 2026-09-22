import type { Node, ResolvedPos } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';

export interface HeadingItem { id: string; level: number; text: string; pos: number }
interface IndexedHeading extends HeadingItem { size: number }
interface Range { from: number; to: number }

/** Positions cost O(H × step maps) to map; only changed subtrees are visited afterwards. */
export class HeadingIndex {
  private entries: IndexedHeading[] = [];
  private sequence = 0;
  private document: Node;
  items: HeadingItem[] = [];

  constructor(doc: Node) {
    this.document = doc;
    this.entries = this.read(doc, [{ from: 0, to: doc.content.size }]);
    this.items = this.entries;
  }

  private read(doc: Node, ranges: Range[], identities = new Map<number, string>(), selections: ResolvedPos[] = []): IndexedHeading[] {
    const found = new Map<number, IndexedHeading>();
    const visit = (node: Node, pos: number) => {
        if (node.type.name !== 'heading') return !node.isTextblock;
        if (node.textContent && !found.has(pos)) found.set(pos, {
          id: identities.get(pos) ?? `h-${this.sequence++}`,
          pos, size: node.nodeSize, level: Number(node.attrs.level), text: node.textContent,
        });
        return false;
    };
    for (const { from, to } of ranges) {
      // The transaction already resolves its final selection. Reuse that path for
      // ordinary typing, avoiding Fragment.nodesBetween's preceding-sibling loop.
      const local = selections.find(selection => selection.depth > 0 && selection.parent.isTextblock
        && from >= selection.before() && to <= selection.after());
      if (local) visit(local.parent, local.before());
      else doc.nodesBetween(from, to, visit);
    }
    return [...found.values()];
  }

  apply(transaction: Transaction): HeadingItem[] {
    if (!transaction.docChanged) return this.items;
    const doc = transaction.doc;
    const ranges: Range[] = [];
    transaction.steps.forEach((step, index) => {
      const following = transaction.mapping.slice(index + 1);
      let hasRange = false;
      step.getMap().forEach((_oldFrom, _oldTo, from, to) => {
        ranges.push({ from: following.map(from, -1), to: following.map(to, 1) });
        hasRange = true;
      });
      if (!hasRange) {
        // Marks and node-attribute steps can change headings without a position map.
        const data = step.toJSON() as { from?: number; to?: number; pos?: number };
        const from = data.from ?? data.pos;
        const to = data.to ?? (data.pos === undefined ? undefined : data.pos + 1);
        if (from !== undefined && to !== undefined) ranges.push({ from: following.map(from, -1), to: following.map(to, 1) });
        else ranges.push({ from: 0, to: doc.content.size }); // Unknown custom step: conservative rebuild.
      }
    });
    if (this.document !== transaction.before) ranges.push({ from: 0, to: doc.content.size });
    // Include both sides of deletion/join boundaries and the enclosing heading.
    const merged: Range[] = [];
    for (const range of ranges.sort((a, b) => a.from - b.from)) {
      const from = Math.max(0, range.from - 1), to = Math.min(doc.content.size, range.to + 1);
      const last = merged[merged.length - 1];
      if (last && from <= last.to) last.to = Math.max(last.to, to);
      else merged.push({ from, to });
    }
    const identities = new Map<number, string>();
    const retained: IndexedHeading[] = [];
    let rangeIndex = 0;
    for (const heading of this.entries) {
      const start = transaction.mapping.mapResult(heading.pos, 1);
      // setNodeMarkup replaces the opening token; its left edge still owns the ID.
      const pos = start.deleted ? transaction.mapping.map(heading.pos, -1) : start.pos;
      const end = transaction.mapping.map(heading.pos + heading.size, -1);
      if (end <= pos) continue;
      while (merged[rangeIndex] && merged[rangeIndex].to <= pos) rangeIndex++;
      const affected = merged[rangeIndex] && merged[rangeIndex].from < end;
      if (affected) { if (!identities.has(pos)) identities.set(pos, heading.id); }
      else retained.push(pos === heading.pos && end - pos === heading.size ? heading : { ...heading, pos, size: end - pos });
    }
    const changed = this.read(doc, merged, identities, [transaction.selection.$from, transaction.selection.$to]);
    const next: IndexedHeading[] = [];
    let left = 0, right = 0;
    while (left < retained.length || right < changed.length) {
      if (right === changed.length || (left < retained.length && retained[left].pos < changed[right].pos)) next.push(retained[left++]);
      else next.push(changed[right++]);
    }
    const unchanged = next.length === this.entries.length && next.every((item, index) => {
      const old = this.entries[index];
      return item.id === old.id && item.pos === old.pos && item.size === old.size && item.level === old.level && item.text === old.text;
    });
    this.document = doc;
    if (!unchanged) { this.entries = next; this.items = next; }
    return this.items;
  }
}
