import { isEditable } from '../core/docKind';
import type { Document } from '../stores/documentStore';
import type { SaveActivity } from '../stores/saveActivityStore';

type SaveMetadata = Pick<Document, 'key' | 'kind' | 'readonly' | 'isDirty' | 'savePolicy' | 'externalStatus'>;

/** Shared presentation only; actual writes remain in saveDocument's transaction. */
export function documentSaveStatus(doc: SaveMetadata | undefined, detached: boolean, activity?: SaveActivity) {
  const visible = Boolean(doc && isEditable(doc.kind));
  const saving = Boolean(activity?.pending);
  const needsPath = Boolean(doc && (doc.key.startsWith('untitled:') || detached || doc.externalStatus === 'deleted'));
  let state: 'saved' | 'unsaved' | 'saving' | 'error' = 'saved';
  let label = '已保存';
  let color = 'var(--statusbar-text)';
  let description = doc?.savePolicy === 'auto' ? '自动保存已启用 · 文件已保存' : '文件已保存';
  if (saving) {
    state = 'saving'; label = '正在保存'; color = 'var(--accent-strong)'; description = '正在写入文件';
  } else if (activity?.error) {
    state = 'error'; label = '保存失败'; color = 'var(--error-500)'; description = activity.error;
  } else if (doc?.isDirty || needsPath) {
    state = 'unsaved'; label = '未保存'; color = 'var(--warning-600)';
    description = needsPath ? '选择文件位置以保存文档' : doc?.savePolicy === 'auto' ? '修改尚未写入，自动保存已启用' : '有未保存的修改，按 Ctrl+S 保存';
  }
  return { visible, disabled: !visible || Boolean(doc?.readonly) || saving, state, label, color, description };
}
