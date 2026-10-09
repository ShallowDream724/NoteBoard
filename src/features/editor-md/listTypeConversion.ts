import { Fragment, type Node, type NodeType } from '@tiptap/pm/model';
import type { Selection } from '@tiptap/pm/state';
import { isList } from './listItemActions';

/** An operation-local plan, with no editor, DOM or persistent document cache. */
export function listTypeConversion(selection: Selection, target: NodeType, itemType: NodeType, attributes: Record<string, unknown>) {
  const targets = new Set<Node>(), blocks = new Map<Node, Node>();
  let valid = true;
  const overlaps = (start: number, end: number) => selection.empty ? selection.from >= start && selection.from <= end
    : start === end ? selection.from <= start && selection.to > start : selection.from < end && selection.to > start;
  function rewrite(list: Node, pos: number): { nodes: Node[]; changed: boolean } {
    const groups: { type: NodeType; attrs: Record<string, unknown>; items: Node[]; converted: boolean }[] = [];
    let changed = false;
    list.forEach((item, offset, index) => {
      const itemPos = pos + 1 + offset;
      let selected = false;
      item.forEach((child, at) => { if (child.isTextblock && overlaps(itemPos + 2 + at, itemPos + at + child.nodeSize)) selected = true; });
      const type = selected ? target : list.type;
      let next = item;
      if (selected && list.type !== target) {
        valid &&= itemType.validContent(item.content);
        next = itemType.create(item.attrs, item.content, item.marks); changed = true;
      } else if (!selected) {
        const children: Node[] = []; let childChanged = false;
        item.forEach((child, at) => {
          const childPos = itemPos + 1 + at;
          if (isList(child) && overlaps(childPos, childPos + child.nodeSize)) {
            const nested = rewrite(child, childPos); children.push(...nested.nodes); childChanged ||= nested.changed;
          } else children.push(child);
        });
        if (childChanged) { next = item.copy(Fragment.fromArray(children)); changed = true; }
      }
      const last = groups.at(-1);
      if (last?.type === type) { last.items.push(next); last.converted ||= selected && list.type !== target; }
      else {
        const attrs = selected && list.type !== target ? { ...list.attrs, ...attributes } : { ...list.attrs };
        if (type.name === 'orderedList' && type === list.type) attrs.start = (list.attrs.start ?? 1) + index;
        groups.push({ type, attrs, items: [next], converted: selected && list.type !== target });
      }
    });
    if (!changed) return { nodes: [list], changed: false };
    const nodes = groups.map(group => {
      const content = Fragment.fromArray(group.items); valid &&= group.type.validContent(content);
      const node = group.type.create(group.attrs, content);
      if (group.converted) targets.add(node);
      return node;
    });
    return { nodes, changed };
  }
  function paragraph(node: Node) {
    const converted = node.type.name === 'paragraph' ? node : node.type.schema.nodes.paragraph.create(node.attrs, node.content);
    blocks.set(node, converted);
    const item = itemType.create(null, converted), list = target.create(attributes, item);
    valid &&= itemType.validContent(item.content) && target.validContent(list.content); targets.add(list);
    return list;
  }
  return { rewrite, paragraph, targets, blocks, isValid: () => valid };
}
