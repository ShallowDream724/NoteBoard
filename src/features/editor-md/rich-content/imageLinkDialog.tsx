import { useState } from 'react';
import { DialogShell, showTransientDialog } from '../../../components/TransientDialog';
function ImageLinkDialog({ finish }: { finish(value: string | null): void }) {
  const [url, setUrl] = useState(''), [error, setError] = useState('');
  return <DialogShell title="从链接插入图片" description="粘贴图片地址，图片会插入到当前光标位置。" onDismiss={() => finish(null)} width={440}>
    <form onSubmit={event => {
      event.preventDefault(); const value = url.trim();
      try { const parsed = new URL(value); if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error(); finish(value); }
      catch { setError('请输入完整的 http 或 https 图片地址'); }
    }}>
      <input aria-label="图片地址" autoFocus value={url} onChange={event => { setUrl(event.target.value); setError(''); }} placeholder="https://…" className="nb-rich-url-input"/>
      {error && <p role="alert" className="nb-rich-url-error">{error}</p>}
      <div className="nb-rich-dialog-actions"><button type="button" className="nb-btn-secondary" onClick={() => finish(null)}>取消</button><button type="submit" className="nb-btn-primary" disabled={!url.trim()}>插入</button></div>
    </form>
  </DialogShell>;
}
export function requestImageLink() { return showTransientDialog<string | null>(finish => <ImageLinkDialog finish={finish}/>); }
