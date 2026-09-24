import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
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
import { useSettingsStore } from '../../stores/settingsStore';
import { useUpdateStore } from '../../stores/updateStore';

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
  const saveError = useSettingsStore(state => state.saveError);
  const hasUpdate = useUpdateStore(state => state.hasUpdate);
  const [activeTab, setActiveTab] = useState<(typeof PANELS)[number]['key']>('appearance');
  const contentRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const background = useRef<{ element: HTMLElement; inert: boolean } | null>(null);
  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [activeTab, isOpen]);
  if (!isOpen) return null;
  const Panel = PANELS.find(panel => panel.key === activeTab)!.content;
  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay style={{ position: 'fixed', inset: 0, zIndex: 9990, background: 'rgba(0, 0, 0, 0.45)', backdropFilter: 'blur(4px)' }} />
      <Dialog.Content data-shortcuts-suspended aria-describedby={undefined}
        onKeyDown={event => event.stopPropagation()}
        onOpenAutoFocus={() => {
          previousFocus.current = document.activeElement as HTMLElement | null;
          const root = document.getElementById('root');
          if (root) { background.current = { element: root, inert: root.inert }; root.inert = true; }
        }}
        onCloseAutoFocus={event => {
          event.preventDefault();
          if (background.current) { background.current.element.inert = background.current.inert; background.current = null; }
          if (previousFocus.current?.isConnected) previousFocus.current.focus();
        }}
        style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 9991,
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
            <Dialog.Title asChild><span style={{ fontWeight: 600, fontSize: 14 }}>NoteBoard 设置</span></Dialog.Title>
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
        {saveError && <div role="alert" style={{ padding: '9px 20px', flexShrink: 0, borderBottom: '1px solid var(--editor-border)', color: 'var(--error-500)', fontSize: 12, overflowWrap: 'anywhere', userSelect: 'text' }}>
          设置未能保存：{saveError}
        </div>}
        <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <nav aria-label="设置分类" style={{
            width: 165, flexShrink: 0, borderRight: '1px solid var(--editor-border)',
            background: 'var(--editor-surface)', padding: '14px 8px', display: 'flex', flexDirection: 'column', gap: 6
          }}>
            {PANELS.map(({ key, label, icon: Icon }) => (
              <NavBtn key={key} active={activeTab === key} icon={<Icon size={15} />} label={key === 'about' && hasUpdate ? '关于 · 有更新' : label} onClick={() => setActiveTab(key)} />
            ))}
          </nav>
          <div ref={contentRef} style={{ flex: 1, minWidth: 0, padding: '24px 30px', overflowY: 'auto' }}>
            <Panel />
          </div>
        </div>
      </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
