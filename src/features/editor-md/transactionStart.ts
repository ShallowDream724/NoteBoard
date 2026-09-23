import type { StepMap } from '@tiptap/pm/transform';

/** Earliest changed position in the transaction's original document.
 * Walk backwards, carrying just the earliest affected boundary. Step maps are
 * monotone, so mapping that minimum also maps the minimum of all later edits.
 * Each map/range is visited once, including bulk replacements; no prefix
 * mappings or document scan are needed for a history group's starting caret.
 */
export function transactionStart(maps: readonly StepMap[]): number | undefined {
  let first: number | undefined;
  for (let index = maps.length - 1; index >= 0; index--) {
    const map = maps[index];
    if (first !== undefined) first = map.invert().map(first);
    map.forEach(from => { first = Math.min(first ?? from, from); });
  }
  return first;
}
