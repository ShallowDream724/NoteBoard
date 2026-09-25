import { useState } from 'react';
import { DialogShell, showTransientDialog } from '../../components/TransientDialog';
export interface NativeConversionOptions { removeMarkdown: boolean }
export function NativeConversionDialog({ finish, hasMarkdownFile = true }: { finish(value: NativeConversionOptions | null): void; hasMarkdownFile?: boolean }) {
  const [removeMarkdown, setRemoveMarkdown] = useState(false);
  const description = !hasMarkdownFile ? '创建 NB 文档，保留完整排版。' : removeMarkdown
    ? '创建 NB 文档，保留完整排版。原 Markdown 将被移除。'
    : '创建 NB 文档，保留完整排版。原 Markdown 将保留，保存时同步更新。';
  return <DialogShell title="转换为 NoteBoard 文档" description={description} onDismiss={() => finish(null)} width={440}>
    {hasMarkdownFile && <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
      <input type="checkbox" checked={removeMarkdown} onChange={event => setRemoveMarkdown(event.target.checked)}/>
      删除原 Markdown，不再关联
    </label>}
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 22 }}>
      <button type="button" title="取消转换" className="nb-btn-secondary" onClick={() => finish(null)}>取消</button>
      <button type="button" title="转换并继续" className="nb-btn-primary" onClick={() => finish({ removeMarkdown })}>转换并继续</button>
    </div>
  </DialogShell>;
}
export function requestNativeConversion(hasMarkdownFile = true): Promise<NativeConversionOptions | null> {
  return showTransientDialog(finish => <NativeConversionDialog finish={finish} hasMarkdownFile={hasMarkdownFile}/>);
}
