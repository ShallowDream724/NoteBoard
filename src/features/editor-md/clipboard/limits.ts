import type { JSONContent } from '@tiptap/core';

/** Page layout depth is unrelated to authored document nesting. */
export const CLIPBOARD_LIMITS = { characters: 16_000_000, htmlNodes: 1_000_000, nodes: 250_000, depth: 48, cells: 100_000, rules: 2_048, synchronous: 24_000 } as const;
export class ClipboardImportError extends Error {}
export function checkClipboardHtmlNodes(nodes: number): void {
  if (nodes > CLIPBOARD_LIMITS.htmlNodes) throw new ClipboardImportError('网页元素过多，请缩小复制范围，或使用“仅粘贴文本”');
}
export function checkClipboardStructure(nodes: number, depth: number): void {
  if (nodes > CLIPBOARD_LIMITS.nodes) throw new ClipboardImportError('剪贴板正文节点过多，请分段粘贴');
  if (depth > CLIPBOARD_LIMITS.depth) throw new ClipboardImportError('剪贴板正文嵌套超过 48 层，请减少列表或引用的嵌套');
}
export function validateClipboardStructure(content: JSONContent[]): number {
  const stack = [{ content, index: 0 }]; let nodes = 0;
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame.index === frame.content.length) { stack.pop(); continue; }
    const node = frame.content[frame.index++];
    if (!node || typeof node !== 'object' || (node.content && !Array.isArray(node.content))) throw new ClipboardImportError('剪贴板文档片段无效');
    checkClipboardStructure(++nodes, stack.length - 1);
    if (node.content?.length) stack.push({ content: node.content, index: 0 });
  }
  return nodes;
}
