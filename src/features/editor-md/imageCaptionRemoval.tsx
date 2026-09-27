import { useState } from 'react';
import { DialogShell, showTransientDialog } from '../../components/TransientDialog';
import { useSettingsStore } from '../../stores/settingsStore';
import { showToast } from '../../stores/toastStore';

type Action = 'remove' | 'keep';
interface Choice { action: Action | null; remember: boolean }
interface Content { hasCaption: boolean; hasAnnotations?: boolean }

function CaptionRemovalChoice({ content, finish }: { content: Content; finish: (choice: Choice) => void }) {
  const [remember, setRemember] = useState(false);
  const label = content.hasCaption && content.hasAnnotations ? '图注与补充说明' : content.hasCaption ? '图注' : '补充说明';
  return <DialogShell title={`同时移除${label}？`} description={`这张图片带有${label}。可以一起移除，也可以保留文字和说明。此操作可以撤销。`}
    onDismiss={() => finish({ action: null, remember: false })}>
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '18px 0', fontSize: 13 }}>
      <input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)}/>记住选择（可在设置中修改）
    </label>
    <div style={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
      <button type="button" className="nb-btn-secondary" onClick={() => finish({ action: null, remember: false })}>取消</button>
      <button type="button" className="nb-btn-secondary" onClick={() => finish({ action: 'keep', remember })}>保留{label}</button>
      <button type="button" className="nb-btn-primary" onClick={() => finish({ action: 'remove', remember })}>一起移除</button>
    </div>
  </DialogShell>;
}

/** Content removal is distinct from the on-disk asset cleanup policy. */
export async function resolveImageCaptionRemoval(content: Content): Promise<Action | null> {
  if (!content.hasCaption && !content.hasAnnotations) return 'remove';
  const policy = useSettingsStore.getState().settings.file.imageCaptionDeletionPolicy ?? 'ask';
  if (policy === 'keep' || policy === 'remove') return policy;
  const choice = await showTransientDialog<Choice>(finish => <CaptionRemovalChoice content={content} finish={finish}/>);
  if (choice.action && choice.remember) {
    try { await useSettingsStore.getState().setFile({ imageCaptionDeletionPolicy: choice.action }); }
    catch { showToast('本次选择已生效，但偏好未能保存，下次仍会询问。', 'error'); }
  }
  return choice.action;
}
