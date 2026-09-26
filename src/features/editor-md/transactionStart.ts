import type { StepMap } from '@tiptap/pm/transform';
import type { Step } from '@tiptap/pm/transform';

/** Earliest changed position in the transaction's original document.
 * Walk backwards, carrying just the earliest affected boundary. Step maps are
 * monotone, so mapping that minimum also maps the minimum of all later edits.
 * Each map/range is visited once, including bulk replacements; no prefix
 * mappings or document scan are needed for a history group's starting caret.
 */
export function transactionStart(maps: readonly StepMap[], steps: readonly Step[] = []): number | undefined {
  let first: number | undefined;
  for (let index = maps.length - 1; index >= 0; index--) {
    const map = maps[index];
    if (first !== undefined) first = map.invert().map(first);
    map.forEach(from => { first = Math.min(first ?? from, from); });
    // Mark and attribute steps have empty maps (no positions changed), but they
    // still own an edit location. Otherwise undo falls back to an unrelated caret.
    const step = steps[index] as (Step & { from?: number; pos?: number; patches?: Array<{ pos: number }> }) | undefined;
    const position = typeof step?.pos === 'number' && step.patches?.length
      ? step.pos + 1 + step.patches.reduce((minimum, patch) => Math.min(minimum, patch.pos), Infinity)
      : step?.from ?? step?.pos;
    if (typeof position === 'number') first = Math.min(first ?? position, position);
  }
  return first;
}
