import { useState } from 'react';
import { DialogShell, showTransientDialog } from '../../components/TransientDialog';

interface Choice { action: 'keep' | 'trash'; remember: boolean }
function ImageRemovalChoice({ filename, finish }: { filename: string; finish: (choice: Choice) => void }) {
  const [remember, setRemember] = useState(false);
  return <DialogShell title="同时删除图片文件？" description="图片已从正文移除。同步删除会先保存文档，再将未被引用的图片移入系统回收站；撤销时可以恢复。"
    onDismiss={() => finish({ action: 'keep', remember: false })}>
    <p style={{ overflowWrap: 'anywhere', fontSize: 13 }}>{filename}</p>
    <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, margin: '18px 0' }}>
      <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
      以后默认按此选择处理（可在设置中修改）
    </label>
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
      <button type="button" className="nb-btn-secondary" onClick={() => finish({ action: 'keep', remember })}>保留文件</button>
      <button type="button" className="nb-btn-primary" onClick={() => finish({ action: 'trash', remember })}>同步删除</button>
    </div>
  </DialogShell>;
}
export function askImageRemoval(filename: string): Promise<Choice> {
  return showTransientDialog((finish) => <ImageRemovalChoice filename={filename} finish={finish} />);
}
