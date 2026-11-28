import { confirm } from '@tauri-apps/plugin-dialog';
import { getDocumentRevision, getEditorCapabilities } from '../../../core/editor/editorRegistry';
import { flushPendingSourceSnapshot, flushPendingVisualSnapshot } from '../../../core/editor/pendingSnapshots';
import { getLargeFileThresholdBytes } from '../../../core/files/largeFilePolicy';
import * as ipc from '../../../core/ipc/commands';
import type { Encoding, Eol } from '../../../core/ipc/types';
import { NATIVE_DOCUMENT_HEADER } from '../../../core/nativeDocument';
import { isDocumentContentDirty, useDocumentStore } from '../../../stores/documentStore';
import { useWindowStore } from '../../../stores/windowStore';
import { showToast } from '../../../stores/toastStore';
import { applyDocumentFromDisk } from '../../external/diskDocumentSnapshot';
import {
  enqueueDocumentWrite, flushDocument, getSessionGeneration, isClosing, queuedAutoSave,
} from '../../session/documentSession';
import { discardStagedDocuments, scheduleStagingForFormatChange } from '../../staging/stagingManager';
import { saveDocument } from './saveDocument';

function getTextDocument(key: string) {
  const doc = useDocumentStore.getState().getDocument(key);
  if (doc?.loadState === 'loaded' && doc.content !== null && (doc.kind === 'code' || doc.kind === 'markdown' || doc.kind === 'noteboard')) return doc;
}

function hasNativeHeader(content: string): boolean {
  const header = NATIVE_DOCUMENT_HEADER;
  const source = content.startsWith('\uFEFF') ? content.slice(1) : content;
  return source === header || source.startsWith(`${header}\n`) || source.startsWith(`${header}\r\n`);
}

function canChangeFormat(key: string, generation: number): boolean {
  const tabs = useWindowStore.getState();
  return tabs.getTab(key) !== null && getSessionGeneration(key) === generation && !isClosing(key)
    && !tabs.isWindowClosing && !tabs.isTransferring(key) && getTextDocument(key) !== undefined;
}

/** Set the disk newline format independently of normalized editor snapshots. */
export async function changeFileEol(key: string, eol: Eol): Promise<boolean> {
  const generation = getSessionGeneration(key);
  if (!canChangeFormat(key, generation) || getTextDocument(key)?.readonly) return false;
  try {
    await flushDocument(key, 'save');
    if (!canChangeFormat(key, generation)) return false;
    flushPendingSourceSnapshot(key);
    flushPendingVisualSnapshot(key);
    const doc = getTextDocument(key);
    if (!doc || doc.readonly) return false;
    if (doc.eol === eol) return true;

    const store = useDocumentStore.getState();
    store.setEol(key, eol);
    const hasPendingInput = getEditorCapabilities(key)?.hasUnconfirmedInput?.() === true;
    if (hasPendingInput) store.setDirty(key, true);
    const updated = store.getDocument(key);
    if (!updated || updated.content === null) return false;
    useWindowStore.getState().setTabDirty(key, updated.isDirty);
    void ipc.setDocumentDirty(key, updated.isDirty).catch(() => {});
    scheduleStagingForFormatChange(key);
    if (!hasPendingInput) void queuedAutoSave(key, updated.content);
    return true;
  } catch (error) {
    if (canChangeFormat(key, generation)) showToast(`无法更改换行符：${String(error)}`, 'error');
    return false;
  }
}

/** Commit the chosen encoding with the ordinary save transaction. */
export function saveFileWithEncoding(key: string, encoding: Encoding): Promise<boolean> {
  const doc = getTextDocument(key);
  if (!doc || doc.readonly || !canChangeFormat(key, getSessionGeneration(key))) return Promise.resolve(false);
  if (doc.kind === 'noteboard' && encoding !== 'utf8') {
    showToast('NoteBoard 文档以 UTF-8 保存。可以使用其他编码重新打开已有文件', 'warning');
    return Promise.resolve(false);
  }
  if (doc.externalStatus === 'modified') {
    showToast('文件已在磁盘上修改，请先处理外部修改', 'warning');
    return Promise.resolve(false);
  }
  return saveDocument(key, encoding);
}

/** Re-decode the disk bytes and adopt them only if the user's edit version is unchanged. */
export async function reopenFileWithEncoding(key: string, encoding: Encoding): Promise<boolean> {
  const generation = getSessionGeneration(key);
  const canReopen = () => {
    const tab = useWindowStore.getState().getTab(key);
    return canChangeFormat(key, generation) && !key.startsWith('untitled:')
      && tab?.path !== null && !tab?.isDetached && getTextDocument(key)?.externalStatus !== 'deleted';
  };
  if (!canReopen()) return false;
  try {
    return await enqueueDocumentWrite(key, async () => {
      if (!canReopen()) return false;
      const startingRevision = getDocumentRevision(key);
      const captured = await flushDocument(key, 'save');
      if (!canReopen()) return false;
      flushPendingSourceSnapshot(key);
      flushPendingVisualSnapshot(key);
      const editor = getEditorCapabilities(key);
      if (editor?.hasExplicitDraft?.()) {
        showToast('请先保存或取消说明草稿，再重新打开文件', 'warning');
        return false;
      }
      const doc = getTextDocument(key);
      if (!doc || doc.content === null) return false;
      const stillCurrent = () => {
        const current = getTextDocument(key);
        if (!current || !canReopen()) return false;
        if (getDocumentRevision(key) === startingRevision && current.content === doc.content && current.eol === doc.eol
          && !getEditorCapabilities(key)?.hasExplicitDraft?.()) return true;
        showToast('文档有新的修改，请再次选择编码重新打开', 'warning');
        return false;
      };
      if (!stillCurrent()) return false;
      if (doc.isDirty || isDocumentContentDirty(doc, captured?.content ?? doc.content)) {
        const accepted = await confirm(`重新打开“${doc.displayName}”将丢弃未保存的修改。是否继续？`, {
          title: '选择编码重新打开',
          kind: 'warning',
          okLabel: '重新打开',
          cancelLabel: '取消',
        });
        if (!accepted || !stillCurrent()) return false;
      }
      const maxReadBytes = Math.ceil(Math.max(doc.size, getLargeFileThresholdBytes()));
      const payload = await ipc.readDocument(key, maxReadBytes, encoding);
      if (!stillCurrent()) return false;
      if (doc.kind === 'noteboard' && (payload.content === null || !hasNativeHeader(payload.content))) {
        throw new Error('所选编码读出的内容缺少有效的 NoteBoard 文档头');
      }
      if (!applyDocumentFromDisk(key, payload, payload.encoding)) throw new Error('无法应用磁盘内容');
      void ipc.setDocumentDirty(key, false).catch(() => {});
      void discardStagedDocuments([key], { onlyCurrentEdit: true }).catch(error => console.warn('清理暂存失败:', error));
      return true;
    });
  } catch (error) {
    if (canReopen()) showToast(`重新打开失败：${error instanceof Error ? error.message : String(error)}`, 'error');
    return false;
  }
}
