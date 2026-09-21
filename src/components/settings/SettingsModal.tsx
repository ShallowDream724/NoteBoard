import { useEffect, useRef, useState } from 'react';
import { X, Palette, Type, Keyboard, Info, FileCode, Folder, FileOutput } from 'lucide-react';
import { Tooltip } from '../Tooltip';
import { NavBtn } from './SettingsControls';
import { AppearancePanel } from './AppearancePanel';
import { TypographyPanel } from './TypographyPanel';
import { EditorPanel } from './EditorPanel';
import { FilePanel } from './FilePanel';
import { ShortcutsPanel } from './ShortcutsPanel';
import { AboutPanel } from './AboutPanel';
import { ExportPanel } from './ExportPanel';

const PANELS = [
  { key: 'appearance', label: '外观主题', icon: Palette, content: AppearancePanel },
  { key: 'typography', label: '排版与字体', icon: Type, content: TypographyPanel },
  { key: 'editor', label: '编辑器', icon: FileCode, content: EditorPanel },
  { key: 'file', label: '文件与保存', icon: Folder, content: FilePanel },
  { key: 'export', label: '导出', icon: FileOutput, content: ExportPanel },
  { key: 'shortcuts', label: '快捷键', icon: Keyboard, content: ShortcutsPanel },
  { key: 'about', label: '关于', icon: Info, content: AboutPanel },
] as const;

/** The single settings entry: this shell owns navigation and dismissal only. */
export function SettingsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<(typeof PANELS)[number]['key']>('appearance');
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [activeTab, isOpen]);
  useEffect(() => {
    if (!isOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [isOpen, onClose]);
  if (!isOpen) return null;
  const Panel = PANELS.find(panel => panel.key === activeTab)!.content;
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9990, display: 'flex',
      alignItems: 'center', justifyContent: 'center', background: 'rgba(0, 0, 0, 0.45)', backdropFilter: 'blur(4px)'
    }}>
      <div role="dialog" aria-modal="true" aria-label="NoteBoard 设置"
        style={{
          width: 880, maxWidth: '92vw', height: 660, maxHeight: '88vh',
          background: 'var(--editor-bg)', border: '1px solid var(--editor-border)', borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          color: 'var(--editor-text)', fontFamily: 'var(--ui-font-family)', fontSize: 'var(--ui-font-size)'
        }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', borderBottom: '1px solid var(--editor-border)', background: 'var(--editor-surface)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <img src="/logo.ico" alt="" width={18} height={18} />
            <span style={{ fontWeight: 600, fontSize: 14 }}>NoteBoard 设置</span>
          </div>
          <Tooltip content="关闭设置" shortcut="Esc" side="bottom" sideOffset={4}>
            <button type="button" aria-label="关闭设置" onClick={onClose}
              style={{
                display: 'flex', padding: 4, border: 'none', background: 'transparent',
                color: 'var(--editor-text-muted)', borderRadius: 'var(--radius-sm)', cursor: 'pointer'
              }}>
              <X size={16} />
            </button>
          </Tooltip>
        </div>
        <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <nav aria-label="设置分类" style={{
            width: 165, flexShrink: 0, borderRight: '1px solid var(--editor-border)',
            background: 'var(--editor-surface)', padding: '14px 8px', display: 'flex', flexDirection: 'column', gap: 6
          }}>
            {PANELS.map(({ key, label, icon: Icon }) => (
              <NavBtn key={key} active={activeTab === key} icon={<Icon size={15} />} label={label} onClick={() => setActiveTab(key)} />
            ))}
          </nav>
          <div ref={contentRef} style={{ flex: 1, minWidth: 0, padding: '24px 30px', overflowY: 'auto' }}>
            <Panel />
          </div>
        </div>
      </div>
    </div>
  );
}
