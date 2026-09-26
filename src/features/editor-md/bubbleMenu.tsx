// NoteBoard 浮层菜单与表格工具条
// 支持选中文本浮层菜单（粗体/斜体/多色高亮/代码/链接/清除格式等）与精美表格操作工具条
// 详见 docs/09-开发路线图.md 8.8, 8.9

import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef, type ReactNode } from 'react';
import { TextSelection, type Transaction } from '@tiptap/pm/state';
import { isEmbeddedEditing } from './embeddedEditor';
import { useSettingsStore } from '../../stores/settingsStore';
import { findScrollContainer } from '../../core/dom/scrollContainer';
import { type Editor } from '@tiptap/core';
import { BubbleMenu } from '@tiptap/react/menus';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  Link2,
  RemoveFormatting,
  Trash2,
  Merge,
  Split,
  ExternalLink,
  Rows3, Columns3,
} from 'lucide-react';
import { handleLinkClick } from './linkHandler';
import { useWindowStore } from '../../stores/windowStore';
import { Tooltip } from '../../components/Tooltip';
import { TableAppearanceMenu } from './TableAppearanceMenu';
import { HighlightControl } from '../toolbar/HighlightControl';
import { setTextColor, applyTextStyle, setHighlightColor } from '../document-style/documentStyles';
import { AlignmentMenu } from '../document-style/AlignmentMenu';
import { useFormattingUpdates } from './useFormattingUpdates';
import { useEditorOverlayDismiss } from './useEditorOverlayDismiss';
import { runDiscreteEdit } from './discreteEdit';
import { TableInsertMenu } from './TableInsertMenu';
import { TableFillMenu } from './TableFillMenu';
import { documentTableStyle } from './documentPresentation';
import { tableHeaderState, setSelectedTableHeader, distributeTableColumns, distributeTableRows, tableDistributionState, tableDeleteScope, deleteTableSelection } from './tablePresentationCommands';
import { AnnotationButton, RichSelectionMenu } from './rich-content/menus';
import { runWithDocumentCapability, useNativeFeatureVisibility } from '../document-format/featureGate';

interface BubbleButtonProps {
  icon: ReactNode;
  onClick: () => void;
  active?: boolean;
  title?: string;
  danger?: boolean;
  disabled?: boolean;
}

/** 悬浮菜单基础按钮组件（舒适 32px 尺寸与精美悬停/按压动效） */
function BubbleButton({ icon, onClick, active, title, danger, disabled }: BubbleButtonProps) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);

  let background = 'transparent';
  let color = 'var(--editor-text)';

  if (active) {
    background = 'var(--editor-selection-background, rgba(59, 130, 246, 0.15))';
    color = 'var(--accent-500, #3b82f6)';
  } else if (pressed) {
    background = 'var(--toolbar-active, rgba(0, 0, 0, 0.12))';
  } else if (hovered) {
    if (danger) {
      background = 'rgba(239, 68, 68, 0.12)';
      color = '#ef4444';
    } else {
      background = 'var(--editor-hover-background, rgba(0, 0, 0, 0.06))';
    }
  }

  const btn = (
    <button
      type="button"
      disabled={disabled}
      onMouseDown={(e) => {
        e.preventDefault();
        setPressed(true);
      }}
      onMouseUp={() => setPressed(false)}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setPressed(false);
      }}
      style={{
        width: 32,
        height: 32,
        minWidth: 32,
        padding: 0,
        border: 'none',
        background,
        color,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.35 : 1,
        fontSize: 14,
        borderRadius: 6,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: pressed ? 'scale(0.97)' : 'scale(1)',
        transition: 'background 120ms ease, color 120ms ease, transform 120ms ease',
        userSelect: 'none',
      }}
      aria-label={title}
    >
      {icon}
    </button>
  );

  if (title) {
    return (
      <Tooltip content={title} side="top" sideOffset={6}>
        {btn}
      </Tooltip>
    );
  }

  return btn;
}

/** 分组垂直分割线 */
function MenuDivider() {
  return (
    <div
      style={{
        width: 1,
        height: 18,
        background: 'var(--editor-border, rgba(0,0,0,0.12))',
        margin: '0 4px',
        flexShrink: 0,
      }}
    />
  );
}



/** 判断当前选区是否为表格跨单元格多选（CellSelection） */
function isCellSelection(selection: unknown): boolean {
  if (!selection || typeof selection !== 'object') return false;
  return (
    (selection as { constructor?: { name?: string } }).constructor?.name === 'CellSelection' ||
    '$headCell' in selection ||
    'isCellSelection' in selection
  );
}

/** 选中文本浮层菜单组件 */
export function EditorBubbleMenu({
  editor,
  onOpenLinkModal,
  enabled = true,
  inlineOnly = false,
}: {
  editor: Editor;
  onOpenLinkModal?: () => void;
  enabled?: boolean;
  inlineOnly?: boolean;
}) {
  const enabledRef = useRef(enabled); enabledRef.current = enabled;
  useEffect(() => {
    if (!enabled && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta('bubbleMenu', 'hide').setMeta('addToHistory', false));
  }, [editor, enabled]);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const bubbleRoot = useRef<HTMLDivElement>(null);
  const dismissed = useRef(false);
  useEditorOverlayDismiss(editor, bubbleRoot, () => {
    dismissed.current = true;
    setShowColorPicker(false);
    if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta('bubbleMenu', 'hide').setMeta('addToHistory', false));
  });
  useEffect(() => {
    const resume = () => { dismissed.current = false; };
    const selection = () => { if (editor.view.hasFocus()) resume(); };
    editor.view.dom.addEventListener('pointerdown', resume);
    editor.on('focus', resume);
    editor.on('selectionUpdate', selection);
    return () => { editor.view.dom.removeEventListener('pointerdown', resume); editor.off('focus', resume); editor.off('selectionUpdate', selection); };
  }, [editor]);
  useFormattingUpdates(editor, enabled);
  const preferredPosition = useSettingsStore(state => state.settings.editor.selectionToolbarPosition ?? 'below');

  // TipTap 3.30 的 BubbleMenu 会在 shouldShow/options 引用变化时派发更新事务。
  // 选区变化期间若每次渲染都创建新对象，会形成 React → TipTap 事务 → React 的
  // 无限更新闭环（React #185）；按 editor 身份稳定所有配置引用。
  // EditorContent attaches the ProseMirror DOM during commit. Measuring during
  // render can permanently cache its detached bootstrap parent as the boundary.
  const [scrollParent, setScrollParent] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setScrollParent(findScrollContainer(editor.view.dom));
  }, [editor]);
  const shouldShow = useCallback(({
    editor: currentEditor,
    state,
  }: {
    editor: Editor;
    state: { selection: { empty: boolean } };
  }) => {
    const { selection } = state;
    if (currentEditor.isDestroyed) return false;
    if (dismissed.current || !enabledRef.current || !currentEditor.view.dom.isConnected || currentEditor.view.dom.classList.contains('nb-block-menu-open') || selection.empty || !(selection instanceof TextSelection) || isEmbeddedEditing(currentEditor)) return false;
    if (!currentEditor.view.hasFocus()) return false;
    if (!currentEditor.state.doc.textBetween(selection.from, selection.to).trim()) return false;
    // 不在代码块中显示浮层菜单
    if (currentEditor.isActive('codeBlock')) return false;
    // 跨单元格多选时不弹出行内文本气泡菜单，交由表格工具栏处理
    if (isCellSelection(selection)) return false;
    return true;
  }, []);
  const bubbleMenuOptions = useMemo(() => ({
    strategy: 'fixed' as const,
    placement: preferredPosition === 'above' ? 'top-end' as const : 'bottom-end' as const,
    offset: 8,
    flip: {
      // 以编辑器滚动容器为边界约束，顶部空间不足时翻转到文本下方。
      boundary: scrollParent ?? undefined,
      crossAxis: false,
      padding: 8,
    },
    shift: {
      // A narrow editor may be smaller than the menu; constrain to the app
      // viewport, while flip still keeps it above/below the selected text.
      rootBoundary: 'viewport' as const,
      boundary: [] as HTMLElement[],
      padding: 8,
      crossAxis: true,
    },
    // 监听编辑器真实滚动容器，滚动时即时更新定位与翻转。
    scrollTarget: scrollParent ?? undefined,
    hide: { boundary: scrollParent ?? undefined, padding: 2 },
  }), [scrollParent, preferredPosition]);

  if (!scrollParent) return null;

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="bubbleMenu"
      appendTo={editor.view.dom.ownerDocument.body}
      shouldShow={shouldShow}
      options={bubbleMenuOptions}
      style={{ zIndex: 1000 }}
    >
      {enabled && editor.state.selection instanceof TextSelection && !editor.state.selection.empty && <div
        ref={bubbleRoot} role="toolbar" aria-label="文字工具栏" data-caption-toolbar={inlineOnly || undefined}
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          maxWidth: 'calc(100vw - 16px)',
          boxSizing: 'border-box',
          alignItems: 'center',
          padding: '4px 6px',
          background: 'var(--editor-surface, #ffffff)',
          border: '1px solid var(--editor-border, rgba(0,0,0,0.12))',
          borderRadius: 8,
          boxShadow: '0 6px 20px -2px rgba(0, 0, 0, 0.12), 0 2px 6px -1px rgba(0, 0, 0, 0.08)',
          backdropFilter: 'blur(8px)',
          position: 'relative',
          gap: 2,
        }}
      >
        <BubbleButton
          title="粗体 (Ctrl+B)"
          icon={<Bold size={16} />}
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive('bold')}
        />
        <BubbleButton
          title="斜体 (Ctrl+I)"
          icon={<Italic size={16} />}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive('italic')}
        />
        <BubbleButton
          title="下划线 (Ctrl+U)"
          icon={<Underline size={16} />}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={editor.isActive('underline')}
        />
        <BubbleButton
          title="删除线 (Ctrl+Shift+X)"
          icon={<Strikethrough size={16} />}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          active={editor.isActive('strike')}
        />

        <MenuDivider />

        <BubbleButton
          title="行内代码"
          icon={<Code size={16} />}
          onClick={() => editor.chain().focus().toggleCode().run()}
          active={editor.isActive('code')}
        />

        <HighlightControl open={showColorPicker} onOpenChange={setShowColorPicker}
          onApplyStyle={pair => applyTextStyle(editor, pair)}
          textColor={editor.getAttributes('textColor').color} onTextColor={color => setTextColor(editor, color)}
          active={editor.isActive('highlight')} currentColor={editor.getAttributes('highlight').color}
          onApply={color => setHighlightColor(editor, color)}
          onReturnToEditor={() => editor.commands.focus()}
          onRemove={() => { setHighlightColor(editor, null); }}/>
        {!inlineOnly && <><AlignmentMenu editor={editor}/><AnnotationButton editor={editor}/><RichSelectionMenu editor={editor}/></>}

        <MenuDivider />

        {/* 超链接设置按钮：优先打开定制美观弹窗 */}
        <BubbleButton
          title="设置/修改超链接 (Ctrl+K)"
          icon={<Link2 size={16} />}
          onClick={() => {
            if (onOpenLinkModal) {
              onOpenLinkModal();
            } else {
              const previousUrl = editor.getAttributes('link').href || '';
              const url = window.prompt('输入链接 URL (支持网络链接或本地相对文件路径):', previousUrl);
              if (url === null) return;
              if (url === '') {
                editor.chain().focus().extendMarkRange('link').unsetLink().run();
              } else {
                editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
              }
            }
          }}
          active={editor.isActive('link')}
        />

        {editor.isActive('link') && (
          <BubbleButton
            title={`打开链接: ${editor.getAttributes('link').href || ''}`}
            icon={<ExternalLink size={15} />}
            onClick={() => {
              const href = editor.getAttributes('link').href;
              const activeKey = useWindowStore.getState().activeKey;
              if (href && activeKey) {
                handleLinkClick(href, activeKey);
              }
            }}
          />
        )}

        <BubbleButton
          title="清除格式"
          icon={<RemoveFormatting size={16} />}
          onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
        />
      </div>}
    </BubbleMenu>
  );
}

// ── 表格操作定制矢量图标 ──

/** 表头列图标 */
function HeaderColumnIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <rect x="3" y="3" width="6" height="18" fill="currentColor" fillOpacity="0.25" />
      <path d="M9 3v18" />
      <path d="M3 9h18" />
      <path d="M3 15h18" />
    </svg>
  );
}

/** 表头行图标 */
function HeaderRowIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <rect x="3" y="3" width="18" height="6" fill="currentColor" fillOpacity="0.25" />
      <path d="M3 9h18" />
      <path d="M9 3v18" />
      <path d="M15 3v18" />
    </svg>
  );
}

/** 表格浮动工具条（精美分类与方向直观区分，支持滚动实时跟随与智能避让） */
export function TableToolbar({ editor }: { editor: Editor }) {
  const nativeFeaturesVisible = useNativeFeatureVisibility();
  const toolbar = useRef<HTMLDivElement>(null);
  const refresh = useRef<() => void>(() => {});
  const [show, setShow] = useState(false);
  const dismissed = useRef(false);
  useEditorOverlayDismiss(editor, toolbar, () => { dismissed.current = true; setShow(false); });
  const [position, setPosition] = useState({ top: 0, left: 0 });
  useFormattingUpdates(editor, show);
  useLayoutEffect(() => {
    if (!toolbar.current) return;
    const observer = new ResizeObserver(() => refresh.current());
    observer.observe(toolbar.current); return () => observer.disconnect();
  }, [show]);

  useEffect(() => {
    if (!editor) return;

    const editorDom = editor.view.dom;
    const scrollParent = findScrollContainer(editorDom);

    let frame = 0;
    let lastCell: HTMLElement | null = null;
    const updateToolbar = () => {
      frame = 0;
      if (dismissed.current || editor.isDestroyed || !editorDom.isConnected || editorDom.classList.contains('nb-block-menu-open') || isEmbeddedEditing(editor)) {
        setShow(false);
        return;
      }

      const { selection } = editor.state;
      const { $from } = selection;

      // 判断是否有非空普通文本选区（此时用户正在进行划词文本格式化，隐藏表格工具栏避免遮挡）
      const cellSelecting = isCellSelection(selection);
      const hasTextSelection = !selection.empty && !cellSelecting;

      if (hasTextSelection) {
        setShow(false);
        return;
      }

      // 寻找当前 table 节点或最靠近选区的单元格 DOM
      let tableDom: HTMLElement | null = null;
      for (let d = $from.depth; d > 0; d--) {
        const node = $from.node(d);
        if (node.type.name === 'table') {
          const pos = $from.before(d);
          const dom = editor.view.nodeDOM(pos);
          if (dom instanceof HTMLElement) {
            tableDom = dom;
          }
          break;
        }
      }

      if (tableDom) {
        let anchor = tableDom;
        const selected = selection as typeof selection & { $headCell?: { pos: number } };
        if (selected.$headCell) {
          const cell = editor.view.nodeDOM(selected.$headCell.pos);
          if (lastCell && tableDom.contains(lastCell)) anchor = lastCell;
          else if (cell instanceof HTMLElement) anchor = cell;
        } else {
          for (let depth = $from.depth; depth > 0; depth--) {
            if (['cell', 'header_cell'].includes($from.node(depth).type.spec.tableRole ?? '')) {
              const cell = editor.view.nodeDOM($from.before(depth));
              if (cell instanceof HTMLElement) { anchor = cell; lastCell = cell; }
              break;
            }
          }
        }
        const rect = anchor.getBoundingClientRect();
        const containerRect = scrollParent.getBoundingClientRect();

        // 表格完全滚出编辑容器可视区域时隐藏
        if (rect.bottom < containerRect.top + 30 || rect.top > containerRect.bottom - 20) {
          setShow(false);
          return;
        }

        setShow(true);

        // 计算顶部悬浮位置：
        // 1. 若表格上方到操作栏有足够空间（>= 44px），工具条悬浮于表格上方 44px
        // 2. 若表格向上滚动且顶部已接近或滚出容器顶部，工具条吸顶在容器顶部下方安全区（containerRect.top + 8px）
        const toolbarBounds = toolbar.current?.getBoundingClientRect();
        const height = toolbarBounds?.height ?? 40;
        const halfWidth = Math.min(toolbarBounds?.width ?? 490, containerRect.width - 16) / 2;
        // Near the first rows, use the table's outer edge so the toolbar cannot
        // cover the header or the boundary the user is about to resize.
        const tableTop = tableDom.getBoundingClientRect().top;
        const useOuterEdge = rect.top - tableTop < height * 2 && tableTop - height - 28 >= containerRect.top + 6;
        const anchorTop = useOuterEdge ? tableTop : rect.top;
        const gap = useOuterEdge ? 28 : 6;
        const topPos = anchorTop - height - gap >= containerRect.top + 6
          ? anchorTop - height - gap
          : Math.min(rect.bottom + 6, containerRect.bottom - height - 6);

        // 计算水平居中位置，并施加容器边界安全约束（工具条宽约 420px，半宽约 210px，留安全边距）
        const targetLeft = rect.left + rect.width / 2;
        const clampedLeft = Math.max(
          Math.max(8, containerRect.left) + halfWidth + 8,
          Math.min(targetLeft, Math.min(window.innerWidth, containerRect.right) - halfWidth - 8)
        );

        setPosition(previous => previous.top === topPos && previous.left === clampedLeft ? previous : { top: topPos, left: clampedLeft });
      } else {
        setShow(false);
      }
    };

    const schedule = () => { if (!frame) frame = requestAnimationFrame(updateToolbar); };
    const pointerAnchor = (event: PointerEvent) => {
      dismissed.current = false;
      const cell = event.target instanceof Element ? event.target.closest<HTMLElement>('td,th') : null;
      if (cell && editorDom.contains(cell)) { lastCell = cell; schedule(); }
    };
    refresh.current = schedule;
    const resume = () => { dismissed.current = false; schedule(); };
    let embeddedEditing = isEmbeddedEditing(editor);
    const onTransaction = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.selectionSet && editor.view.hasFocus()) dismissed.current = false;
      const editing = isEmbeddedEditing(editor);
      if (transaction.docChanged || transaction.selectionSet || transaction.storedMarksSet || editing !== embeddedEditing) schedule();
      embeddedEditing = editing;
    };
    editor.on('transaction', onTransaction);
    editor.on('focus', resume);
    editorDom.addEventListener('pointerdown', pointerAnchor);
    editorDom.addEventListener('pointerup', pointerAnchor);
    scrollParent.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    window.addEventListener('scroll', schedule, { passive: true });
    schedule();

    return () => {
      cancelAnimationFrame(frame);
      editor.off('transaction', onTransaction);
      editor.off('focus', resume);
      editorDom.removeEventListener('pointerdown', pointerAnchor);
      editorDom.removeEventListener('pointerup', pointerAnchor);
      scrollParent.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule);
      refresh.current = () => {};
    };
  }, [editor]);

  if (!show) return null;
  const headers = tableHeaderState(editor);

  return (
    <div
      ref={toolbar}
      role="toolbar" aria-label="表格工具栏"
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        transform: 'translateX(-50%)',
        display: 'flex',
        flexWrap: 'wrap',
        maxWidth: 'calc(100vw - 24px)',
        alignItems: 'center',
        padding: '4px 6px',
        background: 'var(--editor-surface, #ffffff)',
        border: '1px solid var(--editor-border, rgba(0,0,0,0.12))',
        borderRadius: 8,
        boxShadow: '0 6px 20px -2px rgba(0, 0, 0, 0.14), 0 2px 6px -1px rgba(0, 0, 0, 0.08)',
        backdropFilter: 'blur(8px)',
        zIndex: 1000,
        gap: 2,
        userSelect: 'none',
        transition: 'opacity 120ms ease',
      }}
    >
      <AlignmentMenu editor={editor}/>
      <TableFillMenu editor={editor} disabled={documentTableStyle(editor.state.doc) === 'three-line'}/>
      <MenuDivider />
      {nativeFeaturesVisible && tableDistributionState(editor).columns && <BubbleButton title="平均分布列宽" icon={<Columns3 size={16}/>} onClick={() => distributeTableColumns(editor)}/>}
      {nativeFeaturesVisible && tableDistributionState(editor).rows && <BubbleButton title="平均分布行高" icon={<Rows3 size={16}/>} onClick={() => distributeTableRows(editor)}/>}
      {nativeFeaturesVisible && isCellSelection(editor.state.selection) && editor.can().mergeCells() && <BubbleButton
        title="合并选中单元格" icon={<Merge size={16}/>}
        onClick={() => runWithDocumentCapability(editor, 'tableMerge', next => runDiscreteEdit(next, chain => chain.mergeCells()))}/>}
      {editor.can().splitCell() && <BubbleButton
        title="拆分合并单元格" icon={<Split size={16}/>}
        onClick={() => runDiscreteEdit(editor, chain => chain.splitCell())}/>}
      <MenuDivider />
      {headers?.canRow && <BubbleButton
        title={headers.rowHeader ? '取消表头行' : '首行设为表头'}
        icon={<HeaderRowIcon />}
        active={headers.rowHeader}
        onClick={() => setSelectedTableHeader(editor, 'row')}
      />}
      {nativeFeaturesVisible && headers?.canColumn && <BubbleButton
        title={headers.columnHeader ? '取消表头列' : '首列设为表头'}
        icon={<HeaderColumnIcon />}
        active={headers.columnHeader}
        onClick={() => setSelectedTableHeader(editor, 'column')}
      />}
      <TableInsertMenu editor={editor}/>
      <TableAppearanceMenu editor={editor}/>

      <MenuDivider />

      {/* ── 删除表格 ── */}
      <BubbleButton
        title={({ table: '删除整个表格', row: '删除选中行', column: '删除选中列', cells: '清空选中单元格' })[tableDeleteScope(editor)]}
        icon={<Trash2 size={16} />}
        onClick={() => deleteTableSelection(editor)}
        danger
      />
    </div>
  );
}
