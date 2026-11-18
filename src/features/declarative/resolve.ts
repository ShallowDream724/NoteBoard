import type { JSONContent } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';
import { nodeSource, type SourceRecord } from './syntax';
import type { AuthoringDiagnostic } from './types';

export interface ResolvedSource { node: JSONContent; source: SourceRecord }
export interface ResolvedDocument { document: JSONContent; diagnostics: AuthoringDiagnostic[]; records: ResolvedSource[]; blockOrigins: WeakMap<JSONContent, JSONContent> }
type Intermediate = JSONContent & { authoringBody?: JSONContent[]; authoringSource?: SourceRecord };
const contains = (nodes: JSONContent[], types: string[]): boolean => nodes.some(node => types.includes(node.type ?? '') || node.marks?.some(mark => types.includes(mark.type)) || contains(node.content ?? [], types));
export function resolveAuthoring(source: string, input: JSONContent, schema?: Schema): ResolvedDocument {
  const diagnostics: AuthoringDiagnostic[] = [], records: ResolvedSource[] = [], definitions = new Map<string, JSONContent[]>(), refs = new Set<string>(), stores: JSONContent[] = [];
  const blockOrigins = new WeakMap<JSONContent, JSONContent>();
  const ranges = new WeakMap<JSONContent, { from: number; to: number }>();
  // Each host/container has its own source region. Repeated text in another
  // paragraph can never steal the location of this node.
  function locate(node: JSONContent, region: string, base: number) {
    const info = nodeSource(node); let ownRegion = region, ownBase = base;
    if (info) { const at = region.indexOf(info.raw); if (at >= 0) { ownBase = base + at; ownRegion = info.raw; ranges.set(node, { from: ownBase, to: ownBase + info.raw.length }); } }
    let cursor = 0;
    for (const child of node.content ?? []) {
      const childInfo = nodeSource(child), at = childInfo ? ownRegion.indexOf(childInfo.raw, cursor) : -1;
      if (at >= 0) { locate(child, ownRegion.slice(at, at + childInfo!.raw.length), ownBase + at); cursor = at + childInfo!.raw.length; }
      else locate(child, ownRegion.slice(cursor), ownBase + cursor);
    }
  }
  locate(input, source, 0);
  function diagnostic(node: JSONContent, message: string, code: string, severity: 'error' | 'warning' = 'error') {
    const range = ranges.get(node) ?? { from: 0, to: source.length };
    diagnostics.push({ ...range, message, code, severity });
  }
  function raw(node: JSONContent, message: string): JSONContent {
    diagnostic(node, message, 'invalid-authoring');
    const info = nodeSource(node), text = info?.raw ?? '';
    const result = node.type === 'authoringNote' || node.attrs?.inline ? { type: 'text', text, marks: [{ type: 'authoringLiteral' }] } : { type: 'authoringRaw', content: text ? [{ type: 'text', text }] : undefined };
    if (info) records.push({ node: result, source: info });
    return result;
  }
  function collect(node: JSONContent, independent = false) {
    if (node.type === 'authoringRaw') return;
    if (node.type === 'annotationStore') { stores.push(...node.content ?? []); return; }
    if (node.type === 'authoringDefinition') {
      const id = String(node.attrs?.id ?? '');
      if (!independent && !contains(node.content ?? [], ['authoringNote', 'authoringDefinition', 'authoringExplain', 'annotationReference'])) definitions.set(id, [...(definitions.get(id) ?? []), node]);
      return;
    }
    for (const child of node.content ?? []) collect(child, independent || node.type === 'authoringExplain');
  }
  collect(input);
  let directCounter = 0;
  function directId() { let id: string; do { id = `note-${++directCounter}`; } while (definitions.has(id) || stores.some(store => store.attrs?.id === id)); return id; }
  function body(id: string, content: JSONContent[], original?: JSONContent) {
    const result = { type: 'annotationBody', attrs: { id }, content: content.length ? content : [{ type: 'paragraph' }] };
    stores.push(result);
    const info = original && nodeSource(original); if (info) records.push({ node: result, source: info });
  }
  function validRef(node: JSONContent, id: string): boolean {
    refs.add(id);
    if (definitions.get(id)?.length === 1 || stores.some(store => store.attrs?.id === id)) return true;
    diagnostic(node, definitions.get(id)?.length ? `说明 ${id} 重复定义` : `缺少说明 ${id}`, 'invalid-reference'); return false;
  }
  function walk(nodes: JSONContent[], inLink = false, inExplanation = false): JSONContent[] {
    const output: JSONContent[] = []; let previousWasDefinition = false;
    for (const original of nodes) {
      const append = (...children: JSONContent[]) => {
        for (const child of children) {
          output.push(child);
          if (nodes === input.content) blockOrigins.set(child, original);
        }
      };
      const node = original as Intermediate, info = nodeSource(node);
      if (info?.error) diagnostic(node, info.error, 'invalid-authoring');
      if (node.type === 'authoringNative') {
        try {
          const value = node.attrs?.value as JSONContent; if (!schema) throw new Error('没有原生schema');
          const native = schema.nodeFromJSON(value); native.check(); if (!!node.attrs?.inline !== native.isInline) throw new Error('原生内容区域类型不符');
          const result = native.toJSON() as JSONContent; append(result); if (info) records.push({ node: result, source: info });
        } catch { append(raw(node, '原生保留内容不符合文档结构')); }
        previousWasDefinition = false; continue;
      }
      if (node.type === 'authoringDefinition') {
        previousWasDefinition = true;
        const id = String(node.attrs?.id ?? '');
        if (inExplanation || definitions.get(id)?.length !== 1) { append(raw(node, definitions.get(id)?.length ? `说明 ${id} 重复定义` : '说明正文不能创建说明或定义')); continue; }
        body(id, walk(node.content ?? [], false, true), node); continue;
      }
      if (node.type === 'authoringExplain') {
        const target = output.at(-1), id = node.attrs?.ref ? String(node.attrs.ref) : directId();
        if (inExplanation || previousWasDefinition || !target || target.type === 'authoringRaw' || target.attrs?.annotationId || contains(node.content ?? [], ['authoringNote', 'authoringDefinition', 'authoringExplain', 'annotationReference']) || (node.attrs?.ref && node.content?.some(child => child.type !== 'paragraph' || child.content?.length))) { append(raw(node, 'explain需要紧邻的有效内容块，且说明不可重复或嵌套')); previousWasDefinition = false; continue; }
        if (node.attrs?.ref) { if (!validRef(node, id)) { append(raw(node, '说明引用无效')); continue; } }
        else body(id, walk(node.content ?? [], false, true), node);
        target.attrs = { ...target.attrs, annotationId: id }; previousWasDefinition = false; continue;
      }
      if (node.type === 'authoringNote') {
        if (inLink || inExplanation || contains(node.content ?? [], ['link', 'authoringNote', 'annotationReference'])) { append(raw(node, '链接和说明不能嵌套，说明正文不能再创建说明')); continue; }
        const id = node.attrs?.ref ? String(node.attrs.ref) : directId();
        if (node.attrs?.ref) { if (!validRef(node, id)) { append(raw(node, '说明引用无效')); continue; } }
        else body(id, [{ type: 'paragraph', content: walk(node.authoringBody ?? [], false, true) }], node);
        const anchor = walk(node.content ?? []);
        append(...anchor.map(child => ({ ...child, marks: [...(child.marks ?? []), ...(node.marks ?? []), { type: 'annotationReference', attrs: { id } }] })));
        previousWasDefinition = false; continue;
      }
      if (node.type === 'annotationStore') continue;
      const result: JSONContent = { ...node };
      delete (result as Intermediate).authoringSource; delete (result as Intermediate).authoringBody;
      if (node.content) { result.content = walk(node.content, inLink || !!node.marks?.some(mark => mark.type === 'link'), inExplanation); if (!result.content.length && ['disclosure', 'githubAlert', 'blockquote', 'listItem', 'taskItem'].includes(node.type ?? '')) result.content = [{ type: 'paragraph' }]; }
      append(result); if (info) records.push({ node: result, source: info }); previousWasDefinition = false;
    }
    return output;
  }
  const content = walk(input.content ?? []);
  for (const [id, defs] of definitions) if (defs.length === 1 && !refs.has(id)) diagnostic(defs[0], `说明 ${id} 未引用`, 'unused-annotation', 'warning');
  if (stores.length) content.push({ type: 'annotationStore', content: stores });
  if (!content.length) content.push({ type: 'paragraph' });
  return { document: { type: 'doc', content }, diagnostics, records, blockOrigins };
}
