import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Palette, Type, Keyboard, Info, FileCode, Folder, FileOutput } from 'lucide-react';
import { Tooltip } from '../Tooltip';
import { NoteBoardFileIcon } from '../FileIcon';
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
import './settings.css';

const PANELS = [
  { key: 'appearance', label: '外观主题', group: '外观', icon: Palette, content: AppearancePanel },
  { key: 'typography', label: '排版与字体', group: '外观', icon: Type, content: TypographyPanel },
  { key: 'editor', label: '编辑器', group: '工作方式', icon: FileCode, content: EditorPanel },
  { key: 'shortcuts', label: '快捷键', group: '工作方式', icon: Keyboard, content: ShortcutsPanel },
  { key: 'file', label: '文件与保存', group: '工作方式', icon: Folder, content: FilePanel },
  { key: 'export', label: '导出', group: '工作方式', icon: FileOutput, content: ExportPanel },
  { key: 'about', label: '关于', group: '应用', icon: Info, content: AboutPanel },
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
      <Dialog.Content className="nb-settings" data-shortcuts-suspended aria-describedby={undefined}
        onEscapeKeyDown={event => { if (event.target instanceof Element && event.target.closest('[data-shortcut-recording]')) event.preventDefault(); }}
        onKeyDown={event => event.stopPropagation()}
        onOpenAutoFocus={() => {
          previousFocus.current = document.activeElement as HTMLElement | null;
          const root = document.getElementById('root');
          if (root) { background.current = { element: root, inert: root.inert }; root.inert = true; }
        }}
        onCloseAutoFocus={event => {
          event.preventDefault();
          if (background.current) { background.current.element.inert = background.current.inert; background.current = null; }
          if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true });
        }}
        >
        <div className="nb-settings-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <NoteBoardFileIcon size={18} />
            <Dialog.Title asChild><span style={{ fontWeight: 600, fontSize: 'calc(var(--ui-font-size, 13px) * 14 / 13)' }}>NoteBoard 设置</span></Dialog.Title>
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
        {saveError && <div role="alert" style={{ padding: '9px 20px', flexShrink: 0, borderBottom: '1px solid var(--editor-border)', color: 'var(--error-500)', fontSize: 'calc(var(--ui-font-size, 13px) * 12 / 13)', overflowWrap: 'anywhere', userSelect: 'text' }}>
          设置未能保存：{saveError}
        </div>}
        <div className="nb-settings-body">
          <nav aria-label="设置分类" className="nb-settings-nav">
            {[...new Set(PANELS.map(panel => panel.group))].map(group => <div className="nb-settings-nav-group" key={group}>
              <span className="nb-settings-nav-group-label">{group}</span>
              {PANELS.filter(panel => panel.group === group).map(({ key, label, icon: Icon }) => (
                <NavBtn key={key} active={activeTab === key} icon={<Icon size={15} />} label={key === 'about' && hasUpdate ? '关于 · 有更新' : label} onClick={() => setActiveTab(key)} />
              ))}
            </div>)}
          </nav>
          <div ref={contentRef} className="nb-settings-content">
            <Panel />
          </div>
        </div>
      </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
