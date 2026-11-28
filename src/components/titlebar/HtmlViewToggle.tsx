import { CodeXml, PanelsTopLeft } from 'lucide-react';
import { useWindowStore } from '../../stores/windowStore';
import { useFilePreviewMode, switchFilePreviewMode } from '../../features/editor-code/filePreviewMode';
import { Tooltip } from '../Tooltip';

export function HtmlViewToggle({ docKey }: { docKey: string }) {
  const source = useFilePreviewMode(docKey) === 'source';
  const disabled = useWindowStore(state => state.isTransferring(docKey));
  const label = source ? '预览 HTML' : '查看 HTML 源码';
  return <Tooltip content={label} side="bottom">
    <button type="button" className="titlebar-action" aria-label={label} disabled={disabled}
      onClick={() => switchFilePreviewMode(docKey, source ? 'preview' : 'source')}>
      {source ? <PanelsTopLeft size={16}/> : <CodeXml size={16}/>}
    </button>
  </Tooltip>;
}
