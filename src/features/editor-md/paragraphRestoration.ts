import { Fragment, type Node } from '@tiptap/pm/model';
import type { Selection } from '@tiptap/pm/state';
import { isList } from './listItemActions';
import { RESTORABLE_TEXT_CONTAINERS, carryContainerAnnotation, inheritTextContainer, unwrapTextContainer } from './textContainerRestoration';

interface Segment { node: Node; selected: boolean }
const boundaries = new Set(['table', 'tableCell', 'tableHeader', 'githubAlert', 'disclosure', 'imageCollection', 'imageSlot', 'annotationStore', 'annotationBody']);

/** One command's local structural plan. Untouched nodes retain their identities. */
export function paragraphRestoration(selection: Selection) {
  const blocks = new Map<Node, Node>();
  let valid = true;
  const overlaps = (start: number, end: number) => selection.empty ? selection.from >= start && selection.from <= end
    : selection.ranges.some(({ $from, $to }) => start === end ? $from.pos <= start && $to.pos > start : $from.pos < end && $to.pos > start);
  const whole = (pos: number, node: Node) => !selection.empty && selection.ranges.some(({ $from, $to }) => $from.pos <= pos && $to.pos >= pos + node.nodeSize);
  const changed = (before: Node, after: Node) => { if (before.isTextblock) blocks.set(before, after); };
  const selectedBody = (node: Node, pos: number) => node.isTextblock && overlaps(pos + 1, pos + node.nodeSize - 1);
  function children(node: Node, pos: number): Segment[] {
    const result: Segment[] = [];
    node.forEach((child, offset) => {
      const at = pos + 1 + offset;
      if (overlaps(at, at + child.nodeSize)) result.push(...rewrite(child, at));
      else result.push({ node: child, selected: false });
    });
    return result;
  }
  function copy(node: Node, content: Node[]) {
    const fragment = Fragment.fromArray(content); valid &&= node.type.validContent(fragment);
    return fragment.eq(node.content) ? node : node.copy(fragment);
  }
  function rewriteList(list: Node, pos: number): Segment[] {
    const result: Segment[] = [];
    let group: Node[] = [], groupStart = 0, retainedShell = false;
    const flush = () => {
      if (!group.length) return;
      const attrs: Record<string, unknown> = { ...list.attrs, ...(list.type.name === 'orderedList' ? { start: (list.attrs.start ?? 1) + groupStart } : {}) };
      if (retainedShell && Object.hasOwn(attrs, 'annotationId')) attrs.annotationId = null;
      const content = Fragment.fromArray(group); valid &&= list.type.validContent(content);
      result.push({ node: list.type.create(attrs, content, list.marks), selected: false }); group = []; retainedShell = true;
    };
    list.forEach((item, offset, index) => {
      const itemPos = pos + 1 + offset;
      let selected = false;
      item.forEach((child, at) => { selected ||= selectedBody(child, itemPos + 1 + at); });
      const body = children(item, itemPos);
      if (selected) {
        flush();
        const inherited = inheritTextContainer(list, inheritTextContainer(item, body.map(segment => segment.node), changed), changed);
        result.push(...body.map((segment, index) => ({ ...segment, node: inherited[index] })));
      }
      else {
        if (!group.length) groupStart = index;
        group.push(copy(item, body.map(segment => segment.node)));
      }
    });
    flush();
    if (!retainedShell && list.attrs.annotationId) return carryContainerAnnotation(list, result.map(segment => segment.node), changed).map(node => ({ node, selected: true }));
    if (result.length === 1 && result[0].node.eq(list)) result[0].node = list;
    return result;
  }
  function rewriteQuote(quote: Node, pos: number): Segment[] {
    const result: Segment[] = [], body = children(quote, pos);
    let group: Node[] = [], retainedShell = false;
    const flush = () => { if (group.length) {
      const shell = copy(quote, group);
      result.push({ node: retainedShell && shell.attrs.annotationId ? shell.type.create({ ...shell.attrs, annotationId: null }, shell.content, shell.marks) : shell, selected: false });
      group = []; retainedShell = true;
    } };
    for (const segment of body) {
      if (segment.selected) { flush(); result.push({ ...segment, node: inheritTextContainer(quote, [segment.node], changed)[0] }); }
      else group.push(segment.node);
    }
    flush();
    return !retainedShell && quote.attrs.annotationId ? carryContainerAnnotation(quote, result.map(segment => segment.node), changed).map(node => ({ node, selected: true })) : result;
  }
  function rewrite(node: Node, pos: number): Segment[] {
    if (['annotationStore', 'documentPresentation'].includes(node.type.name)) return [{ node, selected: false }];
    if (isList(node)) return rewriteList(node, pos);
    if (node.type.name === 'blockquote') return rewriteQuote(node, pos);
    if (node.isTextblock) {
      const selected = selectedBody(node, pos);
      const next = selected && node.type.name === 'heading' ? node.type.schema.nodes.paragraph.create(node.attrs, node.content, node.marks) : node;
      if (next !== node) blocks.set(node, next);
      return [{ node: next, selected }];
    }
    if (!node.childCount) return [{ node, selected: !selection.empty && overlaps(pos, pos + node.nodeSize) }];
    const body = children(node, pos), next = copy(node, body.map(segment => segment.node));
    if (RESTORABLE_TEXT_CONTAINERS.has(node.type.name) && whole(pos, node)) {
      return unwrapTextContainer(node, body.map(segment => segment.node), changed).map(child => ({ node: child, selected: true }));
    }
    // Container contents may be restored locally, but a partial selection inside
    // a semantic/container boundary cannot unwrap structures outside it.
    const selected = boundaries.has(node.type.name)
      ? whole(pos, node)
      : body.some(segment => segment.selected);
    return [{ node: next, selected }];
  }
  const blockFor = (node: Node) => { let next: Node | undefined; while ((next = blocks.get(node))) node = next; return node; };
  return { rewrite: (node: Node, pos: number) => rewrite(node, pos).map(segment => segment.node), blockFor, isValid: () => valid };
}
