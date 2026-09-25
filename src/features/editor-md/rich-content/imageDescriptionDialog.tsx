import { useState } from 'react';
import { DialogShell, showTransientDialog } from '../../../components/TransientDialog';
function ImageDescriptionDialog({ value, finish }: { value: string; finish(value: string | null): void }) {
  const [description, setDescription] = useState(value);
  return <DialogShell title="图片描述" description="用于屏幕阅读器和图片无法显示时。可见图注可在图片下方编辑。" onDismiss={() => finish(null)} width={440}>
    <form onSubmit={event => { event.preventDefault(); finish(description.trim()); }}>
      <input aria-label="图片描述" className="nb-rich-url-input" autoFocus value={description} onChange={event => setDescription(event.target.value)} placeholder="描述图片内容"/>
      <div className="nb-rich-dialog-actions"><button type="button" title="取消编辑" className="nb-btn-secondary" onClick={() => finish(null)}>取消</button><button type="submit" title="保存图片描述" className="nb-btn-primary">保存</button></div>
    </form>
  </DialogShell>;
}
export function requestImageDescription(value: string): Promise<string | null> { return showTransientDialog(finish => <ImageDescriptionDialog value={value} finish={finish}/>); }
