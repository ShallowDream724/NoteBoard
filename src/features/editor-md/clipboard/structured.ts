import type { JSONContent } from '@tiptap/core';
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { annotationBodiesForFragment, annotationBodyContent, remapAnnotationIds } from '../annotations/model';
import { CLIPBOARD_LIMITS, ClipboardImportError, type ClipboardImportResult } from './normalize';

export function parseStructuredClipboard(raw: string, table = false, stripAnnotations = false): ClipboardImportResult {
  if (raw.length > CLIPBOARD_LIMITS.characters) throw new ClipboardImportError('剪贴板内容过大，请分段粘贴');
  const payload = JSON.parse(raw), value = table ? payload.slice : payload;
  if (payload.version !== 1 || !value || !Array.isArray(value.content) || !Number.isInteger(value.openStart ?? 0) || !Number.isInteger(value.openEnd ?? 0)
    || (value.openStart ?? 0) < 0 || (value.openEnd ?? 0) < 0 || (value.openStart ?? 0) > CLIPBOARD_LIMITS.depth || (value.openEnd ?? 0) > CLIPBOARD_LIMITS.depth
    || (table && !['row', 'column', 'table', 'cells'].includes(payload.scope))) throw new ClipboardImportError('剪贴板文档片段无效');
  const stack = value.content.map((node: JSONContent) => ({ node, depth: 0 })); let nodes = 0;
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    if (!node || ++nodes > CLIPBOARD_LIMITS.nodes || depth > CLIPBOARD_LIMITS.depth || (node.content && !Array.isArray(node.content))) throw new ClipboardImportError('剪贴板结构超过导入限制');
    for (const child of node.content ?? []) stack.push({ node: child, depth: depth + 1 });
  }
  const content = stripAnnotations ? annotationBodyContent(value.content) : remapAnnotationIds({ type: 'doc', content: value.content }).content ?? [];
  return { content, nodes, diagnostics: [], openStart: value.openStart ?? 0, openEnd: value.openEnd ?? 0, ...(table ? { tableScope: payload.scope } : {}) };
}

/** Native PM drag/paste fallback: remove recursive notes without JSON materialization. */
export function withoutNestedAnnotations(slice: Slice): Slice {
  function clean(node: PMNode): PMNode | null {
    if (node.type.name === 'annotationStore' || node.type.name === 'annotationBody') return null;
    let changed = false; const children: PMNode[] = [];
    node.forEach(child => { const result = clean(child); if (result !== child) changed = true; if (result) children.push(result); });
    const marks = node.marks.filter(mark => mark.type.name !== 'annotationReference');
    const attrs = node.attrs.annotationId ? { ...node.attrs, annotationId: null } : node.attrs;
    if (!changed && marks.length === node.marks.length && attrs === node.attrs) return node;
    return node.isText ? node.mark(marks) : node.type.create(attrs, changed ? Fragment.from(children) : node.content, marks);
  }
  const content: PMNode[] = []; let changed = false;
  slice.content.forEach(node => { const result = clean(node); if (result !== node) changed = true; if (result) content.push(result); });
  if (!changed) return slice;
  const fragment = Fragment.from(content), maximum = Slice.maxOpen(fragment, false);
  return new Slice(fragment, Math.min(slice.openStart, maximum.openStart), Math.min(slice.openEnd, maximum.openEnd));
}

/** A fragment carries only note entities referenced by its anchors. */
export function attachedClipboardContent(doc: PMNode, slice: Slice): JSONContent[] {
  const json: JSONContent[] = slice.content.toJSON() ?? [];
  const bodies = annotationBodiesForFragment(doc, { type: 'doc', content: json });
  return [...json.filter(node => node.type !== 'annotationStore'), ...(bodies.length ? [{ type: 'annotationStore', content: bodies }] : [])];
}
export function documentSliceClipboardData(doc: PMNode, slice: Slice): string {
  return JSON.stringify({ version: 1, content: attachedClipboardContent(doc, slice), openStart: slice.openStart, openEnd: slice.openEnd });
}
/** Must run on the SAME transaction that introduces anchors, before orphan cleanup. */
export function mergeImportedAnnotationBodies(tr: Transaction, bodies: PMNode[]): Transaction {
  if (!bodies.length || !tr.doc.type.schema.nodes.annotationStore) return tr;
  let store: { node: PMNode; pos: number } | undefined;
  tr.doc.forEach((node, pos) => { if (node.type.name === 'annotationStore') store = { node, pos }; });
  if (store) tr.insert(store.pos + store.node.nodeSize - 1, bodies);
  else tr.insert(tr.doc.firstChild?.type.name === 'documentPresentation' ? tr.doc.firstChild.nodeSize : 0, tr.doc.type.schema.nodes.annotationStore.createChecked(null, bodies));
  return tr;
}
