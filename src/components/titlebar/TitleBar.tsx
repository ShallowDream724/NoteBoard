// NoteBoard TitleBar
// 自绘标题栏：左侧栏开关 + tab 栏 + 拖拽区 + 窗口控制 + 设置入口
// 详见 docs/07-UI布局与交互规范.md §2

import { getCurrentWindow } from '@tauri-apps/api/window';
import { useRef } from 'react';
import { Settings as SettingsIcon, FileOutput, Home } from 'lucide-react';
import { TabBar } from './TabBar';
import { WindowControls } from './WindowControls';
import { NewDocumentMenu } from './NewDocumentMenu';
import { Tooltip } from '../Tooltip';
import { emit } from '../../core/emitter';
import { useLayoutStore } from '../../stores/layoutStore';
import { useUpdateStore } from '../../stores/updateStore';
import { SidebarToggle } from '../SidebarToggle';
import { useWindowStore } from '../../stores/windowStore';
import { useExportStore } from '../../features/export/exportStore';
import { UpdateNotice } from '../UpdateNotice';
import './titlebar.css';

export function TitleBar() {
  const settingsButton = useRef<HTMLButtonElement>(null);
  const toggleSettingsModal = useLayoutStore((s) => s.toggleSettingsModal);
  const explorerVisible = useLayoutStore((s) => s.explorerVisible);
  const toggleExplorer = useLayoutStore((s) => s.toggleExplorer);
  const outlineVisible = useLayoutStore((s) => s.outlineVisible);
  const toggleOutline = useLayoutStore((s) => s.toggleOutline);
  const markdownActive = useWindowStore((s) => s.tabs.find(tab => tab.key === s.activeKey)?.kind === 'markdown');
  // 当前是否有打开的标题栏/标签页菜单
  const hasActiveMenu = useLayoutStore((s) => s.activeMenuCount > 0);

  const hasUpdate = useUpdateStore(s => s.hasUpdate);

  const titleBarStyle: React.CSSProperties = {
    height: 36,
    display: 'flex',
    alignItems: 'center',
    background: 'var(--window-chrome-bg, var(--titlebar-bg))',
    userSelect: 'none',
    flexShrink: 0,
    fontFamily: 'var(--ui-font-family, inherit)',
    fontSize: 'var(--ui-font-size, 13px)',
  };

  return (
    <div style={titleBarStyle} role="banner">
      <div style={{ width: 36, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
        <SidebarToggle className="titlebar-action" side="left" visible={explorerVisible} onToggle={toggleExplorer} />
      </div>

      <div className="titlebar-document-actions">
        <Tooltip content="回到主界面" side="bottom">
          <button type="button" className="titlebar-action" aria-label="回到主界面" onClick={() => {
            emit('close-titlebar-menus', undefined);
            useWindowStore.setState({ activeKey: null });
          }}><Home size={15} /></button>
        </Tooltip>
      </div>

      {/* Tab 栏 */}
      <div className="titlebar-tab-group"><TabBar /><NewDocumentMenu /></div>

      {/* 拖拽空白区：当有菜单打开时临时解除 drag-region，点击直接关闭菜单且避免触发原生窗口拖动；无菜单时保留原生拖拽，双击最大化 */}
      <div
        {...(!hasActiveMenu ? { 'data-tauri-drag-region': '' } : {})}
        style={{
          flex: 1,
          height: '100%',
          minWidth: 32,
        }}
        onMouseDown={(e) => {
          // 若当前有菜单打开，阻止默认拖动行为并通知关闭所有标题栏浮层菜单
          if (hasActiveMenu) {
            e.preventDefault();
            emit('close-titlebar-menus', undefined);
          }
        }}
        onDoubleClick={() => {
          getCurrentWindow().toggleMaximize();
        }}
      />

      {/* 文档导出 */}
      <div className="titlebar-utility-actions">
      <Tooltip content="导出" shortcut="Ctrl+E" side="bottom">
        <button type="button" className="titlebar-action" aria-label="导出" disabled={!markdownActive}
          onClick={() => useExportStore.getState().open()}><FileOutput size={16}/></button>
      </Tooltip>
      {/* 设置中心按钮 */}
      <Tooltip content={hasUpdate ? '设置 · 有可用更新' : '设置'} side="bottom" sideOffset={6}>
        <button
          ref={settingsButton}
          className="titlebar-action"
          type="button"
          onClick={toggleSettingsModal}
          aria-label="打开设置"
        >
          <SettingsIcon size={15} />
          {hasUpdate && <span className="titlebar-update-dot" aria-label="有可用更新" />}
        </button>
      </Tooltip>
      {markdownActive && <SidebarToggle className="titlebar-action" side="right" visible={outlineVisible} onToggle={toggleOutline} />}
      </div>
      <WindowControls />
      <UpdateNotice anchor={settingsButton} />
    </div>
  );
}
