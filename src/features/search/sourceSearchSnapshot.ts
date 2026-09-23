import type { Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { SearchQuery } from '@codemirror/search';

interface Snapshot { doc: Text; query: string; ranges: Uint32Array }
const snapshots = new WeakMap<EditorView, Snapshot>();

/** One compact result index per live view. Selection/navigation does not change
 * Text identity, while edits and query changes replace the whole snapshot. */
export function sourceSearchRanges(view: EditorView, query: SearchQuery): Uint32Array {
  const key = JSON.stringify([query.search, query.caseSensitive, query.regexp, query.literal, query.wholeWord]);
  const previous = snapshots.get(view);
  if (previous?.doc === view.state.doc && previous.query === key) return previous.ranges;
  const positions: number[] = [];
  const cursor = query.getCursor(view.state.doc);
  for (let result = cursor.next(); !result.done; result = cursor.next()) positions.push(result.value.from, result.value.to);
  const ranges = Uint32Array.from(positions);
  snapshots.set(view, { doc: view.state.doc, query: key, ranges });
  return ranges;
}

export function sourceSearchIndex(ranges: Uint32Array, from: number, to: number): number {
  let low = 0, high = ranges.length / 2;
  while (low < high) { const mid = (low + high) >>> 1; if (ranges[mid * 2] < from) low = mid + 1; else high = mid; }
  return ranges[low * 2] === from && ranges[low * 2 + 1] === to ? low + 1 : 0;
}

export function clearSourceSearchSnapshot(view: EditorView) { snapshots.delete(view); }
