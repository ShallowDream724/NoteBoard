import { Files } from 'lucide-react';
import { useLayoutStore } from '../stores/layoutStore';

/** A quiet hint only while hovering an explicit file-open area. */
export function FileDropOverlay() {
  const isDraggingFile = useLayoutStore(s => s.isDraggingFile);
  if (!isDraggingFile) return null;
  return <div role="status" style={{
    position: 'absolute', top: 43, left: '50%', transform: 'translateX(-50%)', zIndex: 9999,
    pointerEvents: 'none', display: 'flex', alignItems: 'center', gap: 8,
    padding: '9px 14px', borderRadius: 9, fontSize: 13, fontFamily: 'var(--ui-font-family)',
    color: 'var(--editor-text)', background: 'var(--editor-surface)', border: '1px solid var(--editor-border)',
    boxShadow: '0 4px 16px rgb(0 0 0 / 10%)', whiteSpace: 'nowrap',
  }}><Files size={16} aria-hidden="true" />松开后在新标签页打开</div>;
}
