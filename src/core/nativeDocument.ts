import type { JSONContent } from '@tiptap/core';

/** Disk format and editor grammar have independent versions. Never guess a
 * newer format or silently discard an unknown field while saving it back. */
export const NATIVE_DOCUMENT_FORMAT = 'noteboard';
export const NATIVE_DOCUMENT_VERSION = 1;
export const NATIVE_DOCUMENT_EXTENSIONS = ['nb', 'nbdoc'];
export const DEFAULT_NATIVE_EXTENSION = NATIVE_DOCUMENT_EXTENSIONS[0];
export interface NativeDocument {
  format: typeof NATIVE_DOCUMENT_FORMAT;
  version: typeof NATIVE_DOCUMENT_VERSION;
  document: JSONContent;
}
export function decodeNativeDocument(content: string): JSONContent {
  let value: unknown;
  try { value = JSON.parse(content); } catch { throw new Error('此 NoteBoard 文档不是有效的 JSON，原文件未修改。'); }
  const envelope = value as Partial<NativeDocument> | null;
  if (!envelope || envelope.format !== NATIVE_DOCUMENT_FORMAT || envelope.version !== NATIVE_DOCUMENT_VERSION
    || !envelope.document || envelope.document.type !== 'doc'
    || Object.keys(envelope).some(key => !['format', 'version', 'document'].includes(key))) {
    throw new Error('无法读取此 NoteBoard 文档的格式或版本，原文件未修改。');
  }
  return envelope.document;
}
export function encodeNativeDocument(document: JSONContent): string {
  return JSON.stringify({ format: NATIVE_DOCUMENT_FORMAT, version: NATIVE_DOCUMENT_VERSION, document });
}
export const EMPTY_NATIVE_DOCUMENT = encodeNativeDocument({ type: 'doc', content: [{ type: 'paragraph' }] });

/** Lightweight tree traversal shared by asset management; no editor is loaded. */
export function visitNativeDocument(document: JSONContent, visit: (node: JSONContent) => void): void {
  const pending = [document];
  while (pending.length) {
    const node = pending.pop()!;
    visit(node);
    if (node.content) for (let index = node.content.length - 1; index >= 0; index--) pending.push(node.content[index]);
  }
}
