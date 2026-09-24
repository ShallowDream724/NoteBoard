// NoteBoard TabBar
// tab 栏 + dnd-kit 排序 + 横向滚动 + 右键上下文操作菜单
// Layout ownership: docs/architecture/settings-and-updates.md

import { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useMenuBounds } from '../useMenuBounds';
import { useTabOverflow } from './useTabOverflow';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  X,
  AlertTriangle,
  Unlink,
  ExternalLink,
  Copy,
  FolderOpen,
  ChevronLeft,
  ChevronRight,
  Trash2,
  GitCompare,
  Star,
} from 'lucide-react';
import { Tooltip } from '../Tooltip';
import { on, off } from '../../core/emitter';
import { useLayoutStore } from '../../stores/layoutStore';
import { useWindowStore, type Tab } from '../../stores/windowStore';
import { useDocumentStore } from '../../stores/documentStore';
import { useExplorerStore } from '../../features/explorer/explorerStore';
import { useFavoritesStore } from '../../features/favorites/favoritesStore';
import { findFavoriteByPath } from '../../features/favorites/favoritesUtils';
import { moveToNewWindow } from '../../features/window/windowManager';
import * as ipc from '../../core/ipc/commands';
import { getFileIcon } from '../FileIcon';
import { checkOpenDocumentStillExists } from '../../features/external/missingFileGuard';

// ── 类型图标映射 ──

function getTabIcon(tab: Tab) {
  const iconProps = { size: 14, style: { flexShrink: 0 } };

  // 外部变更图标
  if (tab.externalStatus === 'modified' || tab.externalStatus === 'renamed') {
    return <AlertTriangle {...iconProps} color="var(--warning-600)" />;
  }
  if (tab.isDetached) {
    return <Unlink {...iconProps} color="var(--error-500)" />;
  }

  // 文本对比工具 tab：双栏对比语义图标（与「+」菜单/欢迎卡片一致）
  if (tab.toolKind === 'textdiff') {
    return <GitCompare {...iconProps} color="#10b981" />;
  }

  // 统一调用优雅文件格式图标体系
  const targetPathOrName = tab.path || tab.displayName;
  return getFileIcon(targetPathOrName, { size: 14 });
}

// ── 单个 Tab ──

interface TabItemProps {
  tab: Tab;
  isActive: boolean;
  onActivate: () => void;
  onClose: () => void;
}

function TabItem({ tab, isActive, onActivate, onClose }: TabItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: tab.key });

  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useMenuBounds(menuRef, Boolean(menuPos), menuPos?.x ?? 0, menuPos?.y ?? 0);
  const { tabs, requestCloseOther, requestCloseLeft, requestCloseRight, requestCloseAll } = useWindowStore();

  // 计算当前标签页索引与各方向关闭操作可用状态
  const currentIndex = tabs.findIndex((t) => t.key === tab.key);
  const hasLeft = currentIndex > 0;
  const hasRight = currentIndex >= 0 && currentIndex < tabs.length - 1;
  const hasOther = tabs.length > 1;

  const favoritesData = useFavoritesStore((s) => s.data);
  const isFavorited = Boolean(tab.path && findFavoriteByPath(favoritesData.roots, tab.path));

  // 右键菜单打开时的外部点击关闭监听与全局活跃菜单状态同步
  useEffect(() => {
    if (!menuPos) return;
    // 增加全局活跃菜单计数，使标题栏拖拽空白区知晓当前有菜单浮层处于激活状态
    useLayoutStore.getState().incrementActiveMenu();

    // 点击菜单外部时自动关闭右键菜单
    const handleDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuPos(null);
      }
    };
    // 收到标题栏通知时主动关闭菜单
    const handleCloseEvent = () => {
      setMenuPos(null);
    };

    document.addEventListener('mousedown', handleDown);
    on('close-titlebar-menus', handleCloseEvent);

    return () => {
      // 菜单关闭后减少全局活跃菜单计数
      useLayoutStore.getState().decrementActiveMenu();
      document.removeEventListener('mousedown', handleDown);
      off('close-titlebar-menus', handleCloseEvent);
    };
  }, [menuPos]);

  // Only drag geometry is dynamic; appearance and hover are owned by CSS.
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform), transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <>
      <Tooltip content={tab.path ?? tab.displayName} followCursor disabled={Boolean(menuPos)} side="bottom" sideOffset={6}>
        <div
          ref={setNodeRef}
          className="nb-tab"
          style={style}
          {...attributes}
          {...listeners}
          onClick={onActivate}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMenuPos({ x: e.clientX, y: e.clientY });
          }}
          onAuxClick={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              onClose();
            }
          }}
          role="tab"
          aria-selected={isActive}
          aria-label={tab.displayName}
        >
          {/* 未保存圆点 */}
          {tab.isDirty && (
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--tab-dirty-dot)',
                flexShrink: 0,
              }}
            />
          )}

          {/* 类型图标 */}
          {getTabIcon(tab)}

          {/* Trailing padding keeps short titles outside the fade without measuring each tab. */}
          <span
            className="nb-tab-title"
            style={{ fontStyle: tab.isPreview ? 'italic' : 'normal' }}
          >
            {tab.displayName}
          </span>

          {/* 关闭按钮（固定靠在 Tab 最右侧） */}
          <button
            type="button"
            className="nb-tab-close"
            onPointerDown={event => event.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            aria-label={`关闭 ${tab.displayName}`}
          >
            <X size={12} />
          </button>
        </div>
      </Tooltip>

      {/* Tab 右键上下文菜单 */}
      {menuPos && createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            top: menuPos.y,
            left: menuPos.x,
            zIndex: 9999,
            background: 'var(--editor-surface)',
            border: '1px solid var(--editor-border)',
            borderRadius: 'var(--radius-sm)',
            boxShadow: 'var(--shadow-md)',
            padding: '4px',
            minWidth: 150,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* 关闭当前标签页 */}
          <button
            type="button"
            style={getMenuItemStyle(false)}
            onClick={() => {
              setMenuPos(null);
              onClose();
            }}
            onMouseEnter={handleMenuItemMouseEnter}
            onMouseLeave={handleMenuItemMouseLeave}
            onMouseDown={handleMenuItemMouseDown}
            onMouseUp={handleMenuItemMouseUp}
          >
            <X size={13} />
            <span>关闭标签页</span>
          </button>

          {/* 关闭左侧 */}
          <button
            type="button"
            disabled={!hasLeft}
            style={getMenuItemStyle(!hasLeft)}
            onClick={() => {
              if (!hasLeft) return;
              setMenuPos(null);
              requestCloseLeft(tab.key);
            }}
            onMouseEnter={handleMenuItemMouseEnter}
            onMouseLeave={handleMenuItemMouseLeave}
            onMouseDown={handleMenuItemMouseDown}
            onMouseUp={handleMenuItemMouseUp}
          >
            <ChevronLeft size={13} />
            <span>关闭左侧</span>
          </button>

          {/* 关闭右侧 */}
          <button
            type="button"
            disabled={!hasRight}
            style={getMenuItemStyle(!hasRight)}
            onClick={() => {
              if (!hasRight) return;
              setMenuPos(null);
              requestCloseRight(tab.key);
            }}
            onMouseEnter={handleMenuItemMouseEnter}
            onMouseLeave={handleMenuItemMouseLeave}
            onMouseDown={handleMenuItemMouseDown}
            onMouseUp={handleMenuItemMouseUp}
          >
            <ChevronRight size={13} />
            <span>关闭右侧</span>
          </button>

          {/* 关闭其他 */}
          <button
            type="button"
            disabled={!hasOther}
            style={getMenuItemStyle(!hasOther)}
            onClick={() => {
              if (!hasOther) return;
              setMenuPos(null);
              requestCloseOther(tab.key);
            }}
            onMouseEnter={handleMenuItemMouseEnter}
            onMouseLeave={handleMenuItemMouseLeave}
            onMouseDown={handleMenuItemMouseDown}
            onMouseUp={handleMenuItemMouseUp}
          >
            <X size={13} />
            <span>关闭其他</span>
          </button>

          {/* 关闭全部 */}
          <button
            type="button"
            style={getMenuItemStyle(false)}
            onClick={() => {
              setMenuPos(null);
              requestCloseAll();
            }}
            onMouseEnter={handleMenuItemMouseEnter}
            onMouseLeave={handleMenuItemMouseLeave}
            onMouseDown={handleMenuItemMouseDown}
            onMouseUp={handleMenuItemMouseUp}
          >
            <Trash2 size={13} />
            <span>关闭全部</span>
          </button>

          {/* 工具型视图（文本对比）无文档模型，不支持迁移到独立窗口 */}
          {!tab.toolKind && (
            <>
              <div style={{ height: 1, background: 'var(--editor-border)', margin: '4px 0' }} />

              {/* 在独立新窗口中打开 */}
              <button
                type="button"
                style={getMenuItemStyle(false)}
                onClick={() => {
                  setMenuPos(null);
                  moveToNewWindow(tab.key);
                }}
                onMouseEnter={handleMenuItemMouseEnter}
                onMouseLeave={handleMenuItemMouseLeave}
                onMouseDown={handleMenuItemMouseDown}
                onMouseUp={handleMenuItemMouseUp}
              >
                <ExternalLink size={13} />
                <span>在独立新窗口中打开</span>
              </button>
            </>
          )}

          {tab.path && (
            <>
              {/* 加入收藏夹 / 编辑收藏 */}
              <button
                type="button"
                style={getMenuItemStyle(false)}
                onClick={() => {
                  setMenuPos(null);
                  useFavoritesStore.getState().openAddModal({
                    key: tab.key,
                    displayName: tab.displayName,
                    path: tab.path ?? undefined,
                  });
                }}
                onMouseEnter={handleMenuItemMouseEnter}
                onMouseLeave={handleMenuItemMouseLeave}
                onMouseDown={handleMenuItemMouseDown}
                onMouseUp={handleMenuItemMouseUp}
              >
                <Star
                  size={13}
                  color="#f97316"
                  style={{ fill: isFavorited ? '#f97316' : 'none' }}
                />
                <span>{isFavorited ? '编辑收藏' : '加入收藏夹'}</span>
              </button>

              {/* 复制文件名 */}
              <button
                type="button"
                style={getMenuItemStyle(false)}
                onClick={() => {
                  setMenuPos(null);
                  navigator.clipboard.writeText(tab.displayName);
                }}
                onMouseEnter={handleMenuItemMouseEnter}
                onMouseLeave={handleMenuItemMouseLeave}
                onMouseDown={handleMenuItemMouseDown}
                onMouseUp={handleMenuItemMouseUp}
              >
                <Copy size={13} />
                <span>复制文件名</span>
              </button>

              {/* 复制文件完整路径 */}
              <button
                type="button"
                style={getMenuItemStyle(false)}
                onClick={() => {
                  setMenuPos(null);
                  if (tab.path) navigator.clipboard.writeText(tab.path);
                }}
                onMouseEnter={handleMenuItemMouseEnter}
                onMouseLeave={handleMenuItemMouseLeave}
                onMouseDown={handleMenuItemMouseDown}
                onMouseUp={handleMenuItemMouseUp}
              >
                <Copy size={13} />
                <span>复制文件完整路径</span>
              </button>

              {/* 在文件管理器中定位 */}
              <button
                type="button"
                style={getMenuItemStyle(false)}
                onClick={() => {
                  setMenuPos(null);
                  if (tab.path) ipc.revealInExplorer(tab.path);
                }}
                onMouseEnter={handleMenuItemMouseEnter}
                onMouseLeave={handleMenuItemMouseLeave}
                onMouseDown={handleMenuItemMouseDown}
                onMouseUp={handleMenuItemMouseUp}
              >
                <FolderOpen size={13} />
                <span>在文件管理器中定位</span>
              </button>
            </>
          )}
        </div>, document.body
      )}
    </>
  );
}

// 菜单项基础样式生成函数（支持禁用态）
function getMenuItemStyle(disabled = false): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '6px 10px',
    background: 'transparent',
    border: 'none',
    borderRadius: 4,
    textAlign: 'left',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'var(--ui-font-family, inherit)',
    fontSize: 'calc(var(--ui-font-size, 13px) - 1px)',
    color: disabled ? 'var(--editor-text-muted)' : 'var(--editor-text)',
    opacity: disabled ? 0.45 : 1,
    transition: 'all var(--transition-fast)',
  };
}

// 菜单项鼠标悬停高亮
function handleMenuItemMouseEnter(e: React.MouseEvent<HTMLButtonElement>) {
  if (!e.currentTarget.disabled) {
    e.currentTarget.style.background = 'var(--toolbar-hover)';
  }
}

// 菜单项鼠标移出还原
function handleMenuItemMouseLeave(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = 'transparent';
  e.currentTarget.style.transform = 'scale(1)';
}

// 菜单项鼠标按下按压反馈
function handleMenuItemMouseDown(e: React.MouseEvent<HTMLButtonElement>) {
  if (!e.currentTarget.disabled) {
    e.currentTarget.style.background = 'var(--toolbar-active)';
    e.currentTarget.style.transform = 'scale(0.98)';
  }
}

// 菜单项鼠标松开还原
function handleMenuItemMouseUp(e: React.MouseEvent<HTMLButtonElement>) {
  if (!e.currentTarget.disabled) {
    e.currentTarget.style.background = 'var(--toolbar-hover)';
    e.currentTarget.style.transform = 'scale(1)';
  }
}

// ── TabBar ──

export function TabBar() {
  const { tabs, activeKey, activateTab, requestCloseTab, reorderTabs } = useWindowStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  useTabOverflow(scrollRef, trackRef);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const fromIndex = tabs.findIndex((t) => t.key === active.id);
    const toIndex = tabs.findIndex((t) => t.key === over.id);
    if (fromIndex < 0 || toIndex < 0) return;
    reorderTabs(fromIndex, toIndex);
  };

  // 滚轮横滚
  const handleWheel = (e: React.WheelEvent) => {
    if (e.shiftKey) return; // Chromium already maps Shift+wheel to horizontal scrolling.
    if (scrollRef.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? scrollRef.current.clientWidth : 1;
      scrollRef.current.scrollLeft += e.deltaY * unit;
    }
  };

  // Tab 栏横向滚动容器
  const containerStyle: React.CSSProperties = {
    display: 'flex',
    height: '100%',
    overflowX: 'auto',
    overflowY: 'hidden',
    scrollbarWidth: 'none',
    flex: '0 1 auto',
    minWidth: 0,
    boxSizing: 'border-box',
  };

  // 点击激活或重复点击 Tab：激活并平滑定位资源管理器至该文件
  const handleActivateTab = (tabKey: string) => {
    const isCurrentActive = useWindowStore.getState().activeKey === tabKey;
    activateTab(tabKey);
    // 每次点击标签都检查运行期间的外部删除；缺失时由全局处置框接管。
    checkOpenDocumentStillExists(tabKey, true).catch(() => {});
    if (isCurrentActive && !tabKey.startsWith('untitled:')) {
      const doc = useDocumentStore.getState().documents.get(tabKey);
      if (doc?.key) {
        useExplorerStore.getState().setRevealed(doc.key, true);
      }
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', height: '100%', minWidth: 0, flex: '0 1 auto' }}>
      <div
        ref={scrollRef}
        className="nb-tab-viewport"
        style={containerStyle}
        onWheel={handleWheel}
        role="tablist"
      >
        <div ref={trackRef} className="nb-tab-track">
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext
            items={tabs.map((t) => t.key)}
            strategy={horizontalListSortingStrategy}
          >
            {tabs.map((tab) => (
              <TabItem
                key={tab.key}
                tab={tab}
                isActive={tab.key === activeKey}
                onActivate={() => handleActivateTab(tab.key)}
                onClose={() => requestCloseTab(tab.key)}
              />
            ))}
          </SortableContext>
        </DndContext>
        </div>
      </div>

    </div>
  );
}
