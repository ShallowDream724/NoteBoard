import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { getSearchQuery, search, SearchQuery } from '@codemirror/search';
import { executeFindNext, executeReplaceAll, executeSearch, watchSearchUpdates } from '../../src/features/search/searchController';
import { cancelRegexSearch, watchRegexSearch } from '../../src/features/search/regexSearchSession';
import { searchRegex } from '../../src/features/search/searchMatching';
import { collectRegexMatches } from '../../src/features/search/regexMatchingEngine';
import type { RegexSearchResult } from '../../src/features/search/regexProtocol';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { searchReplaceExtension } from '../../src/features/editor-md/searchReplace';

vi.mock('../../src/features/search/searchMatching', () => ({ searchRegex: vi.fn() }));
const views: EditorView[] = [];
const editors: Editor[] = [];
beforeEach(() => {
  vi.mocked(searchRegex).mockImplementation(async request => collectRegexMatches(request));
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { views.splice(0).forEach(view => view.destroy()); editors.splice(0).forEach(editor => editor.destroy()); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.mocked(searchRegex).mockReset(); document.body.replaceChildren(); });
function viewFor(text: string) { const view = new EditorView({ state: EditorState.create({ doc: text, extensions: [search()] }) }); views.push(view); return view; }
const options = { searchText: '(a+)', replaceText: '<$1>', caseSensitive: true, wholeWord: false, isRegex: true };

it('routes regex through the worker index, reuses it for navigation, and replaces capture groups', async () => {
  const view = viewFor('aa x aaa'), target = { type: 'codemirror' as const, view };
  const cursor = vi.spyOn(SearchQuery.prototype, 'getCursor');
  expect(await executeSearch(target, options)).toMatchObject({ matchCount: 2, matchIndex: 1 });
  expect(getSearchQuery(view.state).regexp).toBe(false); expect(getSearchQuery(view.state).search).toBe('');
  expect(await executeFindNext(target, options)).toMatchObject({ matchIndex: 2, matchCount: 2 });
  expect(searchRegex).toHaveBeenCalledTimes(1); expect(cursor).not.toHaveBeenCalled();
  expect(await executeReplaceAll(target, options)).toMatchObject({ success: true, replacedCount: 2 });
  expect(view.state.doc.toString()).toBe('<aa> x <aaa>');
});

it('cancels a closed search and never applies its late worker response', async () => {
  const view = viewFor('aa x aaa'), target = { type: 'codemirror' as const, view };
  let complete!: (result: RegexSearchResult) => void;
  vi.mocked(searchRegex).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const result = Promise.resolve(executeSearch(target, options)).catch(error => error);
  const signal = vi.mocked(searchRegex).mock.calls[0][1]!.signal!;
  cancelRegexSearch(target); expect(signal.aborted).toBe(true);
  complete({ ranges: Uint32Array.from([5, 8]) });
  expect((await result).name).toBe('AbortError'); expect(view.state.selection.main.from).toBe(0);
});

it('refreshes changed source text without applying stale ranges and reports persistent errors', async () => {
  const view = viewFor('aa x aaa'), target = { type: 'codemirror' as const, view }, updated = vi.fn();
  const stop = watchRegexSearch(target, updated);
  await executeSearch(target, options);
  view.dispatch({ changes: { from: 0, to: 2, insert: 'x' } });
  await vi.waitFor(() => expect(updated).toHaveBeenLastCalledWith(expect.objectContaining({ matchCount: 1, pending: false })));
  vi.mocked(searchRegex).mockResolvedValueOnce({ ranges: new Uint32Array(), error: '搜索超时，请简化表达式', limited: 'time' });
  expect(await executeSearch(target, { ...options, searchText: '(a+)+' })).toMatchObject({ matchCount: 0, error: '搜索超时，请简化表达式' });
  expect(await executeReplaceAll(target, { ...options, searchText: '(a+)+' })).toMatchObject({ success: false, replacedCount: 0 });
  stop();
});

it('refuses read-only replacements before work and rechecks after an asynchronous replacement plan', async () => {
  const readonly = new Compartment();
  const view = new EditorView({ state: EditorState.create({ doc: 'aaa', extensions: [search(), readonly.of(EditorState.readOnly.of(true))] }) }); views.push(view);
  const target = { type: 'codemirror' as const, view };
  expect(await executeReplaceAll(target, options)).toMatchObject({ success: false, replacedCount: 0 });
  expect(searchRegex).not.toHaveBeenCalled();
  view.dispatch({ effects: readonly.reconfigure(EditorState.readOnly.of(false)) });
  await executeSearch(target, options);
  let complete!: (result: RegexSearchResult) => void;
  vi.mocked(searchRegex).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const replacement = executeReplaceAll(target, options);
  await vi.waitFor(() => expect(complete).toBeDefined());
  view.dispatch({ effects: readonly.reconfigure(EditorState.readOnly.of(true)) });
  complete({ ranges: Uint32Array.from([0, 3]), replacements: ['changed'] });
  expect(await replacement).toMatchObject({ success: false, replacedCount: 0 });
  expect(view.state.doc.toString()).toBe('aaa');
});

it('captured subscription cleanup clears the previous plain search without clearing another view', () => {
  const first = viewFor('word'), second = viewFor('word'), plain = { ...options, searchText: 'word', isRegex: false as const };
  const stop = watchSearchUpdates({ type: 'codemirror', view: first }, () => {});
  executeSearch({ type: 'codemirror', view: first }, plain); executeSearch({ type: 'codemirror', view: second }, plain);
  stop();
  expect(getSearchQuery(first.state).search).toBe(''); expect(getSearchQuery(second.state).search).toBe('word');
});

it('preserves visual literal/regex navigation and literal replacement syntax without executing regex in the visual matcher', async () => {
  const element = document.createElement('div'); document.body.append(element);
  const editor = new Editor({ element, extensions: [StarterKit, searchReplaceExtension()], content: '<p>word <strong>word</strong> sword</p>' }); editors.push(editor);
  const target = { type: 'tiptap' as const, editor }, plain = { ...options, searchText: 'word', isRegex: false as const };
  expect(executeSearch(target, plain)).toMatchObject({ matchCount: 3 });
  const regex = { ...options, searchText: '\\bwo(rd)\\b', replaceText: '$1' };
  expect(await executeSearch(target, regex)).toMatchObject({ matchCount: 2 });
  expect(await executeFindNext(target, regex)).toMatchObject({ matchIndex: 2 });
  expect(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to)).toBe('word');
  expect(await executeReplaceAll(target, regex)).toMatchObject({ success: true, replacedCount: 2, matchCount: 0 });
  expect(editor.state.doc.textContent).toBe('$1 $1 sword');
  expect(executeSearch(target, { ...plain, searchText: 'sword' })).toMatchObject({ matchCount: 1 });
  editor.setEditable(false);
  expect(await executeReplaceAll(target, { ...regex, searchText: 'sword' })).toMatchObject({ success: false, replacedCount: 0 });
});
