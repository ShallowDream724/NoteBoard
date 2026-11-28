// 外部修改冲突处理：重载读取磁盘，覆盖保存当前编辑内容。

import * as ipc from '../../core/ipc/commands';
import { useDocumentStore } from '../../stores/documentStore';
import { useWindowStore } from '../../stores/windowStore';
import { getDocumentRevision, getEditorCapabilities } from '../../core/editor/editorRegistry';
import { showToast } from '../../stores/toastStore';
import { flushPendingSourceSnapshot, flushPendingVisualSnapshot } from '../../core/editor/pendingSnapshots';
import { enqueueDocumentWrite, flushDocument, getSessionGeneration, isClosing, writeDocumentWithBarrier } from '../session/documentSession';
import { discardStagedDocuments } from '../staging/stagingManager';
import { applyDocumentFromDisk } from './diskDocumentSnapshot';

/** Read after any queued writes and replace the live document in the same session. */
export async function reloadFromDisk(docKey: string): Promise<boolean> {
  const generation = getSessionGeneration(docKey);
  const revision = getDocumentRevision(docKey);
  const isCurrentConflict = () => getSessionGeneration(docKey) === generation
    && useDocumentStore.getState().getDocument(docKey)?.externalStatus === 'modified'
    && !isClosing(docKey) && !useWindowStore.getState().isTransferring(docKey);
  if (!isCurrentConflict()) return false;
  try {
    return await enqueueDocumentWrite(docKey, async () => {
      if (!isCurrentConflict()) return false;
      const payload = await ipc.readDocument(docKey);
      if (!isCurrentConflict()) return false;
      if (getDocumentRevision(docKey) !== revision) {
        showToast('读取期间有新的编辑，请再次选择重新加载。', 'warning');
        return false;
      }
      if (getEditorCapabilities(docKey)?.hasExplicitDraft?.()) {
        showToast('请先保存或取消说明草稿，再重新加载。', 'warning');
        return false;
      }
      if (!applyDocumentFromDisk(docKey, payload)) throw new Error('无法应用磁盘内容。');
      void discardStagedDocuments([docKey]).catch(error => console.warn('清理暂存失败:', error));
      showToast('已从磁盘重新加载', 'success');
      return true;
    });
  } catch (error) {
    if (!isCurrentConflict()) return false;
    console.error('重新加载失败:', error);
    const detail = error instanceof Error ? ` ${error.message}` : '';
    showToast(`重新加载失败，已保留当前内容。${detail}`, 'error');
    return false;
  }
}

/** 将当前编辑内容写入磁盘。写盘成功后才解除该会话的冲突。 */
export async function overwriteFromEditor(docKey: string): Promise<boolean> {
  const store = useDocumentStore.getState();
  const doc = store.getDocument(docKey);
  if (!doc || doc.externalStatus !== 'modified') return false;
  const generation = getSessionGeneration(docKey);
  const isCurrentConflict = () => getSessionGeneration(docKey) === generation
    && store.getDocument(docKey)?.externalStatus === 'modified';

  try {
    const captured = await flushDocument(docKey, 'save');
    if (!isCurrentConflict()) return false;
    const content = captured?.content
      ?? flushPendingSourceSnapshot(docKey)
      ?? flushPendingVisualSnapshot(docKey)
      ?? store.getDocument(docKey)?.content;
    if (content == null) {
      showToast('无法获取文档正文，覆盖已取消（冲突状态保留）', 'warning');
      return false;
    }

    let expectedNativeHash: string | undefined;
    if (doc.kind === 'noteboard') {
      // 以用户确认覆盖时的磁盘版本为条件，保留原生保存对后续修改的保护。
      const disk = await ipc.readDocument(docKey);
      if (disk.content == null) throw new Error('无法读取目标文档。');
      const { documentTextHash } = await import('../../core/nativeDocumentIO');
      expectedNativeHash = await documentTextHash(disk.content);
    }
    if (!isCurrentConflict()) return false;
    const ok = await writeDocumentWithBarrier(docKey, content, { expectedNativeHash });
    if (getSessionGeneration(docKey) !== generation) return false;
    if (!ok) {
      if (isCurrentConflict()) showToast('覆盖磁盘失败，冲突状态保留，可重试', 'error');
      return false;
    }
    if (isCurrentConflict()) {
      store.setExternalStatus(docKey, 'clean');
      useWindowStore.getState().setTabExternalStatus(docKey, 'clean');
    }
    showToast('已用当前内容覆盖磁盘文件', 'success');
    return true;
  } catch (e) {
    if (isCurrentConflict()) {
      console.error('覆盖磁盘失败:', e);
      const reason = e instanceof Error ? e.message : String(e);
      showToast(`覆盖磁盘失败，冲突状态保留。${reason}`, 'error');
    }
    return false;
  }
}
