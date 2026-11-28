import { bumpDocumentRevision, getEditorCapabilities } from '../../core/editor/editorRegistry';
import { emit } from '../../core/emitter';
import { flushPendingSourceSnapshot, flushPendingVisualSnapshot } from '../../core/editor/pendingSnapshots';
import type { DocumentPayload } from '../../core/ipc/types';
import { useDocumentStore } from '../../stores/documentStore';
import { useWindowStore } from '../../stores/windowStore';
import { getBaseline } from '../editor-md/serialize';
import {
  initializeDocumentHistory,
  resetDocumentHistoryFromDisk,
  synchronizeCurrentDocumentHistoryContent,
} from '../history/documentHistory';

/** The caller verifies the snapshot still belongs to this document session. */
export function applyDocumentFromDisk(docKey: string, payload: DocumentPayload): boolean {
  const store = useDocumentStore.getState();
  const doc = store.getDocument(docKey);
  if (doc?.loadState !== 'loaded' || payload.content == null || payload.kind !== doc.kind) return false;

  const tabs = useWindowStore.getState();
  const mode = tabs.getTab(docKey)?.viewMode === 'source' ? 'source' : 'visual';
  const editor = getEditorCapabilities(docKey);
  if (doc.kind === 'markdown' || doc.kind === 'noteboard' || doc.kind === 'code') {
    if (editor?.hasExplicitDraft?.()) return false;
    if (!resetDocumentHistoryFromDisk(docKey, payload.content, doc.kind === 'code' ? 'code' : mode, !!editor)) return false;
  } else {
    flushPendingSourceSnapshot(docKey);
    flushPendingVisualSnapshot(docKey);
    if (editor) synchronizeCurrentDocumentHistoryContent(docKey, payload.content, mode);
    else initializeDocumentHistory(docKey, payload.content, 'code');
  }

  getBaseline(docKey).updateBaseline(payload.content);
  store.acceptDiskContent(docKey, payload);
  tabs.setTabDirty(docKey, false);
  tabs.setTabExternalStatus(docKey, 'clean');
  bumpDocumentRevision(docKey);
  emit('document-loaded', { key: docKey });
  return true;
}
