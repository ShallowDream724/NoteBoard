/** Persistent implicit AVL rope. Positions are subtree lengths, so inserting a
 * character never rewrites every later style offset. Payloads are immutable. */
export type SpanTree<T> = Leaf<T> | Branch<T>;
interface Leaf<T> { length: number; height: 1; value: T | null; left?: never; right?: never }
interface Branch<T> { length: number; height: number; left: SpanTree<T>; right: SpanTree<T>; value?: never }
export interface StyleSpan<T> { from: number; to: number; value: T }
function leaf<T>(length: number, value: T | null): SpanTree<T> | null { return length > 0 ? { length, height: 1, value } : null; }
function branch<T>(left: SpanTree<T>, right: SpanTree<T>): Branch<T> {
  return { left, right, length: left.length + right.length, height: Math.max(left.height, right.height) + 1 };
}
function balance<T>(left: SpanTree<T>, right: SpanTree<T>): SpanTree<T> {
  if (left.height > right.height + 1 && left.left) {
    if (left.right.height > left.left.height && left.right.left) {
      return branch(branch(left.left, left.right.left), branch(left.right.right, right));
    }
    return branch(left.left, branch(left.right, right));
  }
  if (right.height > left.height + 1 && right.left) {
    if (right.left.height > right.right.height && right.left.left) {
      return branch(branch(left, right.left.left), branch(right.left.right, right.right));
    }
    return branch(branch(left, right.left), right.right);
  }
  return branch(left, right);
}
function concat<T>(left: SpanTree<T> | null, right: SpanTree<T> | null): SpanTree<T> | null {
  if (!left || !right) return left ?? right;
  if (left.height > right.height + 1 && left.left) return balance(left.left, concat(left.right, right)!);
  if (right.height > left.height + 1 && right.left) return balance(concat(left, right.left)!, right.right);
  return branch(left, right);
}
function split<T>(tree: SpanTree<T> | null, at: number): [SpanTree<T> | null, SpanTree<T> | null] {
  if (!tree || at <= 0) return [null, tree];
  if (at >= tree.length) return [tree, null];
  if (!tree.left) return [leaf(at, tree.value), leaf(tree.length - at, tree.value)];
  if (at === tree.left.length) return [tree.left, tree.right];
  if (at < tree.left.length) { const [a, b] = split(tree.left, at); return [a, concat(b, tree.right)]; }
  const [a, b] = split(tree.right, at - tree.left.length); return [concat(tree.left, a), b];
}
function edge<T>(tree: SpanTree<T>, first: boolean): Leaf<T> {
  while (tree.left) tree = first ? tree.left : tree.right;
  return tree;
}
function join<T>(left: SpanTree<T> | null, right: SpanTree<T> | null): SpanTree<T> | null {
  if (!left || !right) return left ?? right;
  const a = edge(left, false), b = edge(right, true);
  if (a.value !== b.value) return concat(left, right);
  const [prefix] = split(left, left.length - a.length), [, suffix] = split(right, b.length);
  return concat(concat(prefix, leaf(a.length + b.length, a.value)), suffix);
}
export function spanValueAt<T>(tree: SpanTree<T> | null, at: number): T | null {
  if (!tree || at < 0 || at >= tree.length) return null;
  while (tree.left) { if (at < tree.left.length) tree = tree.left; else { at -= tree.left.length; tree = tree.right; } }
  return tree.value;
}
export function replaceStyleSpans<T>(tree: SpanTree<T> | null, from: number, to: number, insertedLength: number): SpanTree<T> | null {
  // Replacements inherit the first replaced character; insertion inherits its
  // left neighbour (or the first character at the start of a document).
  const inherited = spanValueAt(tree, to > from ? from : Math.max(0, from - 1));
  const [prefix] = split(tree, from), [, suffix] = split(tree, to);
  return join(join(prefix, leaf(insertedLength, inherited)), suffix);
}
export function buildStyleSpans<T>(length: number, ranges: readonly StyleSpan<T>[]): SpanTree<T> | null {
  const leaves: SpanTree<T>[] = []; let position = 0;
  const append = (size: number, value: T | null) => {
    if (size <= 0) return;
    const last = leaves[leaves.length - 1];
    if (last && !last.left && last.value === value) leaves[leaves.length - 1] = leaf(last.length + size, value)!;
    else leaves.push(leaf(size, value)!);
  };
  for (const range of ranges) {
    const from = Math.max(position, range.from), to = Math.min(length, range.to);
    if (to <= from) continue;
    append(from - position, null); append(to - from, range.value); position = to;
  }
  append(length - position, null);
  const build = (from: number, to: number): SpanTree<T> | null => {
    if (from === to) return null;
    if (from + 1 === to) return leaves[from];
    const middle = (from + to) >>> 1; return branch(build(from, middle)!, build(middle, to)!);
  };
  return build(0, leaves.length);
}
export function* styleSpans<T>(tree: SpanTree<T> | null, offset = 0): Generator<StyleSpan<T>> {
  if (!tree) return;
  if (tree.left) { yield* styleSpans(tree.left, offset); yield* styleSpans(tree.right, offset + tree.left.length); }
  else if (tree.value !== null) yield { from: offset, to: offset + tree.length, value: tree.value };
}
