import { CharCategory } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { SearchQuery, setSearchQuery } from '@codemirror/search';
import { TextSelection } from '@tiptap/pm/state';
import { searchAndReplacePluginKey, type SearchAndReplaceStorage } from '@sereneinserenade/tiptap-search-and-replace';
import { EDITOR_SEARCH_NAVIGATION_META } from '../../core/editor/searchNavigation';
import type { MatchStats, ReplaceOutcome } from '../../core/editor/editorTypes';
import { searchTextRuns } from '../editor-md/searchDecorations';
import type { EditorTarget, SearchOptions } from './searchController';
import { searchRegex, type RegexSearchRequest, type RegexSearchResult } from './searchMatching';
import { installRegexHighlights, setRegexRanges } from './regexHighlights';
import { clearSourceSearchSnapshot, sourceSearchIndex } from './sourceSearchSnapshot';

type Target = Exclude<EditorTarget, null>;
interface Session {
  target: Target; options: SearchOptions; key: string; doc: object;
  segments: RegexSearchRequest['segments']; ranges: Uint32Array; index: number;
  controller: AbortController; promise: Promise<MatchStats>; dispose: () => void;
  pending: boolean; error?: string;
  mutating?: boolean;
}
const sessions = new WeakMap<object, Session>();
const listeners = new WeakMap<object, Set<(stats: MatchStats) => void>>();
const owner = (target: Target) => target.type === 'tiptap' ? target.editor : target.view;
const documentOf = (target: Target) => target.type === 'tiptap' ? target.editor.state.doc : target.view.state.doc;
const selectionOf = (target: Target) => target.type === 'tiptap' ? target.editor.state.selection : target.view.state.selection.main;
const storageOf = (target: Extract<Target, { type: 'tiptap' }>) => (target.editor.storage as unknown as { searchAndReplace: SearchAndReplaceStorage }).searchAndReplace;
const statsOf = (session: Session): MatchStats => ({ matchCount: session.ranges.length / 2, matchIndex: session.ranges.length ? session.index + 1 : 0, pending: session.pending, error: session.error });
const emit = (session: Session) => listeners.get(owner(session.target))?.forEach(listener => listener(statsOf(session)));
const alive = (session: Session) => sessions.get(owner(session.target)) === session;

export function watchRegexSearch(target: EditorTarget, listener: (stats: MatchStats) => void): () => void {
  if (!target) return () => {};
  const key = owner(target), set = listeners.get(key) ?? new Set(); set.add(listener); listeners.set(key, set);
  return () => { set.delete(listener); if (!set.size) { listeners.delete(key); cancelRegexSearch(target); } };
}

function display(session: Session, navigate = false) {
  const { target, ranges, index } = session;
  const from = ranges[index * 2], to = ranges[index * 2 + 1];
  if (target.type === 'codemirror') {
    target.view.dispatch({ effects: [setRegexRanges.of(ranges), ...(navigate && ranges.length ? [EditorView.scrollIntoView(from, { y: 'center' })] : [])],
      selection: navigate && ranges.length ? { anchor: from, head: to } : undefined, userEvent: navigate ? 'select.search' : undefined });
  } else {
    storageOf(target).resultIndex = index;
    const tr = target.editor.state.tr.setMeta(searchAndReplacePluginKey, { ranges });
    if (navigate && ranges.length) tr.setSelection(TextSelection.create(tr.doc, from, to)).setMeta(EDITOR_SEARCH_NAVIGATION_META, true).scrollIntoView();
    target.editor.view.dispatch(tr);
  }
}

export function cancelRegexSearch(target: EditorTarget, clear = true) {
  if (!target) return;
  const key = owner(target), session = sessions.get(key);
  if (!session) return;
  sessions.delete(key); session.controller.abort(); session.dispose();
  if (clear) { session.ranges = new Uint32Array(); display(session); }
}

function filterWholeWords(session: Session, result: RegexSearchResult): RegexSearchResult {
  if (session.target.type !== 'codemirror' || !session.options.wholeWord || result.error) return result;
  const text = session.segments[0].text, category = session.target.view.state.charCategorizer(session.target.view.state.selection.main.head);
  const before = (pos: number) => Array.from(text.slice(Math.max(0, pos - 2), pos)).at(-1) ?? '';
  const after = (pos: number) => String.fromCodePoint(text.codePointAt(pos) ?? 0);
  const positions: number[] = [], replacements: string[] | undefined = result.replacements ? [] : undefined;
  for (let index = 0; index < result.ranges.length / 2; index++) {
    const from = result.ranges[index * 2], to = result.ranges[index * 2 + 1];
    if (from !== to && ((category(before(from)) === CharCategory.Word && category(after(from)) === CharCategory.Word) || (category(after(to)) === CharCategory.Word && category(before(to)) === CharCategory.Word))) continue;
    positions.push(from, to); if (replacements) replacements.push(result.replacements![index]);
  }
  return { ...result, ranges: Uint32Array.from(positions), replacements };
}

function requestOf(session: Session, replacement = false): RegexSearchRequest {
  return { segments: session.segments, pattern: session.options.searchText, caseSensitive: session.options.caseSensitive,
    multiline: session.target.type === 'codemirror', wholeWord: session.target.type === 'tiptap' && session.options.wholeWord,
    ignoreWhitespace: session.target.type === 'tiptap',
    replacement: replacement ? { text: session.options.replaceText, syntax: session.target.type === 'codemirror' ? 'codemirror' : 'literal' } : undefined };
}

function run(session: Session, navigate: boolean): Promise<MatchStats> {
  session.controller.abort(); session.controller = new AbortController();
  const { signal } = session.controller, doc = documentOf(session.target);
  if (session.doc !== doc) {
    session.doc = doc;
    session.segments = session.target.type === 'tiptap' ? searchTextRuns(session.target.editor.state.doc) : [{ text: session.target.view.state.doc.toString(), from: 0 }];
  }
  session.pending = true; session.error = undefined; session.ranges = new Uint32Array(); display(session); emit(session);
  const promise = searchRegex(requestOf(session), { signal }).then(raw => {
    signal.throwIfAborted();
    if (!alive(session) || documentOf(session.target) !== doc) throw new DOMException('搜索已过期', 'AbortError');
    const result = filterWholeWords(session, raw), selection = selectionOf(session.target);
    session.ranges = result.ranges; session.error = result.error; session.pending = false;
    session.index = Math.max(0, sourceSearchIndex(result.ranges, selection.from, selection.to) - 1);
    display(session, navigate); emit(session); return statsOf(session);
  });
  session.promise = promise;
  return promise;
}

function refresh(target: Target) {
  const session = sessions.get(owner(target));
  if (session && !session.mutating && session.doc !== documentOf(target)) void run(session, false).catch(() => {});
}

export function searchRegexTarget(target: Target, options: SearchOptions): Promise<MatchStats> {
  const key = JSON.stringify([options.searchText, options.caseSensitive, options.wholeWord]);
  const previous = sessions.get(owner(target));
  if (previous?.key === key) { previous.options = options; return (previous.doc === documentOf(target) ? previous.promise : run(previous, true)).then(() => statsOf(previous)); }
  const doc = documentOf(target), segments = previous?.doc === doc ? previous.segments : target.type === 'tiptap' ? searchTextRuns(target.editor.state.doc) : [{ text: target.view.state.doc.toString(), from: 0 }];
  cancelRegexSearch(target);
  if (target.type === 'tiptap') { target.editor.commands.setSearchTerm(''); }
  else {
    clearSourceSearchSnapshot(target.view);
    installRegexHighlights(target.view, () => refresh(target), () => cancelRegexSearch(target, false));
    target.view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '', literal: true })) });
  }
  const session: Session = { target, options, key, doc, segments, ranges: new Uint32Array(), index: 0, controller: new AbortController(), promise: Promise.resolve({ matchIndex: 0, matchCount: 0 }), dispose: () => {}, pending: true };
  sessions.set(owner(target), session);
  if (target.type === 'tiptap') {
    const updated = () => refresh(target), destroyed = () => cancelRegexSearch(target, false);
    target.editor.on('update', updated); target.editor.on('destroy', destroyed);
    session.dispose = () => { target.editor.off('update', updated); target.editor.off('destroy', destroyed); };
  }
  return run(session, true);
}

export async function navigateRegexTarget(target: Target, options: SearchOptions, direction: number): Promise<MatchStats> {
  await searchRegexTarget(target, options);
  const session = sessions.get(owner(target));
  if (!session || !session.ranges.length) return session ? statsOf(session) : { matchIndex: 0, matchCount: 0 };
  session.index = (session.index + direction + session.ranges.length / 2) % (session.ranges.length / 2);
  // Navigation preserves the broad index and moves only the current selection.
  if (target.type === 'tiptap') {
    storageOf(target).resultIndex = session.index;
    target.editor.view.dispatch(target.editor.state.tr.setSelection(TextSelection.create(target.editor.state.doc, session.ranges[session.index * 2], session.ranges[session.index * 2 + 1])).setMeta(EDITOR_SEARCH_NAVIGATION_META, true).scrollIntoView());
  } else target.view.dispatch({ selection: { anchor: session.ranges[session.index * 2], head: session.ranges[session.index * 2 + 1] }, effects: EditorView.scrollIntoView(session.ranges[session.index * 2], { y: 'center' }), userEvent: 'select.search' });
  emit(session); return statsOf(session);
}

export async function replaceRegexTarget(target: Target, options: SearchOptions, all: boolean): Promise<ReplaceOutcome> {
  const editable = () => target.type === 'codemirror' ? !target.view.state.readOnly : target.editor.isEditable;
  const readonly = (): ReplaceOutcome => ({ success: false, replacedCount: 0, matchIndex: 0, matchCount: 0, error: '当前文档为只读，无法替换' });
  if (!editable()) return readonly();
  await searchRegexTarget(target, options);
  const session = sessions.get(owner(target));
  if (!session || !session.ranges.length || session.error) return { success: false, replacedCount: 0, ...(session ? statsOf(session) : { matchIndex: 0, matchCount: 0 }) };
  const doc = session.doc, result = filterWholeWords(session, await searchRegex(requestOf(session, true), { signal: session.controller.signal }));
  if (!alive(session) || documentOf(target) !== doc || session.options.replaceText !== options.replaceText) throw new DOMException('搜索已过期', 'AbortError');
  if (result.error) return { success: false, replacedCount: 0, ...statsOf(session), error: result.error };
  if (!editable()) return readonly();
  const fromIndex = all ? 0 : session.index, count = all ? result.ranges.length / 2 : 1;
  session.mutating = true;
  try {
  if (target.type === 'codemirror') {
    const changes = Array.from({ length: count }, (_, offset) => { const index = fromIndex + offset; return { from: result.ranges[index * 2], to: result.ranges[index * 2 + 1], insert: result.replacements![index] }; });
    target.view.dispatch({ changes, userEvent: 'input.replace' });
  } else {
    const tr = target.editor.state.tr;
    for (let index = fromIndex + count - 1; index >= fromIndex; index--) tr.insertText(result.replacements![index], result.ranges[index * 2], result.ranges[index * 2 + 1]);
    target.editor.view.dispatch(tr);
  }
  } finally { session.mutating = false; }
  const stats = await run(session, true);
  return { success: true, replacedCount: count, ...stats };
}
