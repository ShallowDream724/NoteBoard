import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpCircle, X } from 'lucide-react';
import { useUpdateStore } from '../stores/updateStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useLayoutStore } from '../stores/layoutStore';
import { placeCursorTooltip } from './tooltipPosition';
import './updateNotice.css';

export function UpdateNotice({ anchor }: { anchor: RefObject<HTMLElement | null> }) {
  const result = useUpdateStore(s => s.updateResult);
  const dismissed = useUpdateStore(s => s.dismissedNoticeVersions);
  const noticeReady = useUpdateStore(s => s.noticeReady);
  const modalOpen = useUpdateStore(s => s.modalOpen);
  const initialized = useSettingsStore(s => s.initialized);
  const ignored = useSettingsStore(s => s.settings.updates?.ignoredVersion ?? '');
  const setUpdates = useSettingsStore(s => s.setUpdates);
  const settingsOpen = useLayoutStore(s => s.settingsModalVisible);
  const menuOpen = useLayoutStore(s => s.activeMenuCount > 0);
  // Let the user undo their checkbox choice before closing this particular notice.
  const [editingPreference, setEditingPreference] = useState('');
  const [error, setError] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  const offered = result?.latestVersion ?? '';
  const visible = Boolean(initialized && noticeReady && result?.updateAvailable && offered &&
    (ignored !== offered || editingPreference === offered) && !dismissed.includes(offered) &&
    !modalOpen && !settingsOpen && !menuOpen);
  useLayoutEffect(() => {
    const element = panel.current; if (!visible || !element) return;
    const position = () => {
      if (!anchor.current) return;
      const target = anchor.current.getBoundingClientRect();
      const next = placeCursorTooltip({ x: target.right, y: target.bottom }, element.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight }, 'bottom', 'end', 8);
      element.style.left = `${next.x}px`; element.style.top = `${next.y}px`; element.style.visibility = 'visible';
    };
    const resize = new ResizeObserver(position); resize.observe(element);
    window.addEventListener('resize', position); position();
    return () => { resize.disconnect(); window.removeEventListener('resize', position); };
  }, [visible, anchor]);
  if (!visible) return null;
  const close = () => { useUpdateStore.getState().dismissNotice(offered); setEditingPreference(''); setError(''); };
  return createPortal(<div ref={panel} className="update-notice" style={{ visibility: 'hidden' }}>
    <button type="button" className="update-notice-close" aria-label="暂时关闭更新提醒" onClick={close}><X size={14} /></button>
    <div role="status" className="update-notice-message"><ArrowUpCircle size={19} /><div><strong>有新版本可用</strong><p>NoteBoard v{offered}</p></div></div>
    <button type="button" className="update-notice-action" onClick={() => { close(); useUpdateStore.getState().openModal(); }}>查看更新</button>
    <label className="update-notice-mute"><input type="checkbox" checked={ignored === offered} onChange={event => {
      setEditingPreference(offered); setError('');
      void setUpdates({ ignoredVersion: event.target.checked ? offered : '' }).catch(error => setError(String(error)));
    }} />此版本不再提醒</label>
    {error && <p role="alert" className="update-notice-error">设置未保存：{error}</p>}
  </div>, document.body);
}
