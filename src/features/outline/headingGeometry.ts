import { lastAtOrBefore } from '../../core/dom/orderedPosition';
import type { HeadingItem } from './headingIndex';

interface HeadingDOM { id: string; pos: number; element: HTMLElement }
interface HeadingOffset { id: string; pos: number; top: number }
interface HeadingGroup {
  element: HTMLElement;
  headings: HeadingDOM[];
  offsets: HeadingOffset[];
  dirty: boolean;
}

/**
 * Top-level editor blocks are vertically ordered, even when headings inside a
 * table are not. Keep only each group's relative geometry: growing a formula
 * above it moves the group without invalidating any of its heading offsets.
 */
export class HeadingGeometry {
  private headings: readonly HeadingItem[] = [];
  private nodes = new Map<string, HTMLElement>();
  private groups: HeadingGroup[] = [];
  private structureDirty = true;
  private dependencies = new Map<Element, HeadingGroup>();
  private resize: ResizeObserver | undefined;
  private mutations: MutationObserver;

  constructor(private root: HTMLElement, private nodeDOM: (pos: number) => Node | null) {
    this.resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(entries => {
      for (const entry of entries) {
        const group = this.dependencies.get(entry.target);
        if (group) group.dirty = true;
      }
    });
    // Observe only source flow parents, never descendants of sibling NodeViews.
    // Asynchronous KaTeX/matrix painting cannot cause a structural rebuild.
    this.mutations = new MutationObserver(() => this.invalidateStructure());
    this.mutations.observe(root, { childList: true });
  }

  setHeadings(headings: readonly HeadingItem[]) {
    this.headings = headings;
    this.invalidateStructure();
  }

  invalidateStructure() { this.structureDirty = true; }

  private rebuild() {
    const nodes = new Map<string, HTMLElement>();
    const groups = new Map<HTMLElement, HeadingGroup>();
    const parents = new Set<Element>();
    this.resize?.disconnect();
    this.mutations.disconnect();
    this.mutations.observe(this.root, { childList: true });
    this.dependencies.clear();

    for (const heading of this.headings) {
      const cached = this.nodes.get(heading.id);
      // Position mappings usually retain the same DOM. Only a new/replaced
      // heading requires ProseMirror's potentially linear nodeDOM lookup.
      const element = cached && this.root.contains(cached) ? cached : this.nodeDOM(heading.pos);
      if (!(element instanceof HTMLElement) || !this.root.contains(element)) continue;
      nodes.set(heading.id, element);
      let block = element;
      while (block.parentElement && block.parentElement !== this.root) block = block.parentElement;
      let group = groups.get(block);
      if (!group) {
        group = { element: block, headings: [], offsets: [], dirty: true };
        groups.set(block, group);
      }
      group.headings.push({ id: heading.id, pos: heading.pos, element });
    }

    for (const group of groups.values()) {
      const observe = (element: Element) => {
        if (group.headings.length === 1 || this.dependencies.has(element)) return;
        this.dependencies.set(element, group);
        this.resize?.observe(element);
      };
      observe(group.element);
      for (const heading of group.headings) {
        for (let parent = heading.element.parentElement; parent && parent !== this.root; parent = parent.parentElement) {
          if (parents.has(parent)) break;
          parents.add(parent);
          this.mutations.observe(parent, { childList: true });
          // A short table cell can change heading Y without resizing its row.
          // Its flow siblings therefore belong to this group's dependencies.
          for (const child of parent.children) observe(child);
        }
      }
    }
    this.nodes = nodes;
    this.groups = [...groups.values()];
    this.structureDirty = false;
  }

  /** Viewport Y is read once by the caller; no scrollTop-dependent cache exists. */
  at(viewportY: number): string | null {
    if (this.structureDirty) this.rebuild();
    const tops = new Map<number, number>();
    const hidden = new Set<number>();
    const top = (index: number) => {
      let value = tops.get(index);
      if (value !== undefined) return value;
      const skipped: number[] = [];
      for (let previous = index; previous >= 0; previous--) {
        value = tops.get(previous);
        if (value !== undefined) break;
        const rectangles = this.groups[previous].element.getClientRects();
        if (rectangles.length) {
          // Each top-level flow block has a single CSS box. A hidden block has
          // no Y; use its predecessor's key so binary-search order stays valid.
          value = rectangles[0].top;
          tops.set(previous, value);
          break;
        }
        hidden.add(previous);
        skipped.push(previous);
      }
      value ??= Number.NEGATIVE_INFINITY;
      for (const previous of skipped) tops.set(previous, value);
      return value;
    };
    let index = lastAtOrBefore(this.groups.length, top, viewportY);
    // The current block can begin before its first heading. The preceding
    // heading then belongs to the previous group (normally one extra lookup).
    for (; index >= 0; index--) {
      const group = this.groups[index];
      const groupTop = top(index);
      if (hidden.has(index)) continue;
      if (group.headings.length === 1) {
        const heading = group.headings[0];
        const headingTop = heading.element === group.element ? groupTop : heading.element.getBoundingClientRect().top;
        if (headingTop <= viewportY && heading.element.getClientRects().length) return heading.id;
        continue;
      }
      if (group.dirty) {
        group.offsets = group.headings
          .filter(heading => heading.element.getClientRects().length)
          .map(heading => ({ id: heading.id, pos: heading.pos, top: heading.element.getBoundingClientRect().top - groupTop }))
          .sort((a, b) => a.top - b.top || a.pos - b.pos);
        group.dirty = false;
      }
      const heading = lastAtOrBefore(group.offsets.length, i => group.offsets[i].top, viewportY - groupTop);
      if (heading >= 0) return group.offsets[heading].id;
    }
    return null;
  }

  destroy() {
    this.resize?.disconnect();
    this.mutations.disconnect();
    this.groups = [];
    this.nodes.clear();
    this.dependencies.clear();
  }
}
