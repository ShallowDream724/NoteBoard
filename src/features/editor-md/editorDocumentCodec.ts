import type { Editor, JSONContent } from '@tiptap/core';
import type { Node, Schema } from '@tiptap/pm/model';
import { decodeNativeFile, nativeNodeSource, nativeError, nativeErrorChild, NATIVE_CHILD_CONTAINERS, NATIVE_DOCUMENT_HEADER, readNativeMetadata, replaceNativeMetadata, type NativeMetadata, type NativeNode, visitNativeDocument } from '../../core/nativeDocument';
import { hasMarkdownContentChanged, initializeMarkdownContent, parseMarkdown, rememberMarkdownSource, serializeMarkdown, withEditableTail } from './serialize';
import { resolveRelativeDocPath } from '../../core/documentPath';
import { normalizeNativeStructure } from '../../core/nativeDocumentStructure';
import { reconcileDocumentHistory } from './documentReconciliation';

export type RichDocumentFormat = 'markdown' | 'noteboard';
const formats = new WeakMap<Editor, RichDocumentFormat>();
const directories = new WeakMap<Editor, string>();
const keys = new WeakMap<Editor, string>();
const metadataByEditor = new WeakMap<Editor, NativeMetadata>();
const emptyMetadata: NativeMetadata = Object.freeze({});
const encoded = new WeakMap<Node, { directory: string; metadata: NativeMetadata; content: string }>();
// Only immutable frame roots (blocks/rows/items) are cached. Inline trees are
// serialized inside their frame without retaining a second document tree.
const frames = new WeakMap<Node, { directory: string; content: string }>();
const originalSources = new WeakMap<Node, { content: string; metadata: NativeMetadata }>();

export function editorDocumentFormat(editor: Editor): RichDocumentFormat { return formats.get(editor) ?? 'markdown'; }
export function editorDocumentDirectory(editor: Editor): string { return directories.get(editor) ?? ''; }
export function editorDocumentKey(editor: Editor): string | undefined { return keys.get(editor); }
export function getEditorNativeMetadata(editor: Editor): NativeMetadata { return metadataByEditor.get(editor) ?? emptyMetadata; }
/** Metadata is an immutable snapshot; callers replace it after flushing pending edits. */
export function setEditorNativeMetadata(editor: Editor, metadata: NativeMetadata): void { metadataByEditor.set(editor, metadata); }
/** The caller has applied the same attribute-only image mapping to this exact
 * immutable document and source. Do not use for arbitrary source replacement. */
export function rememberEditorDocumentSource(editor: Editor, content: string): void {
  if (editorDocumentFormat(editor) === 'markdown') { rememberMarkdownSource(editor, content); return; }
  const metadata = readNativeMetadata(content);
  metadataByEditor.set(editor, metadata);
  originalSources.set(editor.state.doc, { content, metadata });
  encoded.delete(editor.state.doc);
}
function compactAttrs(attrs: Record<string, unknown>, defaults: Record<string, { default?: unknown }> | undefined): Record<string, unknown> | undefined {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) if (value !== undefined && value !== null && value !== defaults?.[key]?.default) result[key] = value;
  return Object.keys(result).length ? result : undefined;
}
function nodeJson(node: Node, directory: string, skeleton = false): string {
  const resolve = (value: unknown) => typeof value === 'string' && value && !/^(?:[a-z][a-z0-9+.-]*:|[\\/#])/i.test(value)
    ? resolveRelativeDocPath(directory, value).replace(/\\/g, '/') : value;
  const attrs = compactAttrs(node.attrs, node.type.spec.attrs);
  if (directory && node.type.name === 'image' && attrs?.src) attrs.src = resolve(attrs.src);
  if (directory && Array.isArray(attrs?.captionContent)) attrs.captionContent = attrs.captionContent.map(item => ({ ...item,
    ...(item.marks ? { marks: item.marks.map((mark: { type: string; attrs?: Record<string, unknown> }) => mark.type === 'link' && mark.attrs?.href
      ? { ...mark, attrs: { ...mark.attrs, href: resolve(mark.attrs.href) } } : mark) } : {}),
  }));
  const head: NativeNode = { type: node.type.name, ...(attrs ? { attrs } : {}), ...(node.isText ? { text: node.text } : {}) };
  if (node.marks.length) head.marks = node.marks.map(mark => {
    const attrs = compactAttrs(mark.attrs, mark.type.spec.attrs);
    if (directory && mark.type.name === 'link' && attrs?.href) attrs.href = resolve(attrs.href);
    return { type: mark.type.name, ...(attrs ? { attrs } : {}) };
  });
  const json = JSON.stringify(head);
  if (skeleton || !node.childCount) return json;
  const children: string[] = [];
  node.forEach(child => children.push(nodeJson(child, directory)));
  return json.slice(0, -1) + ',"content":[' + children.join(',') + ']}';
}
function errorRecord(node: Node): string | undefined {
  if (node.type.name === 'nativeError') return node.attrs.raw;
  let onlyEmptyExtraCells = true;
  if (node.type.name === 'tableRow') node.forEach((cell, _offset, index) => { if (index) cell.forEach(block => { if (block.type.name !== 'paragraph' || block.childCount) onlyEmptyExtraCells = false; }); });
  const error = node.type.name === 'tableRow' && onlyEmptyExtraCells && node.firstChild?.childCount === 1 ? node.firstChild.firstChild
    : ['listItem', 'taskItem'].includes(node.type.name) && node.childCount === 2 && !node.firstChild?.childCount ? node.lastChild : null;
  return error?.type.name === 'nativeError' && String(error.attrs.raw).startsWith('@child ') ? error.attrs.raw : undefined;
}
function encodeFrame(node: Node, directory: string): string {
  const cached = frames.get(node);
  if (cached?.directory === directory) return cached.content;
  const content = nodeJson(node, directory);
  frames.set(node, { directory, content });
  return content;
}
export function serializeNativeNode(doc: Node, directory = '', metadata?: NativeMetadata): string {
  metadata ??= originalSources.get(doc)?.metadata ?? emptyMetadata;
  const cached = encoded.get(doc);
  if (cached?.directory === directory && cached.metadata === metadata) return cached.content;
  const original = originalSources.get(doc);
  if (original) {
    const content = original.metadata === metadata ? original.content : replaceNativeMetadata(original.content, metadata);
    encoded.set(doc, { directory, metadata, content }); return content;
  }
  const records = [NATIVE_DOCUMENT_HEADER];
  if (Object.keys(metadata).length) records.push(`@meta ${JSON.stringify(metadata)}`);
  doc.forEach(block => {
    const raw = errorRecord(block);
    if (raw !== undefined) { records.push(raw); return; }
    if (NATIVE_CHILD_CONTAINERS.has(block.type.name)) {
      records.push(`@block ${nodeJson(block, directory, true)}`);
      block.forEach(child => records.push(errorRecord(child) ?? `@child ${encodeFrame(child, directory)}`));
    } else records.push(`@block ${encodeFrame(block, directory)}`);
  });
  const content = records.join('\n') + '\n';
  encoded.set(doc, { directory, metadata, content });
  return content;
}
export function parseNativeNode(content: string, schema: Schema): Node {
  const decoded = decodeNativeFile(content), json = decoded.document;
  const validate = (value: JSONContent, mark = false) => {
    const spec = mark ? schema.marks[value.type ?? ''] : schema.nodes[value.type ?? ''];
    if (!spec) throw new Error(`文档包含不支持的${mark ? '样式' : '内容'}：${value.type}。原文件未修改。`);
    const fields = mark ? ['type', 'attrs'] : ['type', 'attrs', 'content', 'marks', 'text'];
    if (Object.keys(value).some(key => !fields.includes(key))
      || !mark && (value.type === 'text' ? value.content !== undefined : value.text !== undefined)) {
      throw new Error('文档包含当前版本不支持的内容字段，原文件未修改。');
    }
    if (value.attrs && Object.keys(value.attrs).some(key => !Object.hasOwn(spec.spec.attrs ?? {}, key))) {
      throw new Error('文档包含当前版本不支持的属性，原文件未修改。');
    }
  };
  const check = (node: NativeNode) => { visitNativeDocument(node, value => { validate(value); value.marks?.forEach(mark => validate(mark, true)); }); const parsed = schema.nodeFromJSON(node); parsed.check(); return node; };
  const recover = (node: NativeNode, child = false, parent?: string): NativeNode => {
    try { return check(node); } catch (error) {
      const origin = nativeNodeSource(node);
      const first = origin?.raw ?? `${child ? '@child' : '@block'} ${JSON.stringify(node)}`;
      const raw = !child && origin && NATIVE_CHILD_CONTAINERS.has(node.type ?? '')
        ? [first, ...(node.content ?? []).map(value => nativeNodeSource(value)?.raw ?? errorRecordJson(value) ?? `@child ${JSON.stringify(value)}`)].join('\n') : first;
      const placeholder = nativeError(raw, error instanceof Error ? error.message : '无法解析此内容。', origin?.line);
      return child ? nativeErrorChild(parent, placeholder) : placeholder;
    }
  };
  json.content = (json.content ?? []).map(block => {
    if (NATIVE_CHILD_CONTAINERS.has(block.type ?? '') && Array.isArray(block.content)) block.content = block.content.map(child => recover(child, true, block.type));
    return recover(block);
  });
  try { normalizeNativeStructure(json); } catch (error) {
    // Cross-block references are validated together. Preserve those records
    // locally while unrelated paragraphs continue to render.
    json.content = json.content.map(block => {
      let reference = ['annotationStore', 'documentPresentation'].includes(block.type ?? '');
      visitNativeDocument(block, node => { reference ||= node.attrs?.annotationId != null || !!node.marks?.some(mark => mark.type === 'annotationReference'); });
      if (!reference) return block;
      const raw = nativeNodeSource(block)?.raw ?? `@block ${JSON.stringify(block)}`;
      const children = NATIVE_CHILD_CONTAINERS.has(block.type ?? '') ? (block.content ?? []).map(child => nativeNodeSource(child)?.raw ?? `@child ${JSON.stringify(child)}`) : [];
      return nativeError([raw, ...children].join('\n'), String(error), nativeNodeSource(block)?.line);
    });
  }
  const doc = schema.nodeFromJSON(json);
  doc.check();
  originalSources.set(doc, { content, metadata: decoded.metadata });
  return doc;
}
function errorRecordJson(node: NativeNode): string | undefined {
  if (node.type === 'nativeError') return String(node.attrs?.raw ?? '');
  const error = node.type === 'tableRow' ? node.content?.[0]?.content?.[0] : node.content?.[1];
  return error?.type === 'nativeError' ? String(error.attrs?.raw ?? '') : undefined;
}
export function initializeEditorDocument(editor: Editor, content: string, format: RichDocumentFormat, directory = '', docKey?: string): void {
  formats.set(editor, format);
  directories.set(editor, directory);
  if (docKey) keys.set(editor, docKey);
  if (format === 'markdown') { initializeMarkdownContent(editor, content); return; }
  const parsed = parseNativeNode(content, editor.schema), original = originalSources.get(parsed)!;
  setEditorNativeMetadata(editor, original.metadata);
  const doc = withEditableTail(editor, parsed);
  originalSources.set(doc, original);
  editor.options.content = doc as unknown as Editor['options']['content'];
}
export function serializeEditorDocument(editor: Editor): string {
  return editorDocumentFormat(editor) === 'noteboard' ? serializeNativeNode(editor.state.doc, editorDocumentDirectory(editor), getEditorNativeMetadata(editor)) : serializeMarkdown(editor);
}
export function hasEditorDocumentChanged(editor: Editor, content: string): boolean {
  return editorDocumentFormat(editor) === 'noteboard'
    ? serializeEditorDocument(editor) !== content
    : hasMarkdownContentChanged(editor, content);
}
export function parseEditorDocument(editor: Editor, content: string, origin: 'sync' | 'history' = 'sync'): void {
  if (editorDocumentFormat(editor) === 'markdown') { parseMarkdown(editor, content, origin); return; }
  if (!hasEditorDocumentChanged(editor, content)) return;
  const doc = parseNativeNode(content, editor.schema);
  const original = originalSources.get(doc)!;
  setEditorNativeMetadata(editor, original.metadata);
  if (doc.eq(editor.state.doc)) { originalSources.set(editor.state.doc, original); return; }
  if (origin === 'history') reconcileDocumentHistory(editor, doc);
  else editor.chain().setContent(doc, { contentType: 'json' }).command(({ tr }) => {
    tr.setMeta('addToHistory', false).setMeta('noteboard-document-replacement', origin);
    return true;
  }).run();
  originalSources.set(editor.state.doc, original);
}
