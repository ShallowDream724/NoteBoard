import { LoaderCircle, Save } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useDocumentStore } from '../../stores/documentStore';
import { useWindowStore } from '../../stores/windowStore';
import { useSaveActivityStore } from '../../stores/saveActivityStore';
import { saveDocument } from '../../features/editor-code/orchestration/saveDocument';
import { emit } from '../../core/emitter';
import { Tooltip } from '../Tooltip';
import { documentSaveStatus } from '../documentSaveStatus';

export function SaveDocumentButton() {
  const key = useWindowStore(s => s.activeKey);
  const detached = useWindowStore(s => Boolean(key && s.getTab(key)?.isDetached));
  // Content changes with unchanged save state must not rerender the title bar.
  const doc = useDocumentStore(useShallow(s => {
    const value = key ? s.documents.get(key) : undefined;
    if (!value) return undefined;
    const { kind, readonly, isDirty, savePolicy, externalStatus } = value;
    return { key: value.key, kind, readonly, isDirty, savePolicy, externalStatus };
  }));
  const activity = useSaveActivityStore(s => key ? s.activities.get(key) : undefined);
  const status = documentSaveStatus(doc, detached, activity);
  if (!status.visible) return null;
  const description = doc?.readonly ? '只读文件，请使用另存为保存副本'
    : status.state === 'error' ? `保存失败 · 点击重试：${status.description}`
      : status.state === 'saved' ? '保存当前文档 · 已保存' : status.description;
  return <Tooltip content={description} shortcut="Ctrl+S" side="bottom">
    <button type="button" className="titlebar-action titlebar-save" data-save-state={status.state}
      aria-label="保存当前文档" aria-busy={status.state === 'saving'} disabled={status.disabled}
      onMouseDown={event => { if (event.button === 0) event.preventDefault(); }}
      onDoubleClick={event => event.stopPropagation()}
      onClick={() => {
        if (!key) return;
        emit('close-titlebar-menus', undefined);
        void saveDocument(key);
      }}>
      {status.state === 'saving' ? <LoaderCircle size={15} className="titlebar-save-spinner" /> : <Save size={15} />}
    </button>
  </Tooltip>;
}
