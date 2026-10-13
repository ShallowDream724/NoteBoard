import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { BOOKMARK_COLORS, type DocumentBookmark } from './types';
import { validRange } from './rangeAnchors';
import './bookmarks.css';

export const BOOKMARK_FLASH_META = 'noteboard-bookmark-flash';
interface Flash { id: string; stamp: number }
const presentationKey = new PluginKey<Flash | null>('noteboard-bookmark-presentation');
const icon = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17l-6-4-6 4z"/></svg>';

export function createBookmarkPresentation(recordsFor: (state: EditorState) => readonly DocumentBookmark[]) {
  let lastDoc: EditorState['doc'] | undefined, lastRecords: readonly DocumentBookmark[] | undefined;
  let lastFlash: Flash | null | undefined, cached = DecorationSet.empty, stamp = 0;
  return new Plugin<Flash | null>({
    key: presentationKey,
    state: { init: () => null, apply: (tr, previous) => {
      const id = tr.getMeta(BOOKMARK_FLASH_META) as string | null | undefined;
      return id === undefined ? previous : id === null ? null : { id, stamp: ++stamp };
    } },
    props: { decorations(state) {
      const records = recordsFor(state), flash = presentationKey.getState(state);
      if (state.doc === lastDoc && records === lastRecords && flash === lastFlash) return cached;
      lastDoc = state.doc; lastRecords = records; lastFlash = flash;
      const decorations: Decoration[] = [];
      for (const record of records) {
        if (record.missing || !validRange(state.doc, record)) continue;
        const node = record.kind === 'range' ? null : state.doc.nodeAt(record.pos);
        if (record.kind !== 'range' && !node?.isBlock) continue;
        const color = BOOKMARK_COLORS.find(option => option.value === record.color)?.css ?? BOOKMARK_COLORS[0].css;
        if (record.kind === 'range' || node?.isTextblock) {
          const end = record.pos + record.size - (record.kind === 'range' ? 0 : 1);
          decorations.push(Decoration.widget(end, view => {
            const marker = view.dom.ownerDocument.createElement('span');
            marker.className = 'nb-bookmark-marker'; marker.contentEditable = 'false';
            marker.dataset.bookmarkId = record.id; marker.style.color = color;
            marker.setAttribute('role', 'img'); marker.setAttribute('aria-label', `书签：${record.label}`);
            marker.title = `书签：${record.label}`; marker.innerHTML = icon;
            return marker;
          }, { key: `bookmark-${record.id}-${color}`, side: -1, stopEvent: () => true }));
        } else {
          decorations.push(Decoration.node(record.pos, record.pos + record.size, {
            class: 'nb-bookmarked-block', 'data-bookmark-id': record.id, style: `--bookmark-color:${color}`,
          }));
        }
        if (flash?.id === record.id) {
          const from = record.pos + (node?.isTextblock ? 1 : 0);
          const to = record.pos + record.size - (node?.isTextblock ? 1 : 0);
          const attrs = { class: 'nb-bookmark-flash', 'data-bookmark-flash': String(flash.stamp) };
          decorations.push(record.kind === 'range' || node?.isTextblock ? Decoration.inline(from, to, attrs)
            : Decoration.node(from, to, attrs));
        }
      }
      cached = DecorationSet.create(state.doc, decorations);
      return cached;
    } },
    view(view) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      return {
        update(current, previous) {
          const flash = presentationKey.getState(current.state);
          if (flash === presentationKey.getState(previous)) return;
          clearTimeout(timer);
          if (flash) timer = setTimeout(() => {
            if (!view.isDestroyed && presentationKey.getState(view.state) === flash) {
              view.dispatch(view.state.tr.setMeta(BOOKMARK_FLASH_META, null).setMeta('addToHistory', false));
            }
          }, 1100);
        },
        destroy() { clearTimeout(timer); cached = DecorationSet.empty; lastDoc = undefined; lastRecords = undefined; },
      };
    },
  });
}
