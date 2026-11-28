import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey, type SelectionBookmark, type Transaction } from '@tiptap/pm/state';
import { findScrollContainer } from '../../core/dom/scrollContainer';

interface ReadingPlace {
  selection: SelectionBookmark;
  viewportPosition: number | null;
  offset: number;
  scrollTop: number;
  scrollLeft: number;
  bookmarkId: string | null;
}
interface NavigationState { trail: ReadingPlace[]; bookmarkId: string | null }
const empty: NavigationState = { trail: [], bookmarkId: null };
export const readingNavigationKey = new PluginKey<NavigationState>('reading-navigation');

export function readingNavigationPlugin() {
  return new Plugin<NavigationState>({
    key: readingNavigationKey,
    state: {
      init: () => empty,
      apply(tr, state) {
        const next = tr.getMeta(readingNavigationKey) as NavigationState | undefined;
        if (next) return next;
        if (!tr.docChanged || !state.trail.length) return state;
        return { ...state, trail: state.trail.map(place => ({
          ...place, selection: place.selection.map(tr.mapping),
          viewportPosition: place.viewportPosition === null ? null : tr.mapping.map(place.viewportPosition),
        })) };
      },
    },
  });
}

/** Remember what was actually on screen, even if the caret was several pages away. */
export function rememberReadingPlace(editor: Editor, tr: Transaction, bookmarkId: string | null = null) {
  const state = readingNavigationKey.getState(editor.state);
  if (!state) return tr;
  const scroller = findScrollContainer(editor.view.dom);
  const bounds = scroller.getBoundingClientRect();
  const text = editor.view.dom.getBoundingClientRect();
  const sampleX = (Math.max(bounds.left, text.left) + Math.min(bounds.right, text.right)) / 2;
  const viewportPosition = bounds.height > 0 && bounds.width > 0
    ? editor.view.posAtCoords({ left: sampleX, top: bounds.top + 8 })?.pos ?? null : null;
  const place: ReadingPlace = {
    selection: editor.state.selection.getBookmark(), viewportPosition,
    offset: viewportPosition === null ? 0 : editor.view.coordsAtPos(viewportPosition).top - bounds.top,
    scrollTop: scroller.scrollTop, scrollLeft: scroller.scrollLeft, bookmarkId: state.bookmarkId,
  };
  const last = state.trail.at(-1);
  const repeated = last && last.viewportPosition === place.viewportPosition && last.scrollTop === place.scrollTop
    && last.selection.resolve(editor.state.doc).eq(editor.state.selection);
  return tr.setMeta(readingNavigationKey, { trail: repeated ? state.trail : [...state.trail.slice(-15), place], bookmarkId });
}

export function returnToReadingPlace(editor: Editor) {
  const state = readingNavigationKey.getState(editor.state), place = state?.trail.at(-1);
  if (!state || !place) return;
  editor.view.dispatch(editor.state.tr.setSelection(place.selection.resolve(editor.state.doc))
    .setMeta(readingNavigationKey, { trail: state.trail.slice(0, -1), bookmarkId: place.bookmarkId })
    .setMeta('addToHistory', false));
  editor.view.focus();
  const scroller = findScrollContainer(editor.view.dom);
  const top = place.viewportPosition === null ? place.scrollTop
    : scroller.scrollTop + editor.view.coordsAtPos(place.viewportPosition).top - scroller.getBoundingClientRect().top - place.offset;
  scroller.scrollTo({ top, left: place.scrollLeft, behavior: 'instant' });
}
