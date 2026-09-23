import { afterEach, expect, it, vi } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { Decoration, type EditorView } from '@tiptap/pm/view';
import { searchAndReplacePluginKey, type SearchAndReplaceStorage } from '@sereneinserenade/tiptap-search-and-replace';
import { currentSearchResultKey, searchDecorationPlugins } from '../../src/features/editor-md/searchDecorations';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); document.body.replaceChildren(); });
const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} } });
const storage = (): SearchAndReplaceStorage => ({ searchTerm: 'word', replaceTerm: '', results: [], lastSearchTerm: '', caseSensitive: false, lastCaseSensitive: false, resultIndex: 0, lastResultIndex: 0 });

it('keeps 50,000 matches indexed while navigation only creates one current decoration', () => {
  const paragraph = schema.node('paragraph', null, schema.text(('word ' + 'x'.repeat(11)).repeat(10)));
  const doc = schema.node('doc', null, Array.from({ length: 5000 }, () => paragraph)), data = storage();
  let state = EditorState.create({ doc, plugins: searchDecorationPlugins(data, { searchResultClass: 'nb-search-result', disableRegex: false }) });
  state = state.apply(state.tr);
  expect(data.results).toHaveLength(50_000);
  expect(searchAndReplacePluginKey.getState(state).find().length).toBeLessThanOrEqual(2000);
  const base = searchAndReplacePluginKey.getState(state), results = data.results;
  const scan = vi.spyOn(doc, 'descendants'), create = vi.spyOn(Decoration, 'inline');
  data.resultIndex = 1;
  state = state.apply(state.tr.setSelection(TextSelection.create(doc, data.results[1].from, data.results[1].to)));
  expect(scan).not.toHaveBeenCalled(); expect(create).toHaveBeenCalledTimes(1);
  expect(data.results).toBe(results); expect(searchAndReplacePluginKey.getState(state)).toBe(base);
  expect(currentSearchResultKey.getState(state)!.find()).toHaveLength(1);
  // A viewport update selects an indexed range without rerunning the query.
  state = state.apply(state.tr.setMeta('searchViewport', { from: 0, to: doc.content.size }));
  expect(scan).not.toHaveBeenCalled();
  expect(searchAndReplacePluginKey.getState(state).find()).toHaveLength(2000);
});

it('rebuilds the index for actual text/query changes and clears all highlights on close', () => {
  const data = storage(), doc = schema.node('doc', null, schema.node('paragraph', null, schema.text('word WORD sword')));
  let state = EditorState.create({ doc, plugins: searchDecorationPlugins(data, { searchResultClass: 'nb-search-result', disableRegex: false }) });
  state = state.apply(state.tr); expect(data.results).toHaveLength(3);
  data.caseSensitive = true; data.searchTerm = '\\bword\\b';
  state = state.apply(state.tr); expect(data.results).toHaveLength(1);
  state = state.apply(state.tr.insertText(' word', 5)); expect(data.results).toHaveLength(2);
  data.searchTerm = ''; state = state.apply(state.tr);
  expect(data.results).toHaveLength(0); expect(searchAndReplacePluginKey.getState(state).find()).toHaveLength(0);
  expect(currentSearchResultKey.getState(state)!.find()).toHaveLength(0);
});

it('does no viewport work without matches, initializes on a query-only change, and detaches on close', () => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const data = storage(); data.searchTerm = '';
  const doc = schema.node('doc', null, schema.node('paragraph', null, schema.text('word')));
  const plugins = searchDecorationPlugins(data, { searchResultClass: 'nb-search-result', disableRegex: false });
  const state = EditorState.create({ doc, plugins }), dom = document.createElement('div'); dom.dataset.editorScroll = ''; document.body.append(dom);
  vi.spyOn(dom, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 400));
  const view = { state, dom, isDestroyed: false, posAtCoords: vi.fn(() => ({ pos: 1, inside: -1 })), dispatch: vi.fn() } as unknown as EditorView;
  const lifecycle = plugins[0].spec.view!(view);
  document.dispatchEvent(new Event('scroll')); vi.runAllTimers();
  expect(view.posAtCoords).not.toHaveBeenCalled(); expect(view.dispatch).not.toHaveBeenCalled();
  data.searchTerm = 'word'; Object.assign(view, { state: state.apply(state.tr) });
  lifecycle.update!(view, state); vi.runAllTimers();
  expect(view.posAtCoords).toHaveBeenCalledTimes(2); expect(view.dispatch).toHaveBeenCalledTimes(1);
  const previous = view.state; data.searchTerm = ''; Object.assign(view, { state: previous.apply(previous.tr) }); lifecycle.update!(view, previous);
  vi.mocked(view.posAtCoords).mockClear(); vi.mocked(view.dispatch).mockClear();
  document.dispatchEvent(new Event('scroll')); vi.runAllTimers();
  expect(view.posAtCoords).not.toHaveBeenCalled(); expect(view.dispatch).not.toHaveBeenCalled();
  lifecycle.destroy!();
});
