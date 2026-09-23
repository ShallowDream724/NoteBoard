import { afterEach, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { SearchQuery } from '@codemirror/search';
import { sourceSearchIndex, sourceSearchRanges } from '../../src/features/search/sourceSearchSnapshot';

afterEach(() => vi.restoreAllMocks());
it('reuses the compact source index for navigation/replacement-text changes and invalidates real edits', () => {
  const view = { state: EditorState.create({ doc: 'word word WORD' }) } as EditorView;
  const query = new SearchQuery({ search: 'word', literal: true });
  const scan = vi.spyOn(SearchQuery.prototype, 'getCursor');
  const ranges = sourceSearchRanges(view, query);
  expect([...ranges]).toEqual([0, 4, 5, 9, 10, 14]);
  view.setState = state => Object.assign(view, { state });
  view.setState(view.state.update({ selection: { anchor: 5, head: 9 } }).state);
  expect(sourceSearchRanges(view, new SearchQuery({ search: 'word', literal: true, replace: 'x' }))).toBe(ranges);
  expect(sourceSearchIndex(ranges, 5, 9)).toBe(2); expect(scan).toHaveBeenCalledTimes(1);
  view.setState(view.state.update({ changes: { from: 0, insert: 'word ' } }).state);
  expect(sourceSearchRanges(view, query).length).toBe(8); expect(scan).toHaveBeenCalledTimes(2);
});
