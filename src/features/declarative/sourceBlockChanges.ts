import type { Node as PMNode } from '@tiptap/pm/model';

export interface BlockChange {
  oldFrom: number;
  oldTo: number;
  newFrom: number;
  newTo: number;
}

/** Coordinates are child indexes. Stable PM siblings anchor disjoint edits
 * made between saves, including when a previous insertion shifted indexes. */
export function changedBlockRuns(before: PMNode, after: PMNode, oldCount: number, newCount: number): BlockChange[] {
  let start = 0;
  while (start < oldCount && start < newCount && before.child(start).eq(after.child(start))) start++;
  let oldEnd = oldCount, newEnd = newCount;
  while (oldEnd > start && newEnd > start && before.child(oldEnd - 1).eq(after.child(newEnd - 1))) {
    oldEnd--;
    newEnd--;
  }
  const changes: BlockChange[] = [];
  let oldFrom = start, newFrom = start;
  function finish(oldTo: number, newTo: number) {
    if (oldTo !== oldFrom || newTo !== newFrom) changes.push({ oldFrom, oldTo, newFrom, newTo });
    oldFrom = oldTo + 1;
    newFrom = newTo + 1;
  }
  const indexes = new Map<PMNode, number>();
  for (let i = start; i < oldEnd; i++) {
    const node = before.child(i);
    // A shared leaf object used more than once is not a unique source anchor.
    indexes.set(node, indexes.has(node) ? -1 : i);
  }
  for (let i = start; i < newEnd; i++) {
    const anchor = indexes.get(after.child(i));
    if (anchor !== undefined && anchor >= oldFrom) finish(anchor, i);
  }
  finish(oldEnd, newEnd);
  return changes;
}
