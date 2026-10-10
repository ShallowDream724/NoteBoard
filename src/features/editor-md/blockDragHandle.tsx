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
import type { EditorView } from '@tiptap/pm/view';
import {
  findTopLevelBlockElement,
  getTopLevelBlockInfo,
  isTopLevelBlockMoveAllowed,
  moveTopLevelBlock,
  resolveTopLevelDropTarget,
  releaseBlockDropIndex,
  type TopLevelDropTarget,
} from './blockReorder';
import * as Popover from '@radix-ui/react-popover';
import { useHoverMenu, HoverMenuContext } from '../../components/useHoverMenu';
import { BlockContextMenu, BlockTypeIcon } from './BlockContextMenu';
import { resolveBlockSelection, type BlockSelection } from './blockSelection';
import { BlockSelectionMenu } from './BlockSelectionMenu';
import { prepareBlockSelectionMove, isBlockSelectionMoveAllowed, moveBlockSelection, type BlockSelectionMovePlan } from './blockSelectionMove';
import { foldedSectionEnd } from './headingFolding';
import { blockHandlePosition, editorContentLeft } from './blockHandleGeometry';
import { markHeadingHandleTarget } from './headingHandleMarker';
import { BlockRangeFeedback } from './BlockRangeFeedback';
import { Plus, Rows3 } from 'lucide-react';
import { isEmptyParagraph } from './blockInteractionScope';
import { createDragEdgeScroller, type DragEdgeScroller } from './dragEdgeScroll';
import { releaseListMarkerGeometry } from './listMarkerGeometry';
import { beginEditorDrag, isEditorDragging } from './editorDragActivity';
import { EDITOR_MENU_PREVIEW_META, mapMenuTarget } from './menuPreview';

/** 超过此位移才进入拖动，避免单击把手时误触排序。 */
const DRAG_START_DISTANCE = 4;
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
  taskList: '待办',
  listItem: '列表项',
  taskItem: '待办项',
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
  width: number;
  selection: BlockSelection | null;
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

function sameDragFeedback(a: DragFeedbackState | null, b: DragFeedbackState): boolean {
  return !!a && a.clientX === b.clientX && a.clientY === b.clientY
    && a.valid === b.valid && a.message === b.message
    && a.indicatorTop === b.indicatorTop && a.indicatorLeft === b.indicatorLeft
    && a.indicatorWidth === b.indicatorWidth;
}

interface DragSession {
  view: EditorView;
  pointerId: number;
  startX: number;
  startY: number;
  sourcePos: number;
  sourceElement: HTMLElement;
  selectionPlan: BlockSelectionMovePlan | null;
  scrollParent: HTMLElement;
  dragging: boolean;
  originalBodyCursor: string;
  originalBodyUserSelect: string;
  endActivity?: () => void;
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
    width: 50,
    selection: null,
  });
  const [isHoveringHandle, setIsHoveringHandle] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragFeedback, setDragFeedback] = useState<DragFeedbackState | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const isHoveringHandleRef = useRef(false);
  const dragSessionRef = useRef<DragSession | null>(null);
  const dropTargetRef = useRef<TopLevelDropTarget | null>(null);
  const dragScrollerRef = useRef<DragEdgeScroller | null>(null);
  const dragPoint = useRef({ x: 0, y: 0 });
  const suppressMenuClick = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [textSelecting, setTextSelecting] = useState(false);
  const selectionGestureRef = useRef(false);
  const selectionRef = useRef<BlockSelection | null>(null);
  const menuOpenRef = useRef(false); menuOpenRef.current = menuOpen;
  const refreshHoverRef = useRef<(() => void) | null>(null);
  const menuHover = useHoverMenu(menuOpen, open => {
    if (open && (!editor || !state.visible || state.nodePos === null || selectionGestureRef.current || dragSessionRef.current || isEditorDragging(editor.view))) return;
    editor?.view.dom.classList.toggle('nb-block-menu-open', open);
    menuOpenRef.current = open;
    if (open) {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
      editor!.view.dispatch(editor!.state.tr.setMeta('bubbleMenu', 'hide'));
    }
    setMenuOpen(open);
    if (!open) refreshHoverRef.current?.();
  });
  const menuControllerRef = useRef(menuHover); menuControllerRef.current = menuHover;
  useEffect(() => () => { if (editor) { editor.view.dom.classList.remove('nb-block-menu-open'); releaseListMarkerGeometry(editor.view); } }, [editor]);
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
    dragScrollerRef.current?.stop(); dragScrollerRef.current = null;
    const session = dragSessionRef.current;
    dragSessionRef.current = null;
    dropTargetRef.current = null;

    if (session) {
      session.endActivity?.();
      releaseBlockDropIndex(session.view);
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
    selectionRef.current = resolveBlockSelection(editor.state);

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
    let selectionChanged = false;
    let pointer = { x: 0, y: 0 };
    let hoveredCollection: HTMLElement | null = null;
    const updateHover = () => {
      hoverFrame = 0;
      if (hoveredCollection && !hoveredCollection.isConnected) hoveredCollection = null;
      if (dragSessionRef.current || menuOpenRef.current) return;
      if (isEditorDragging(editor.view)) {
        setState(current => current.visible ? { ...current, visible: false } : current);
        return;
      }

      // 把手是编辑器的兄弟节点；进入把手后保持当前源块，不再按坐标重算。
      let targetElement = document.elementFromPoint(pointer.x, pointer.y);
      if (targetElement && handleRef.current?.contains(targetElement)) {
        clearHideTimer();
        if (!selectionChanged) return;
        targetElement = document.elementFromPoint(editorContentLeft(editor.view) + 2, pointer.y);
      }
      selectionChanged = false;
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
      const selection = selectionRef.current;
      const blockElement = selection
        ? findTopLevelBlockElement(editorDom, editor.view.nodeDOM(selection.firstPos))
        : findTopLevelBlockElement(editorDom, targetElement, pointer.y);
      if (!blockElement) { scheduleHide(); return; }

      const blockInfo = getTopLevelBlockInfo(editor.view, blockElement);
      if (!blockInfo) { scheduleHide(); return; }
      hoveredCollection = blockInfo.node.type.name === 'imageCollection' ? blockElement : null;

      const empty = isEmptyParagraph(blockInfo.node);
      // Read the same container policy as CSS, including transitions between
      // empty/nonempty blocks; the previous handle's measured width can be stale.
      const width = empty ? 30 : parseFloat(getComputedStyle(editorDom).getPropertyValue('--document-block-handle-width')) || 50;
      const { top, left, width: fittedWidth } = blockHandlePosition(editor.view, blockInfo, scrollParent, width, handleRef.current?.offsetHeight || 30);

      setState(current => current.visible && current.nodePos === blockInfo.pos && current.top === top && current.left === Math.max(left, 4) && current.empty === empty && current.width === fittedWidth && current.selection === selection ? current : ({
        visible: true,
        top,
        left: Math.max(left, 4),
        nodePos: blockInfo.pos,
        nodeType: blockInfo.node.type.name,
        empty,
        width: fittedWidth,
        selection,
      }));
    };
    const handleMouseMove = (event: MouseEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
      if (!hoverFrame) hoverFrame = requestAnimationFrame(updateHover);
    };
    const refreshHover = () => { if (!hoverFrame) hoverFrame = requestAnimationFrame(updateHover); };
    refreshHoverRef.current = refreshHover;
    const handleDocumentChange = ({ transaction }: { transaction: Transaction }) => {
      const menuPreview = menuOpenRef.current && !!transaction.getMeta(EDITOR_MENU_PREVIEW_META);
      if (transaction.docChanged || transaction.selectionSet) {
        const previousSelection = selectionRef.current;
        selectionRef.current = resolveBlockSelection(editor.state);
        if (transaction.selectionSet) {
          selectionChanged = true;
          if (!menuPreview && previousSelection && !previousSelection.selection.eq(editor.state.selection)) menuControllerRef.current.change(false);
          setState(current => current.selection === selectionRef.current ? current : { ...current, selection: selectionRef.current });
        }
        refreshHover();
      }
      if (!transaction.docChanged) return;
      // A replaced/undone target must never leave an invisible open popover
      // blocking all future hit tests. A menu owns no persistent model selection.
      if (!menuPreview) {
        menuControllerRef.current.change(false);
        isHoveringHandleRef.current = false;
        setIsHoveringHandle(false);
      }
      // Drop coordinates belong to the document captured on pointer-down. A
      // concurrent edit/undo cancels the gesture rather than moving a new node.
      if (dragSessionRef.current) {
        cleanupDrag();
        setState(current => ({ ...current, visible: false }));
        refreshHover();
        return;
      }
      setState(current => {
        if (!current.visible || current.nodePos === null) return current.selection ? { ...current, selection: null } : current;
        const pos = mapMenuTarget(transaction, current.nodePos);
        if (pos === null || pos >= transaction.doc.content.size) return { ...current, visible: false, selection: null };
        const node = transaction.doc.nodeAt(pos);
        if (!node?.isBlock) return { ...current, visible: false, selection: null };
        const empty = isEmptyParagraph(node);
        return { ...current, nodePos: pos, nodeType: node.type.name, empty, selection: menuPreview ? selectionRef.current : null };
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
    const pointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Node) || !editorDom.contains(event.target)) return;
      selectionGestureRef.current = true;
      setTextSelecting(true);
      menuControllerRef.current.change(false);
    };
    const pointerEnd = () => {
      if (!selectionGestureRef.current) return;
      selectionGestureRef.current = false;
      setTextSelecting(false);
      refreshHover();
    };

    scrollParent.addEventListener('mousemove', handleMouseMove);
    scrollParent.addEventListener('mouseleave', handleMouseLeave);
    scrollParent.addEventListener('scroll', handleScroll, { passive: true });
    editor.on('transaction', handleDocumentChange);
    document.addEventListener('pointerdown', pointerDown, true);
    document.addEventListener('pointerup', pointerEnd, true);
    document.addEventListener('pointercancel', pointerEnd, true);
    window.addEventListener('blur', pointerEnd);

    return () => {
      scrollParent.removeEventListener('mousemove', handleMouseMove);
      if (refreshHoverRef.current === refreshHover) refreshHoverRef.current = null;
      scrollParent.removeEventListener('mouseleave', handleMouseLeave);
      scrollParent.removeEventListener('scroll', handleScroll);
      editor.off('transaction', handleDocumentChange);
      document.removeEventListener('pointerdown', pointerDown, true);
      document.removeEventListener('pointerup', pointerEnd, true);
      document.removeEventListener('pointercancel', pointerEnd, true);
      window.removeEventListener('blur', pointerEnd);
      selectionGestureRef.current = false;
      menuControllerRef.current.change(false);
      cancelAnimationFrame(hoverFrame);
      clearHideTimer();
    };
  }, [clearHideTimer, cleanupDrag, editor]);

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

  /** 根据最新指针坐标解析合法落点并同步视觉反馈。 */
  const updateDragFeedback = useCallback((clientX: number, clientY: number) => {
    const session = dragSessionRef.current;
    if (!editor || !session?.dragging) return;

    const { scrollParent } = session;
    const scrollRect = scrollParent.getBoundingClientRect();

    const isInsideViewport = clientX >= scrollRect.left
      && clientX <= scrollRect.right
      && clientY >= scrollRect.top
      && clientY <= scrollRect.bottom;

    if (!isInsideViewport) {
      dropTargetRef.current = null;
      const feedback: DragFeedbackState = {
        clientX,
        clientY,
        valid: false,
        message: '移回编辑区后释放',
        indicatorTop: null,
        indicatorLeft: 0,
        indicatorWidth: 0,
      };
      setDragFeedback(current => sameDragFeedback(current, feedback) ? current : feedback);
      return;
    }

    const target = resolveTopLevelDropTarget(editor.view, clientY, session.sourcePos);
    const valid = Boolean(
      target
      && (session.selectionPlan ? isBlockSelectionMoveAllowed(session.selectionPlan, target.insertPos)
        : isTopLevelBlockMoveAllowed(editor.state.doc, session.sourcePos, target.insertPos, foldedSectionEnd(editor.state, session.sourcePos))),
    );

    dropTargetRef.current = valid ? target : null;
    const isOverSource = !!target && (session.selectionPlan
      ? target.insertPos >= session.selectionPlan.effectiveFrom && target.insertPos <= session.selectionPlan.effectiveTo
      : target.targetPos === session.sourcePos);

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
    const feedback: DragFeedbackState = {
      clientX,
      clientY,
      valid,
      message,
      indicatorTop: valid && target
        ? target.indicatorClientY - scrollRect.top + scrollParent.scrollTop
        : null,
      indicatorLeft: editorRect.left - scrollRect.left + scrollParent.scrollLeft,
      indicatorWidth: editorRect.width,
    };
    setDragFeedback(current => sameDragFeedback(current, feedback) ? current : feedback);
  }, [editor]);

  /** 指针按下只建立候选会话；超过阈值后才进入真正拖动。 */
  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!editor || state.nodePos === null || event.button !== 0) return;

    const sourceNode = editor.state.doc.nodeAt(state.nodePos);
    const sourceDom = editor.view.nodeDOM(state.nodePos);
    const sourceElement = findTopLevelBlockElement(editor.view.dom, sourceDom);
    if (!sourceNode || !sourceElement) return;
    if (state.selection && !state.selection.selection.eq(editor.state.selection)) return;
    const selectionPlan = state.selection ? prepareBlockSelectionMove(editor.state, state.selection) : null;
    // Never degrade a selected group into an accidental single-item move.
    if (state.selection && !selectionPlan) return;

    event.preventDefault();
    event.stopPropagation();
    clearHideTimer();
    menuControllerRef.current.cancel();
    event.currentTarget.setPointerCapture(event.pointerId);

    dragSessionRef.current = {
      view: editor.view,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      sourcePos: state.nodePos,
      sourceElement,
      selectionPlan,
      scrollParent: findScrollParent(editor.view.dom),
      dragging: false,
      originalBodyCursor: document.body.style.cursor,
      originalBodyUserSelect: document.body.style.userSelect,
    };
  }, [clearHideTimer, editor, state.nodePos, state.selection]);

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
      session.endActivity = beginEditorDrag(editor!.view);
      document.body.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
      setIsDragging(true);
      const scrollParent = session.scrollParent;
      dragScrollerRef.current = createDragEdgeScroller([{
        element: scrollParent, direction: 'y', edge: 56, maxSpeed: 840,
        bounds: () => {
          const rect = scrollParent.getBoundingClientRect();
          return { start: Math.max(0, rect.top), end: Math.min(window.innerHeight, rect.bottom) };
        },
      }], () => updateDragFeedback(dragPoint.current.x, dragPoint.current.y));
    }

    dragPoint.current = { x: event.clientX, y: event.clientY };
    dragScrollerRef.current?.update(event.clientX, event.clientY);
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
    dragScrollerRef.current?.stop();
    updateDragFeedback(event.clientX, event.clientY);
    const target = dropTargetRef.current;
    suppressMenuClick.current = session.dragging;
    if (session.dragging && target && editor) {
      if (session.selectionPlan) moveBlockSelection(editor.view, session.selectionPlan, target.insertPos);
      else moveTopLevelBlock(editor.view, session.sourcePos, target.insertPos);
    }

    cleanupDrag();
    setState((current) => ({ ...current, visible: false }));
  }, [cleanupDrag, editor, menuHover, updateDragFeedback]);

  const handlePointerCancel = useCallback(() => {
    cleanupDrag();
    setState((current) => ({ ...current, visible: false }));
  }, [cleanupDrag]);

  if (!state.visible) return null;

  const blockLabel = state.selection ? `${state.selection.count} 个内容块` : getBlockTypeLabel(state.nodeType);
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
      {editor && state.nodePos !== null && !textSelecting && (isHoveringHandle || menuOpen || isDragging) && <BlockRangeFeedback editor={editor} pos={state.nodePos} to={state.selection?.to} className={isDragging ? 'nb-block-drag-source-feedback' : undefined}/>}
      <Popover.Root open={menuOpen && !isDragging} onOpenChange={menuHover.change}>
      <Popover.Anchor asChild>
        <button
          ref={handleRef}
          type="button"
          className={`nb-block-drag-handle nb-block-with-menu${state.empty ? ' nb-empty-block-handle' : ''}${isHoveringHandle ? ' is-hovered' : ''}${isDragging ? ' is-dragging' : ''}`}
          onPointerEnter={event => { if (!event.buttons && !selectionGestureRef.current) menuHover.enter(event); }}
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
            top: state.top,
            left: state.left,
            width: state.width,
            pointerEvents: textSelecting ? 'none' : undefined,
          }}
          aria-label={state.empty ? '添加内容' : `拖动${blockLabel}`}
        >
          {state.selection ? <><Rows3 size={15}/>{state.width > 30 && <span className="nb-block-grip" aria-hidden="true">⠿</span>}</> : state.empty ? <Plus size={18} aria-hidden="true"/> : <><BlockTypeIcon type={state.nodeType} level={state.nodePos === null ? undefined : editor?.state.doc.nodeAt(state.nodePos)?.attrs.level}/>{state.width > 30 && <span className="nb-block-grip" aria-hidden="true">⠿</span>}</>}
        </button>
      </Popover.Anchor>
      <Popover.Portal><Popover.Content {...menuHover.contentProps} className="nb-block-menu-popover" side="left" align="start" sideOffset={5} collisionPadding={10}
        onOpenAutoFocus={menuHover.onOpenAutoFocus} onCloseAutoFocus={menuHover.onCloseAutoFocus}
        onInteractOutside={event => {
          menuHover.contentProps.onInteractOutside(event);
          const target = event.detail.originalEvent.target;
          if (target instanceof Element && target.closest('[data-nb-editor-menu]')) event.preventDefault();
        }}>
        <HoverMenuContext.Provider value={menuHover}>{editor && state.nodePos !== null && (state.selection ? <BlockSelectionMenu editor={editor} selection={state.selection} close={() => menuHover.change(false)}/> : <BlockContextMenu editor={editor} pos={state.nodePos} close={() => menuHover.change(false)}/>)}</HoverMenuContext.Provider>
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
