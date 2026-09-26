// NoteBoard 块拖拽把手
// 智能跟随鼠标悬停，并通过 Pointer Events 与 Tauri 系统文件拖放安全共存
// 详见 docs/09-开发路线图.md 8.10

import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { type Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import {
  findTopLevelBlockElement,
  getTopLevelBlockInfo,
  isTopLevelBlockMoveAllowed,
  moveTopLevelBlock,
  resolveTopLevelDropTarget,
  type TopLevelDropTarget,
} from './blockReorder';
import * as Popover from '@radix-ui/react-popover';
import { useHoverMenu, HoverMenuContext } from '../../components/useHoverMenu';
import { BlockContextMenu, BlockTypeIcon } from './BlockContextMenu';
import { selectBlock } from './blockActions';
import { foldedSectionEnd } from './headingFolding';
import { blockHandlePosition, editorContentLeft } from './blockHandleGeometry';
import { markHeadingHandleTarget } from './headingHandleMarker';
import { BlockRangeFeedback } from './BlockRangeFeedback';
import { Plus } from 'lucide-react';
import { isEmptyParagraph } from './blockInteractionScope';

/** 超过此位移才进入拖动，避免单击把手时误触排序。 */
const DRAG_START_DISTANCE = 4;
/** 靠近滚动视口上下边缘时的自动滚动热区。 */
const AUTO_SCROLL_EDGE = 56;
/** 单次指针事件允许的最大滚动距离，兼顾长文档速度与落点稳定性。 */
const AUTO_SCROLL_MAX_STEP = 14;
/** 落位动画时长需与 globals.css 中的 nb-block-drag-settle 保持一致。 */
const DROP_SETTLE_DURATION = 320;
/** 跟随提示与指针、视口边缘的安全间距，以及用于防止提示溢出的保守尺寸。 */
const DRAG_PREVIEW_OFFSET = 14;
const DRAG_PREVIEW_VIEWPORT_GAP = 8;
const DRAG_PREVIEW_SAFE_WIDTH = 244;
const DRAG_PREVIEW_SAFE_HEIGHT = 64;

/** 常见 Markdown 顶层节点的人类可读名称，用于拖动预览提示。 */
const BLOCK_TYPE_LABELS: Record<string, string> = {
  paragraph: '段落',
  heading: '标题',
  bulletList: '无序列表',
  orderedList: '有序列表',
  taskList: '任务列表',
  listItem: '列表项',
  taskItem: '任务项',
  blockquote: '引用块',
  table: '表格',
  codeBlock: '代码块',
  horizontalRule: '分隔线',
  image: '图片',
  imageCollection: '图片组合',
  disclosure: '折叠块',
  mermaidBlock: 'Mermaid 图表',
  mathBlock: '公式块',
  githubAlert: '提示块',
};

interface DragHandleState {
  visible: boolean;
  top: number;
  left: number;
  nodePos: number | null;
  nodeType: string | null;
  empty: boolean;
}

interface DragFeedbackState {
  clientX: number;
  clientY: number;
  valid: boolean;
  message: string;
  indicatorTop: number | null;
  indicatorLeft: number;
  indicatorWidth: number;
}

interface DragSession {
  pointerId: number;
  startX: number;
  startY: number;
  sourcePos: number;
  sourceElement: HTMLElement;
  scrollParent: HTMLElement;
  dragging: boolean;
  originalBodyCursor: string;
  originalBodyUserSelect: string;
}

/** 从编辑器向外查找真正承载滚动的可视化模式容器。 */
function findScrollParent(editorDom: HTMLElement): HTMLElement {
  let current = editorDom.parentElement;

  while (current) {
    const { overflowY } = window.getComputedStyle(current);
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
      return current;
    }
    current = current.parentElement;
  }

  return editorDom.parentElement ?? editorDom;
}

function getBlockTypeLabel(nodeType: string | null): string {
  if (!nodeType) return '内容块';
  return BLOCK_TYPE_LABELS[nodeType] ?? '内容块';
}

/** 将跟随提示限制在当前视口内，窗口较小时也不会遮到屏幕外。 */
function clampPreviewCoordinate(value: number, viewportSize: number, reservedSize: number): number {
  const max = Math.max(DRAG_PREVIEW_VIEWPORT_GAP, viewportSize - reservedSize);
  return Math.max(DRAG_PREVIEW_VIEWPORT_GAP, Math.min(value, max));
}

export function BlockDragHandle({ editor }: { editor: Editor | null }) {
  const [state, setState] = useState<DragHandleState>({
    visible: false,
    top: 0,
    left: 0,
    nodePos: null,
    nodeType: null,
    empty: false,
  });
  const [isHoveringHandle, setIsHoveringHandle] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragFeedback, setDragFeedback] = useState<DragFeedbackState | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const isHoveringHandleRef = useRef(false);
  const dragSessionRef = useRef<DragSession | null>(null);
  const dropTargetRef = useRef<TopLevelDropTarget | null>(null);
  const dragFrame = useRef(0);
  const dragPoint = useRef({ x: 0, y: 0 });
  const suppressMenuClick = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuOpenRef = useRef(false); menuOpenRef.current = menuOpen;
  const refreshHoverRef = useRef<(() => void) | null>(null);
  const menuHover = useHoverMenu(menuOpen, open => {
    if (open && (!editor || !state.visible || state.nodePos === null || dragSessionRef.current?.dragging)) return;
    editor?.view.dom.classList.toggle('nb-block-menu-open', open);
    menuOpenRef.current = open;
    if (open) {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
      selectBlock(editor!, state.nodePos!);
      editor!.view.dispatch(editor!.state.tr.setMeta('bubbleMenu', 'hide'));
    }
    setMenuOpen(open);
    if (!open) refreshHoverRef.current?.();
  });
  useEffect(() => () => { editor?.view.dom.classList.remove('nb-block-menu-open'); }, [editor]);
  useLayoutEffect(() => {
    if (!editor || !state.visible || state.nodeType !== 'heading' || state.nodePos === null) return;
    return markHeadingHandleTarget(editor, state.nodePos);
  }, [editor, state.visible, state.nodeType, state.nodePos]);

  const clearHideTimer = useCallback(() => {
    if (!hideTimerRef.current) return;
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
  }, []);

  /** 清理指针捕获、全局光标和源块临时样式；取消与成功落下共用同一出口。 */
  const cleanupDrag = useCallback((updateReactState = true) => {
    cancelAnimationFrame(dragFrame.current); dragFrame.current = 0;
    const session = dragSessionRef.current;
    dragSessionRef.current = null;
    dropTargetRef.current = null;

    if (session) {
      session.sourceElement.classList.remove(
        'nb-block-drag-source',
        'nb-block-drag-source-invalid',
      );
      document.body.style.cursor = session.originalBodyCursor;
      document.body.style.userSelect = session.originalBodyUserSelect;

      const handle = handleRef.current;
      if (handle?.hasPointerCapture(session.pointerId)) {
        handle.releasePointerCapture(session.pointerId);
      }
    }

    if (updateReactState) {
      isHoveringHandleRef.current = false;
      setIsHoveringHandle(false);
      setIsDragging(false);
      setDragFeedback(null);
    }
  }, []);

  // 监听编辑器区域 mousemove，动态计算鼠标所在的顶层块和把手坐标。
  useEffect(() => {
    if (!editor) return;
    const editorDom = editor.view.dom;
    const scrollParent = findScrollParent(editorDom);

    const scheduleHide = () => {
      if (hideTimerRef.current || dragSessionRef.current || menuOpenRef.current) return;
      hideTimerRef.current = setTimeout(() => {
        hideTimerRef.current = null;
        if (!isHoveringHandleRef.current && !dragSessionRef.current && !menuOpenRef.current) {
          setState((current) => ({ ...current, visible: false }));
        }
      }, 300);
    };

    let hoverFrame = 0;
    let pointer = { x: 0, y: 0 };
    let hoveredCollection: HTMLElement | null = null;
    const updateHover = () => {
      hoverFrame = 0;
      if (hoveredCollection && !hoveredCollection.isConnected) hoveredCollection = null;
      if (dragSessionRef.current || menuOpenRef.current) return;
      if (editorDom.classList.contains('nb-table-resizing')) {
        setState(current => current.visible ? { ...current, visible: false } : current);
        return;
      }

      // 把手是编辑器的兄弟节点；进入把手后保持当前源块，不再按坐标重算。
      let targetElement = document.elementFromPoint(pointer.x, pointer.y);
      if (targetElement && handleRef.current?.contains(targetElement)) {
        clearHideTimer();
        return;
      }
      // A scroll can unmount the hovered handle before React receives leave.
      // The next real pointer hit must not carry that hover onto another block.
      if (isHoveringHandleRef.current) {
        isHoveringHandleRef.current = false;
        setIsHoveringHandle(false);
      }

      if (targetElement === editorDom) {
        // The control lane is padding, not a document node. Probe the content edge
        // at the same y without walking every block (including large tables).
        const left = editorContentLeft(editor.view);
        if (pointer.x < left) targetElement = document.elementFromPoint(left + 2, pointer.y);
        // Resized collections can leave a wide blank corridor before their
        // fixed gutter control. Keep the current block while crossing it.
        if (targetElement === editorDom && hoveredCollection?.isConnected) {
          const rect = hoveredCollection.getBoundingClientRect();
          if (pointer.x < rect.left && pointer.y >= rect.top && pointer.y <= rect.bottom) targetElement = hoveredCollection;
        }
      }
      if (!targetElement || !editorDom.contains(targetElement)) {
        scheduleHide();
        return;
      }

      clearHideTimer();
      const blockElement = findTopLevelBlockElement(editorDom, targetElement);
      if (!blockElement) { scheduleHide(); return; }

      const blockInfo = getTopLevelBlockInfo(editor.view, blockElement);
      if (!blockInfo) { scheduleHide(); return; }
      hoveredCollection = blockInfo.node.type.name === 'imageCollection' ? blockElement : null;

      const empty = isEmptyParagraph(blockInfo.node);
      const { top, left } = blockHandlePosition(editor.view, blockInfo, scrollParent, empty ? 30 : 50, handleRef.current?.offsetHeight || 30);

      setState(current => current.visible && current.nodePos === blockInfo.pos && current.top === top && current.left === Math.max(left, 4) && current.empty === empty ? current : ({
        visible: true,
        top,
        left: Math.max(left, 4),
        nodePos: blockInfo.pos,
        nodeType: blockInfo.node.type.name,
        empty,
      }));
    };
    const handleMouseMove = (event: MouseEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
      if (!hoverFrame) hoverFrame = requestAnimationFrame(updateHover);
    };
    const refreshHover = () => { if (!hoverFrame) hoverFrame = requestAnimationFrame(updateHover); };
    refreshHoverRef.current = refreshHover;
    const handleDocumentChange = ({ transaction }: { transaction: Transaction }) => {
      if (!transaction.docChanged) return;
      setState(current => {
        if (!current.visible || current.nodePos === null) return current;
        const mapped = transaction.mapping.mapResult(current.nodePos, 1);
        if (mapped.deletedAcross || mapped.pos >= transaction.doc.content.size) return { ...current, visible: false };
        const node = transaction.doc.nodeAt(mapped.pos);
        if (!node?.isBlock) return { ...current, visible: false };
        const empty = isEmptyParagraph(node);
        return mapped.pos === current.nodePos && node.type.name === current.nodeType && empty === current.empty ? current : { ...current, nodePos: mapped.pos, nodeType: node.type.name, empty };
      });
      refreshHover();
    };

    const handleMouseLeave = () => {
      if (!isHoveringHandleRef.current) scheduleHide();
    };

    const handleScroll = () => {
      // 普通滚动时隐藏旧坐标把手；拖动过程由指针坐标持续刷新落点，不受这里影响。
      if (!dragSessionRef.current && !menuOpenRef.current) {
        setState((current) => ({ ...current, visible: false }));
      }
    };

    scrollParent.addEventListener('mousemove', handleMouseMove);
    scrollParent.addEventListener('mouseleave', handleMouseLeave);
    scrollParent.addEventListener('scroll', handleScroll, { passive: true });
    editor.on('transaction', handleDocumentChange);

    return () => {
      scrollParent.removeEventListener('mousemove', handleMouseMove);
      if (refreshHoverRef.current === refreshHover) refreshHoverRef.current = null;
      scrollParent.removeEventListener('mouseleave', handleMouseLeave);
      scrollParent.removeEventListener('scroll', handleScroll);
      editor.off('transaction', handleDocumentChange);
      cancelAnimationFrame(hoverFrame);
      clearHideTimer();
    };
  }, [clearHideTimer, editor]);

  // 窗口失焦、按 Esc 或组件卸载时必须取消拖动，避免残留抓取光标和半透明源块。
  useEffect(() => {
    const handleWindowBlur = () => cleanupDrag();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !dragSessionRef.current) return;
      event.preventDefault();
      cleanupDrag();
      setState((current) => ({ ...current, visible: false }));
    };

    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('keydown', handleKeyDown);
      cleanupDrag(false);
    };
  }, [cleanupDrag]);

  /** 根据最新指针坐标自动滚动、解析合法落点并同步视觉反馈。 */
  const updateDragFeedback = useCallback((clientX: number, clientY: number) => {
    const session = dragSessionRef.current;
    if (!editor || !session?.dragging) return;

    const { scrollParent } = session;
    const scrollRect = scrollParent.getBoundingClientRect();

    // 长文档边缘自动滚动；滚动后重新读取布局，保证指示线紧贴真实文档边界。
    if (clientY < scrollRect.top + AUTO_SCROLL_EDGE) {
      const ratio = Math.min(1, (scrollRect.top + AUTO_SCROLL_EDGE - clientY) / AUTO_SCROLL_EDGE);
      scrollParent.scrollTop -= Math.ceil(AUTO_SCROLL_MAX_STEP * ratio);
    } else if (clientY > scrollRect.bottom - AUTO_SCROLL_EDGE) {
      const ratio = Math.min(1, (clientY - scrollRect.bottom + AUTO_SCROLL_EDGE) / AUTO_SCROLL_EDGE);
      scrollParent.scrollTop += Math.ceil(AUTO_SCROLL_MAX_STEP * ratio);
    }

    const isInsideViewport = clientX >= scrollRect.left
      && clientX <= scrollRect.right
      && clientY >= scrollRect.top
      && clientY <= scrollRect.bottom;

    if (!isInsideViewport) {
      dropTargetRef.current = null;
      session.sourceElement.classList.remove('nb-block-drag-source-invalid');
      setDragFeedback({
        clientX,
        clientY,
        valid: false,
        message: '移回编辑区后释放',
        indicatorTop: null,
        indicatorLeft: 0,
        indicatorWidth: 0,
      });
      return;
    }

    const target = resolveTopLevelDropTarget(editor.view, clientY, session.sourcePos);
    const valid = Boolean(
      target
      && isTopLevelBlockMoveAllowed(editor.state.doc, session.sourcePos, target.insertPos, foldedSectionEnd(editor.state, session.sourcePos)),
    );

    dropTargetRef.current = valid ? target : null;
    const isOverSource = target?.targetPos === session.sourcePos;
    session.sourceElement.classList.toggle('nb-block-drag-source-invalid', !valid && isOverSource);

    let message = '请放在同一内容区域的块之间';
    if (valid) {
      message = '释放到指示线位置';
    } else if (isOverSource) {
      message = '不能放入自身内部';
    } else if (target) {
      message = '内容已在此位置';
    }

    const scope = session.sourceElement.closest('.nb-disclosure-body');
    const editorRect = (scope ?? editor.view.dom).getBoundingClientRect();
    setDragFeedback({
      clientX,
      clientY,
      valid,
      message,
      indicatorTop: valid && target
        ? target.indicatorClientY - scrollRect.top + scrollParent.scrollTop
        : null,
      indicatorLeft: editorRect.left - scrollRect.left + scrollParent.scrollLeft,
      indicatorWidth: editorRect.width,
    });
  }, [editor]);

  /** 指针按下只建立候选会话；超过阈值后才进入真正拖动。 */
  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!editor || state.nodePos === null || event.button !== 0) return;

    const sourceNode = editor.state.doc.nodeAt(state.nodePos);
    const sourceDom = editor.view.nodeDOM(state.nodePos);
    const sourceElement = findTopLevelBlockElement(editor.view.dom, sourceDom);
    if (!sourceNode || !sourceElement) return;

    event.preventDefault();
    event.stopPropagation();
    clearHideTimer();
    event.currentTarget.setPointerCapture(event.pointerId);

    dragSessionRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      sourcePos: state.nodePos,
      sourceElement,
      scrollParent: findScrollParent(editor.view.dom),
      dragging: false,
      originalBodyCursor: document.body.style.cursor,
      originalBodyUserSelect: document.body.style.userSelect,
    };
  }, [clearHideTimer, editor, state.nodePos]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();

    if (!session.dragging) {
      const distance = Math.hypot(
        event.clientX - session.startX,
        event.clientY - session.startY,
      );
      if (distance < DRAG_START_DISTANCE) return;

      session.dragging = true;
      menuHover.change(false);
      session.sourceElement.classList.add('nb-block-drag-source');
      document.body.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
      setIsDragging(true);
    }

    dragPoint.current = { x: event.clientX, y: event.clientY };
    if (!dragFrame.current) dragFrame.current = requestAnimationFrame(() => {
      dragFrame.current = 0;
      updateDragFeedback(dragPoint.current.x, dragPoint.current.y);
    });
  }, [updateDragFeedback]);

  /** 指针释放时只使用最后一个通过校验的顶层边界，并由事务内核再次校验。 */
  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();

    if (!session.dragging) {
      cleanupDrag();
      menuHover.change(true);
      return;
    }
    cancelAnimationFrame(dragFrame.current); dragFrame.current = 0;
    updateDragFeedback(event.clientX, event.clientY);
    const target = dropTargetRef.current;
    suppressMenuClick.current = session.dragging;
    const result = session.dragging && target && editor
      ? moveTopLevelBlock(editor.view, session.sourcePos, target.insertPos)
      : null;

    cleanupDrag();
    setState((current) => ({ ...current, visible: false }));

    if (result && editor) {
      // DOM 事务落位后短暂强调目标块，让用户能快速确认移动结果。
      requestAnimationFrame(() => {
        const movedDom = editor.view.nodeDOM(result.insertedPos);
        const movedElement = findTopLevelBlockElement(editor.view.dom, movedDom);
        if (!movedElement) return;
        movedElement.classList.add('nb-block-drag-settle');
        window.setTimeout(() => {
          movedElement.classList.remove('nb-block-drag-settle');
        }, DROP_SETTLE_DURATION);
      });
    }
  }, [cleanupDrag, editor, menuHover, updateDragFeedback]);

  const handlePointerCancel = useCallback(() => {
    cleanupDrag();
    setState((current) => ({ ...current, visible: false }));
  }, [cleanupDrag]);

  if (!state.visible) return null;

  const blockLabel = getBlockTypeLabel(state.nodeType);
  const previewLeft = dragFeedback
    ? clampPreviewCoordinate(
        dragFeedback.clientX + DRAG_PREVIEW_OFFSET,
        window.innerWidth,
        DRAG_PREVIEW_SAFE_WIDTH,
      )
    : 0;
  const previewTop = dragFeedback
    ? clampPreviewCoordinate(
        dragFeedback.clientY + DRAG_PREVIEW_OFFSET,
        window.innerHeight,
        DRAG_PREVIEW_SAFE_HEIGHT,
      )
    : 0;

  return (
    <>
      {editor && state.nodePos !== null && !isDragging && (isHoveringHandle || menuOpen) && <BlockRangeFeedback editor={editor} pos={state.nodePos}/>}
      <Popover.Root open={menuOpen && !isDragging} onOpenChange={menuHover.change}>
      <Popover.Anchor asChild>
        <button
          ref={handleRef}
          type="button"
          className={`nb-block-drag-handle nb-block-with-menu${state.empty ? ' nb-empty-block-handle' : ''}${isHoveringHandle ? ' is-hovered' : ''}${isDragging ? ' is-dragging' : ''}`}
          onPointerEnter={menuHover.enter}
          onPointerLeave={menuHover.leave}
          onClick={() => { if (suppressMenuClick.current) { suppressMenuClick.current = false; return; } if (!isDragging) menuHover.change(true); }}
          onKeyDown={menuHover.triggerProps.onKeyDown}
          aria-haspopup="menu" aria-expanded={menuOpen}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onLostPointerCapture={() => {
            if (dragSessionRef.current) cleanupDrag();
          }}
          onMouseEnter={() => {
            isHoveringHandleRef.current = true;
            setIsHoveringHandle(true);
            clearHideTimer();
          }}
          onMouseLeave={() => {
            isHoveringHandleRef.current = false;
            if (!dragSessionRef.current) setIsHoveringHandle(false);
          }}
          style={{
            top: state.top + 2,
            left: state.left,
          }}
          aria-label={state.empty ? '添加内容' : `拖动${blockLabel}`}
        >
          {state.empty ? <Plus size={18} aria-hidden="true"/> : <><BlockTypeIcon type={state.nodeType} level={state.nodePos === null ? undefined : editor?.state.doc.nodeAt(state.nodePos)?.attrs.level}/><span aria-hidden="true">⠿</span></>}
        </button>
      </Popover.Anchor>
      <Popover.Portal><Popover.Content {...menuHover.contentProps} className="nb-block-menu-popover" side="left" align="start" sideOffset={5} collisionPadding={10}
        onOpenAutoFocus={menuHover.onOpenAutoFocus} onCloseAutoFocus={menuHover.onCloseAutoFocus}
        onInteractOutside={event => {
          menuHover.contentProps.onInteractOutside(event);
          const target = event.detail.originalEvent.target;
          if (target instanceof Element && target.closest('[data-nb-editor-menu]')) event.preventDefault();
        }}>
        <HoverMenuContext.Provider value={menuHover}>{editor && state.nodePos !== null && <BlockContextMenu editor={editor} pos={state.nodePos} close={() => menuHover.change(false)}/>}</HoverMenuContext.Provider>
      </Popover.Content></Popover.Portal></Popover.Root>

      {dragFeedback?.valid && dragFeedback.indicatorTop !== null && (
        <div
          className="nb-block-drop-indicator"
          style={{
            top: dragFeedback.indicatorTop,
            left: dragFeedback.indicatorLeft,
            width: dragFeedback.indicatorWidth,
          }}
          aria-hidden="true"
        />
      )}

      {dragFeedback && (
        <div
          className={`nb-block-drag-preview${dragFeedback.valid ? '' : ' is-invalid'}`}
          style={{
            left: previewLeft,
            top: previewTop,
          }}
          aria-hidden="true"
        >
          <span className="nb-block-drag-preview-icon">
            {dragFeedback.valid ? '↕' : '⊘'}
          </span>
          <span className="nb-block-drag-preview-copy">
            <strong>移动{blockLabel}</strong>
            <span>{dragFeedback.message}</span>
          </span>
        </div>
      )}
    </>
  );
}
