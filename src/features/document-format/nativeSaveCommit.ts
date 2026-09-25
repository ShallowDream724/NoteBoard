import { NATIVE_DOCUMENT_HEADER, readNativeMetadata, replaceNativeMetadata } from '../../core/nativeDocument';
import { useDocumentStore } from '../../stores/documentStore';
import { useWindowStore } from '../../stores/windowStore';
import { getMdSourceView, getMdTipTapEditor } from '../editor-md/editorInstances';
import { setEditorNativeMetadata } from '../editor-md/editorDocumentCodec';
import { setSourceNativeMetadata } from '../editor-md/sourceDocumentSync';
import { getBaseline } from '../editor-md/serialize';
import { synchronizeCurrentDocumentHistoryContent } from '../history/documentHistory';
import { noteSelfWrite } from '../explorer/directoryWatcher';
import type { PreparedNativeSave } from './nativePersistence';
import type { NativeSaveResult } from '../../core/nativeDocumentIO';

/** Called after flushing in-flight input. Only the committed link receipt changes;
 * source/body edits made while the disk write ran remain intact and dirty. */
export function commitNativeSaveMetadata(key: string, prepared: PreparedNativeSave & { result: NativeSaveResult }): void {
  const doc = useDocumentStore.getState().getDocument(key);
  const header = doc?.content?.replace(/^\uFEFF/, '');
  if (prepared.request.markdown && doc?.content != null && (header?.startsWith(`${NATIVE_DOCUMENT_HEADER}\n`) || header?.startsWith(`${NATIVE_DOCUMENT_HEADER}\r\n`))) {
    const current = readNativeMetadata(doc.content);
    if (current.markdown?.path === prepared.metadata.markdown?.path) {
      const metadata = { ...current, ...(prepared.metadata.markdown ? { markdown: prepared.metadata.markdown } : {}) };
      const content = replaceNativeMetadata(doc.content, metadata);
      const mode = useWindowStore.getState().getTab(key)?.viewMode === 'source' ? 'source' : 'visual';
      const editor = getMdTipTapEditor(key); if (editor && mode === 'visual') setEditorNativeMetadata(editor, metadata);
      const source = getMdSourceView(key); if (source) setSourceNativeMetadata(source, metadata);
      useDocumentStore.getState().setContent(key, content);
      synchronizeCurrentDocumentHistoryContent(key, content, mode);
    }
  }
  const markdown = prepared.request.markdown;
  if (markdown && prepared.result.markdown) {
    noteSelfWrite(markdown.path);
    // A paired save is refused while the linked tab is dirty. Never erase edits
    // entered there while the native write was running.
    const linked = useDocumentStore.getState().getDocument(markdown.path);
    if (linked) {
      if (!linked.isDirty) {
        useDocumentStore.getState().setContent(markdown.path, markdown.content);
        synchronizeCurrentDocumentHistoryContent(markdown.path, markdown.content, 'source');
      }
      useDocumentStore.getState().updateBaseline(markdown.path, markdown.content, prepared.result.markdown.mtime, prepared.result.markdown.size);
      getBaseline(markdown.path).updateBaseline(markdown.content);
      useWindowStore.getState().setTabDirty(markdown.path, useDocumentStore.getState().getDocument(markdown.path)?.isDirty ?? false);
    }
  }
}
