import type { JSONContent } from '@tiptap/core';

/** Validate references before the editor can append or normalize anything.
 * This is the current format contract, not an older-format migration. */
export function normalizeNativeStructure(doc: JSONContent): JSONContent {
  const ids = new Set<string>(), referenced = new Set<string>();
  let store: JSONContent | undefined;
  const stack = [{ node: doc, parent: '', inAnnotation: false }];
  const reference = (value: unknown) => {
    if (typeof value !== 'string' || !value.trim() || value.length > 128) throw new Error('补充说明需要一个不超过 128 字符的非空 id。');
    return value;
  };
  while (stack.length) {
    const { node, parent, inAnnotation } = stack.pop()!;
    if (node.type === 'annotationStore') {
      if (parent !== 'doc' || store) throw new Error('文档只能有一个位于顶层的补充说明集合。');
      store = node;
    }
    if (node.type === 'annotationBody') {
      if (parent !== 'annotationStore') throw new Error('说明正文必须位于补充说明集合中。');
      const id = reference(node.attrs?.id); if (ids.has(id)) throw new Error(`补充说明 id 重复：${id}`); ids.add(id);
    }
    const references = node.marks?.filter(mark => mark.type === 'annotationReference') ?? [];
    if (inAnnotation && (node.attrs?.annotationId != null || references.length)) throw new Error('补充说明正文不能再嵌套说明。');
    if (node.attrs?.annotationId != null) referenced.add(reference(node.attrs.annotationId));
    for (const mark of references) referenced.add(reference(mark.attrs?.id));
    for (const child of node.content ?? []) stack.push({ node: child, parent: node.type ?? '', inAnnotation: inAnnotation || node.type === 'annotationBody' });
  }
  for (const id of referenced) if (!ids.has(id)) throw new Error(`找不到补充说明正文：${id}`);
  for (const id of ids) if (!referenced.has(id)) throw new Error(`补充说明没有对应的正文锚点：${id}`);
  const presentation = doc.content?.filter(node => node.type === 'documentPresentation') ?? [];
  if (presentation.length > 1) throw new Error('文档只能有一个全局排版设置。');
  if (store || presentation.length) doc.content = [...presentation, ...(store ? [store] : []), ...(doc.content ?? []).filter(node => node !== store && node.type !== 'documentPresentation')];
  return doc;
}
