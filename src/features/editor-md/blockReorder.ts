// NoteBoard Markdown 顶层块安全重排序内核
// 统一负责块/列表项命中、边界落点与原子移动；列表分段复用局部插入计划，拒绝文字、表格、代码内部落点

import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { discreteTransaction, dispatchDiscreteEdit } from './discreteEdit';
import { BLOCK_MOVE_META, foldedSectionEnd, headingFoldingKey } from './headingFolding';
import { isListItem, canMoveListItem, moveListItem } from './listItemActions';
import { blockInteractionScope, isBlockInteractionTarget } from './blockInteractionScope';
import { listItemAtY } from './listItemHitTest';
import { canInsertAtListBoundary, insertAtListBoundary } from './listBoundaryInsertion';

/** 顶层块的 DOM、文档位置与节点信息。 */
export interface TopLevelBlockInfo {
  element: HTMLElement;
  pos: number;
  node: ProseMirrorNode;
}

/** A block edge or a list-item boundary; never a text/cell/code interior. */
export interface TopLevelDropTarget {
  insertPos: number;
  indicatorClientY: number;
  targetPos: number;
  edge: 'before' | 'after';
  element: HTMLElement;
}

/** 成功移动后的新位置，用于恢复选区和播放落位动效。 */
export interface BlockMoveResult {
  insertedPos: number;
}

/**
 * Resolve a block or individual list item within the supported editing scope.
 * Pointer hits in generated list markers/padding retain that row's item; calls
 * without pointer coordinates retain the exact model/DOM node for feedback.
 */
export function findTopLevelBlockElement(
  editorDom: HTMLElement,
  target: EventTarget | null,
  clientY?: number,
): HTMLElement | null {
  let element = target instanceof Element ? target : null;
  if (!element || element.closest('.ProseMirror') !== editorDom) return null;
  const disclosure = element.closest('.nb-disclosure');
  if (disclosure?.parentElement?.closest('.nb-disclosure')) return null;
  const body = element.closest('.nb-disclosure-body');
  const container = body ?? editorDom;
  const listHit = clientY !== undefined && element.matches('ol,ul');
  const item = listHit ? listItemAtY(element, clientY) : element.closest('li');
  if (listHit && !item) return null;
  if (item instanceof HTMLElement && container.contains(item) && !item.closest('td,th')) return item;

  while (element && element.parentElement && element.parentElement !== container) {
    element = element.parentElement;
  }

  return element instanceof HTMLElement && element.parentElement === container ? element : null;
}

/**
 * 读取直接子块对应的顶层文档位置。
 * posAtDOM 可能返回节点内容起点，因此需要通过 before(1) 归一到真正的顶层节点边界。
 */
export function getTopLevelBlockInfo(
  view: EditorView,
  element: HTMLElement,
): TopLevelBlockInfo | null {
  if (element.classList.contains('ProseMirror-widget')) return null;
  if (!view.dom.contains(element)) return null;

  try {
    const domPos = view.posAtDOM(element, 0);
    const $domPos = view.state.doc.resolve(domPos);
    let pos = domPos;
    for (let depth = $domPos.depth; depth > 0; depth--) {
      const candidate = $domPos.before(depth);
      if (view.nodeDOM(candidate) === element) { pos = candidate; break; }
    }
    const node = view.state.doc.nodeAt(pos);

    if (!node || !isBlockInteractionTarget(view.state.doc, pos)) return null;
    return { element, pos, node };
  } catch {
    // NodeView 正在重绘或 DOM 已失效时不生成落点，等待下一次指针事件重新解析。
    return null;
  }
}

/**
 * 按垂直坐标解析最近的顶层块边界。
 * 索引包含当前区域的直接子块和列表项；表格与代码仅保留外部边界。
 */
function dropEntries(view: EditorView, items: boolean, scope: number): TopLevelBlockInfo[] {
  const scopeDom = scope === -1 ? view.dom : view.nodeDOM(scope);
  const container = scope === -1 ? view.dom : scopeDom instanceof Element ? scopeDom.querySelector(':scope > .nb-disclosure-body') : null;
  if (!container || container instanceof HTMLElement && container.hidden) return [];
  const parent = scope === -1 ? view.state.doc : view.state.doc.nodeAt(scope)!;
  const start = scope === -1 ? 0 : scope + 1;
  const elements = Array.from(container.children).filter((element): element is HTMLElement =>
    element instanceof HTMLElement && !element.classList.contains('ProseMirror-widget'));
  const entries: TopLevelBlockInfo[] = [];
  // One parallel model/DOM walk avoids posAtDOM's repeated sibling-prefix
  // walks for every drop target. Custom top-level widget layouts fall back.
  if (elements.length === parent.childCount) {
    parent.forEach((node, offset, index) => {
      const pos = start + offset;
      const element = elements[index];
      if (['documentPresentation', 'annotationStore'].includes(node.type.name) || element.classList.contains('nb-heading-fold-hidden')) return;
      if (!items || !element.matches('ul,ol')) { entries.push({ element, node, pos }); return; }
      const candidates = [...element.querySelectorAll('li')].filter(item => !item.closest('td,th'));
      const models: Array<{ node: ProseMirrorNode; pos: number }> = [];
      node.descendants((child, offset) => {
        if (child.type.spec.tableRole === 'table' || child.type.name === 'disclosure') return false;
        if (isListItem(child)) models.push({ node: child, pos: pos + 1 + offset });
      });
      if (candidates.length === models.length) models.forEach((model, i) => entries.push({ ...model, element: candidates[i] }));
      else for (const candidate of candidates) { const info = getTopLevelBlockInfo(view, candidate); if (info) entries.push(info); }
    });
    return entries;
  }
  for (const element of elements) {
    if (element.classList.contains('nb-heading-fold-hidden')) continue;
    for (const candidate of items && element.matches('ul,ol') ? element.querySelectorAll('li') : [element]) {
      const info = getTopLevelBlockInfo(view, candidate as HTMLElement); if (info) entries.push(info);
    }
  }
  return entries;
}

export function resolveTopLevelDropTarget(
  view: EditorView,
  clientY: number,
  sourcePos?: number,
): TopLevelDropTarget | null {
  const items = sourcePos !== undefined;
  const scope = sourcePos === undefined ? -1 : blockInteractionScope(view.state.doc.resolve(sourcePos));
  if (scope === null) return null;
  const folding = headingFoldingKey.getState(view.state);
  let cached = dropIndexes.get(view);
  if (!cached || cached.doc !== view.state.doc || cached.folding !== folding || cached.items !== items || cached.scope !== scope) {
    cached = { doc: view.state.doc, folding, items, scope, entries: dropEntries(view, items, scope) }; dropIndexes.set(view, cached);
  }
  const entries = cached.entries;
  if (entries.length === 0) return null;
  if (scope !== -1) {
    const container = entries[0].element.closest('.nb-disclosure-body');
    const rect = container?.getBoundingClientRect();
    if (!rect || clientY < rect.top || clientY > rect.bottom) return null;
  }
  const rectOf = (entry: TopLevelBlockInfo) => (isListItem(entry.node) ? entry.element.firstElementChild ?? entry.element : entry.element).getBoundingClientRect();
  let low = 0, high = entries.length;
  while (low < high) {
    const middle = (low + high) >>> 1, rect = rectOf(entries[middle]);
    if (clientY < rect.top + rect.height / 2) high = middle; else low = middle + 1;
  }
  if (low < entries.length) {
      const previous = entries[low - 1];
      // The last row's lower half still belongs to its list. The next
      // paragraph's boundary would silently pull the item into a new list.
      // Descendants keep their own boundaries rather than skipping a subtree.
      if (items && previous && isListItem(previous.node)
        && entries[low].pos >= previous.pos + previous.node.nodeSize
        && clientY < rectOf(entries[low]).top) {
        return {
          insertPos: previous.pos + previous.node.nodeSize,
          indicatorClientY: previous.element.getBoundingClientRect().bottom,
          targetPos: previous.pos,
          edge: 'after',
          element: previous.element,
        };
      }
      const entry = entries[low];
      return {
        insertPos: entry.pos,
        indicatorClientY: rectOf(entry).top,
        targetPos: entry.pos,
        edge: 'before',
        element: entry.element,
      };
  }

  const last = entries[entries.length - 1];
  return {
    insertPos: foldedSectionEnd(view.state, last.pos) ?? last.pos + last.node.nodeSize,
    indicatorClientY: rectOf(last).bottom,
    targetPos: last.pos,
    edge: 'after',
    element: last.element,
  };
}
const dropIndexes = new WeakMap<EditorView, { doc: ProseMirrorNode; folding: unknown; items: boolean; scope: number; entries: TopLevelBlockInfo[] }>();
export function releaseBlockDropIndex(view: EditorView): void { dropIndexes.delete(view); }

/**
 * 校验同区域块边界或列表项边界，拒绝自身内部；列表分段不把普通块塞进列表项壳。
 * 该校验会在拖拽预览与最终事务提交时各执行一次，防止状态变化绕过 UI 层保护。
 */
export function isTopLevelBlockMoveAllowed(
  doc: ProseMirrorNode,
  sourcePos: number,
  insertPos: number,
  sourceEnd?: number,
): boolean {
  if (!Number.isInteger(sourcePos) || !Number.isInteger(insertPos)) return false;
  if (sourcePos < 0 || insertPos < 0 || insertPos > doc.content.size) return false;

  try {
    const $source = doc.resolve(sourcePos);
    const $insert = doc.resolve(insertPos);
    const sourceNode = doc.nodeAt(sourcePos);
    if (!isBlockInteractionTarget(doc, sourcePos)) return false;
    const scope = blockInteractionScope($source);
    if (scope === null || blockInteractionScope($insert) !== scope) return false;
    if (isListItem(sourceNode)) return canMoveListItem(doc, sourcePos, insertPos);

    if (!sourceNode?.isBlock) return false;
    if (insertPos === 0 && doc.firstChild?.type.name === 'documentPresentation') return false;

    const end = sourceEnd ?? sourcePos + sourceNode.nodeSize;
    if (end < sourcePos + sourceNode.nodeSize || end > doc.content.size || doc.resolve(end).parent !== $source.parent) return false;
    if (insertPos >= sourcePos && insertPos <= end) return false;

    if (canInsertAtListBoundary(doc, insertPos, Fragment.from(sourceNode))) return true;
    if ($source.parent !== $insert.parent) return false;

    return $insert.parent.canReplaceWith(
      $insert.index(),
      $insert.index(),
      sourceNode.type,
      sourceNode.marks,
    );
  } catch {
    // 越界位置或文档结构瞬时变化都视为非法落点。
    return false;
  }
}

/**
 * 以“删除源块 → 映射目标位置 → 插入原节点”的单一事务完成顶层重排序。
 * 提交前再次验证父节点与列表分段，文字、表格及代码内部位置不进入事务。
 */
export function moveTopLevelBlock(
  view: EditorView,
  sourcePos: number,
  insertPos: number,
): BlockMoveResult | null {
  const { state } = view;
  const sourceNode = state.doc.nodeAt(sourcePos);
  if (isListItem(sourceNode)) return isTopLevelBlockMoveAllowed(state.doc, sourcePos, insertPos) ? moveListItem(view, sourcePos, insertPos) : null;

  const sourceEnd = foldedSectionEnd(state, sourcePos) ?? sourcePos + (sourceNode?.nodeSize ?? 0);
  if (!sourceNode || !isTopLevelBlockMoveAllowed(state.doc, sourcePos, insertPos, sourceEnd)) {
    return null;
  }

  const fragment = state.doc.slice(sourcePos, sourceEnd).content;
  let mappedInsertPos = insertPos > sourceEnd
    ? insertPos - (sourceEnd - sourcePos)
    : insertPos;

  try {
    const tr = discreteTransaction(state.tr).delete(sourcePos, sourceEnd);
    const splitPosition = insertAtListBoundary(tr, mappedInsertPos, fragment);
    if (splitPosition === null) {
      const at = tr.doc.resolve(mappedInsertPos);
      if (!at.parent.canReplace(at.index(), at.index(), fragment)) return null;
      tr.insert(mappedInsertPos, fragment);
    } else {
      mappedInsertPos = splitPosition;
    }
    tr.setMeta(BLOCK_MOVE_META, { from: sourcePos, to: sourceEnd, inserted: mappedInsertPos });

    // 普通块使用 NodeSelection 保留清晰的移动结果；极少数不可选节点回退到邻近文本选区。
    const selection = NodeSelection.isSelectable(sourceNode)
      ? NodeSelection.create(tr.doc, mappedInsertPos)
      : TextSelection.near(tr.doc.resolve(mappedInsertPos), 1);
    tr.setSelection(selection).scrollIntoView();

    dispatchDiscreteEdit(view, tr);
    view.focus();
    return { insertedPos: mappedInsertPos };
  } catch {
    // Schema 拒绝或文档在指针释放前变化时保持原文档不变。
    return null;
  }
}
