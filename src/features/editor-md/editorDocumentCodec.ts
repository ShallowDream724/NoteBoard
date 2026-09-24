import type { Editor, JSONContent } from '@tiptap/core';
import type { Node, Schema } from '@tiptap/pm/model';
import { decodeNativeDocument, encodeNativeDocument, visitNativeDocument } from '../../core/nativeDocument';
import { hasMarkdownContentChanged, initializeMarkdownContent, parseMarkdown, serializeMarkdown, withEditableTail } from './serialize';
import { rebaseDocumentReferences } from '../../core/documentReferences';

export type RichDocumentFormat = 'markdown' | 'noteboard';
const formats = new WeakMap<Editor, RichDocumentFormat>();
const directories = new WeakMap<Editor, string>();
const encoded = new WeakMap<Node, { directory: string; content: string }>();

export function editorDocumentFormat(editor: Editor): RichDocumentFormat { return formats.get(editor) ?? 'markdown'; }
export function editorDocumentDirectory(editor: Editor): string { return directories.get(editor) ?? ''; }
export function serializeNativeNode(doc: Node, directory = ''): string {
  const cached = encoded.get(doc);
  if (cached?.directory === directory) return cached.content;
  const json = doc.toJSON();
  rebaseDocumentReferences(json, directory);
  const content = encodeNativeDocument(json);
  encoded.set(doc, { directory, content });
  return content;
}
export function parseNativeNode(content: string, schema: Schema): Node {
  const json = decodeNativeDocument(content);
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
  visitNativeDocument(json, node => { validate(node); node.marks?.forEach(mark => validate(mark, true)); });
  const doc = schema.nodeFromJSON(json);
  doc.check();
  return doc;
}
export function initializeEditorDocument(editor: Editor, content: string, format: RichDocumentFormat, directory = ''): void {
  formats.set(editor, format);
  directories.set(editor, directory);
  if (format === 'markdown') { initializeMarkdownContent(editor, content); return; }
  editor.options.content = withEditableTail(editor, parseNativeNode(content, editor.schema)) as unknown as Editor['options']['content'];
}
export function serializeEditorDocument(editor: Editor): string {
  return editorDocumentFormat(editor) === 'noteboard' ? serializeNativeNode(editor.state.doc, editorDocumentDirectory(editor)) : serializeMarkdown(editor);
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
  if (doc.eq(editor.state.doc)) return;
  editor.chain().setContent(doc, { contentType: 'json' }).command(({ tr }) => {
    tr.setMeta('addToHistory', false).setMeta('noteboard-document-replacement', origin);
    return true;
  }).run();
}
