// NoteBoard Markdown 顶层块安全重排序内核
// 统一负责顶层块命中、落点计算与 ProseMirror 原子移动，避免列表、表格、代码块等嵌套结构接收非法落点

import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { discreteTransaction, dispatchDiscreteEdit } from './discreteEdit';
import { BLOCK_MOVE_META, foldedSectionEnd, headingFoldingKey } from './headingFolding';
import { isListItem, canMoveListItem, moveListItem } from './listItemActions';

/** 顶层块的 DOM、文档位置与节点信息。 */
export interface TopLevelBlockInfo {
  element: HTMLElement;
  pos: number;
  node: ProseMirrorNode;
}

/** 指针对应的顶层块边界落点；落点永远不会进入节点内部。 */
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
 * 将任意编辑器内部元素提升为 ProseMirror 的直接子块。
 * 只接受 editorDom 的直接子节点，从 DOM 层杜绝把块拖入列表项、表格单元格或代码块内部。
 */
export function findTopLevelBlockElement(
  editorDom: HTMLElement,
  target: EventTarget | null,
): HTMLElement | null {
  let element = target instanceof HTMLElement ? target : null;
  const item = element?.closest('li');
  if (item && editorDom.contains(item) && !item.closest('td,th')) return item;

  while (element && element.parentElement && element.parentElement !== editorDom) {
    element = element.parentElement;
  }

  return element?.parentElement === editorDom ? element : null;
}

/**
 * 读取直接子块对应的顶层文档位置。
 * posAtDOM 可能返回节点内容起点，因此需要通过 before(1) 归一到真正的顶层节点边界。
 */
export function getTopLevelBlockInfo(
  view: EditorView,
  element: HTMLElement,
): TopLevelBlockInfo | null {
  const item = element.tagName === 'LI' && view.dom.contains(element) && !element.closest('td,th');
  if (element.parentElement !== view.dom && !item) return null;

  try {
    const domPos = view.posAtDOM(element, 0);
    const $domPos = view.state.doc.resolve(domPos);
    let depth = $domPos.depth;
    if (item) while (depth > 0 && !isListItem($domPos.node(depth))) depth--;
    const pos = item && depth ? $domPos.before(depth) : $domPos.depth === 0 ? domPos : $domPos.before(1);
    const $topLevelPos = view.state.doc.resolve(pos);
    const node = view.state.doc.nodeAt(pos);

    if (($topLevelPos.depth !== 0 && !isListItem(node)) || !node?.isBlock || node.type.name === 'documentPresentation') return null;
    return { element, pos, node };
  } catch {
    // NodeView 正在重绘或 DOM 已失效时不生成落点，等待下一次指针事件重新解析。
    return null;
  }
}

/**
 * 按垂直坐标解析最近的顶层块边界。
 * 仅遍历 ProseMirror 直接子节点，因此即使指针位于 td、li、pre 内部，结果仍是其所属顶层块的前/后边界。
 */
function dropEntries(view: EditorView, items: boolean | undefined): TopLevelBlockInfo[] {
  const elements = Array.from(view.dom.children).filter((element): element is HTMLElement =>
    element instanceof HTMLElement && !element.classList.contains('ProseMirror-widget'));
  const entries: TopLevelBlockInfo[] = [];
  // One parallel model/DOM walk avoids posAtDOM's repeated sibling-prefix
  // walks for every drop target. Custom top-level widget layouts fall back.
  if (elements.length === view.state.doc.childCount) {
    view.state.doc.forEach((node, pos, index) => {
      const element = elements[index];
      if (node.type.name === 'documentPresentation' || element.classList.contains('nb-heading-fold-hidden')) return;
      if (!items || !element.matches('ul,ol')) { entries.push({ element, node, pos }); return; }
      const candidates = [...element.querySelectorAll('li')].filter(item => !item.closest('td,th'));
      const models: Array<{ node: ProseMirrorNode; pos: number }> = [];
      node.descendants((child, offset) => {
        if (child.type.spec.tableRole === 'table') return false;
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
  const items = sourcePos !== undefined && isListItem(view.state.doc.nodeAt(sourcePos));
  const folding = headingFoldingKey.getState(view.state);
  let cached = dropIndexes.get(view);
  if (!cached || cached.doc !== view.state.doc || cached.folding !== folding || cached.items !== items) {
    cached = { doc: view.state.doc, folding, items, entries: dropEntries(view, items) }; dropIndexes.set(view, cached);
  }
  const entries = cached.entries;
  if (entries.length === 0) return null;
  const rectOf = (entry: TopLevelBlockInfo) => (isListItem(entry.node) ? entry.element.firstElementChild ?? entry.element : entry.element).getBoundingClientRect();
  let low = 0, high = entries.length;
  while (low < high) {
    const middle = (low + high) >>> 1, rect = rectOf(entries[middle]);
    if (clientY < rect.top + rect.height / 2) high = middle; else low = middle + 1;
  }
  if (low < entries.length) {
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
const dropIndexes = new WeakMap<EditorView, { doc: ProseMirrorNode; folding: unknown; items: boolean; entries: TopLevelBlockInfo[] }>();

/**
 * 校验块移动是否同时满足：源节点位于文档顶层、目标是顶层边界、目标不在源节点自身范围内。
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
    if (isListItem(sourceNode)) return canMoveListItem(doc, sourcePos, insertPos);

    if ($source.depth !== 0 || $insert.depth !== 0 || !sourceNode?.isBlock || sourceNode.type.name === 'documentPresentation') return false;
    if (insertPos === 0 && doc.firstChild?.type.name === 'documentPresentation') return false;

    const end = sourceEnd ?? sourcePos + sourceNode.nodeSize;
    if (end < sourcePos + sourceNode.nodeSize || end > doc.content.size || doc.resolve(end).depth !== 0) return false;
    if (insertPos >= sourcePos && insertPos <= end) return false;

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
 * 提交前再次验证映射后的父节点，确保任何列表、表格、代码块内部位置都无法进入事务。
 */
export function moveTopLevelBlock(
  view: EditorView,
  sourcePos: number,
  insertPos: number,
): BlockMoveResult | null {
  const { state } = view;
  const sourceNode = state.doc.nodeAt(sourcePos);
  if (isListItem(sourceNode)) return moveListItem(view, sourcePos, insertPos);

  const sourceEnd = foldedSectionEnd(state, sourcePos) ?? sourcePos + (sourceNode?.nodeSize ?? 0);
  if (!sourceNode || !isTopLevelBlockMoveAllowed(state.doc, sourcePos, insertPos, sourceEnd)) {
    return null;
  }

  const fragment = state.doc.slice(sourcePos, sourceEnd).content;
  const mappedInsertPos = insertPos > sourceEnd
    ? insertPos - (sourceEnd - sourcePos)
    : insertPos;

  try {
    const tr = discreteTransaction(state.tr).delete(sourcePos, sourceEnd);
    const $mappedInsert = tr.doc.resolve(mappedInsertPos);

    if (
      $mappedInsert.depth !== 0
      || !$mappedInsert.parent.canReplace(
        $mappedInsert.index(),
        $mappedInsert.index(),
        fragment,
      )
    ) {
      return null;
    }

    tr.insert(mappedInsertPos, fragment);
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
