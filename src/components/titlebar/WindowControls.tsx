import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, Copy, X } from 'lucide-react';
import { Tooltip } from '../Tooltip';
import { requestCurrentWindowClose } from '../../features/window/windowManager';

/** Native window actions share the titlebar's visual and keyboard-focus rules. */
export function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);
  useEffect(() => {
    const win = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const refresh = () => { void win.isMaximized().then(value => { if (!disposed) setIsMaximized(value); }); };
    refresh();
    void win.onResized(refresh).then(stop => { if (disposed) stop(); else unlisten = stop; });
    return () => { disposed = true; unlisten?.(); };
  }, []);

  return <div className="titlebar-window-controls">
    <Tooltip content="最小化" side="bottom" sideOffset={6}>
      <button type="button" className="titlebar-action" aria-label="最小化" onClick={() => { void getCurrentWindow().minimize(); }}><Minus size={15} /></button>
    </Tooltip>
    <Tooltip content={isMaximized ? '向下还原' : '最大化'} side="bottom" sideOffset={6}>
      <button type="button" className="titlebar-action" aria-label={isMaximized ? '还原' : '最大化'} onClick={() => { void getCurrentWindow().toggleMaximize(); }}>
        {isMaximized ? <Copy size={14} /> : <Square size={14} />}
      </button>
    </Tooltip>
    <Tooltip content="关闭" side="bottom" sideOffset={6}>
      <button type="button" className="titlebar-action titlebar-action--close" aria-label="关闭" onClick={requestCurrentWindowClose}><X size={15} /></button>
    </Tooltip>
  </div>;
}
