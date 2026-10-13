import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { loadBookmarks, saveBookmarks, registerBookmarkPersistence, reportBookmarkStorageError, ownsBookmarkPersistence } from './storage';
import { captureBookmarkContexts, mapBookmarks, recoverBookmarks, type DocumentBookmark } from './model';
import { BLOCK_MOVE_META, type BlockMove } from '../editor-md/headingFolding';
import { getMdSourceView, getMdTipTapEditor } from '../editor-md/editorInstances';
import { useWindowStore } from '../../stores/windowStore';
import { useDocumentStore } from '../../stores/documentStore';
import { sourceBookmarkSnapshot } from './sourcePersistence';

export const bookmarkKey = new PluginKey<readonly DocumentBookmark[]>('noteboard-document-bookmarks');
export const DocumentBookmarks = Extension.create<{ docKey: string }>({
  name: 'documentBookmarks',
  addOptions() { return { docKey: '' }; },
  addProseMirrorPlugins() {
    const docKey = this.options.docKey;
    return [new Plugin<readonly DocumentBookmark[]>({
      key: bookmarkKey,
      state: {
        init: (_, state) => recoverBookmarks(state.doc, loadBookmarks(docKey)),
        apply(tr, previous) {
          const replacement = tr.getMeta(bookmarkKey) as readonly DocumentBookmark[] | undefined;
          if (replacement) return replacement;
          if (!tr.docChanged || !previous.length) return previous;
          const move = tr.getMeta(BLOCK_MOVE_META) as BlockMove | undefined;
          return mapBookmarks(tr, previous, move ? move.ranges ?? [move] : []);
        },
      },
      view(view) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let sourceSnapshot: { input: readonly DocumentBookmark[]; records: readonly DocumentBookmark[] } | undefined;
        let sourceFailed = false;
        const flush = () => {
          clearTimeout(timer); timer = undefined;
          if (!ownsBookmarkPersistence(docKey, flush)) return;
          const records = bookmarkKey.getState(view.state) ?? [];
          const tab = useWindowStore.getState().tabs.find(tab => tab.key === docKey);
          if (tab?.viewMode === 'source') {
            const editor = getMdTipTapEditor(docKey), source = getMdSourceView(docKey)?.state.doc.toString() ?? useDocumentStore.getState().getDocument(docKey)?.content;
            if (editor && source !== undefined && source !== null) {
              try {
                const snapshot = sourceBookmarkSnapshot(editor, source, records);
                sourceSnapshot = { input: records, records: snapshot }; sourceFailed = false;
                return saveBookmarks(docKey, snapshot);
              } catch { sourceFailed = true; reportBookmarkStorageError('源码书签未能同步到本机；已有书签副本已保留。'); return false; }
            }
            if (sourceSnapshot?.input === records) return saveBookmarks(docKey, sourceSnapshot.records);
            if (!records.length) return saveBookmarks(docKey, records);
            reportBookmarkStorageError('源码书签未能同步到本机；已有书签副本已保留。');
            return false;
          }
          // React destroys the retained visual view after tab/CM registration
          // removal. Do not overwrite the explicit source barrier with its old root.
          if (!tab && sourceFailed) return false;
          if (!tab && sourceSnapshot?.input === records) return saveBookmarks(docKey, sourceSnapshot.records);
          sourceSnapshot = undefined; sourceFailed = false;
          return saveBookmarks(docKey, captureBookmarkContexts(view.state.doc, records));
        };
        const unregister = registerBookmarkPersistence(docKey, flush);
        return {
          update(current, previous) {
            const records = bookmarkKey.getState(current.state);
            if (records === bookmarkKey.getState(previous) && (current.state.doc === previous.doc || !records?.length)) return;
            if (timer === undefined) timer = setTimeout(flush, 500);
          },
          destroy() { flush(); unregister(); },
        };
      },
    })];
  },
});
