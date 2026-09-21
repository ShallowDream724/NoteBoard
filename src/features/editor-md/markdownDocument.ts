import { getSchema } from '@tiptap/core';
import { MarkdownManager } from '@tiptap/markdown';
import { buildExtensions } from './extensions';

/** Read-only consumers share the editor's Markdown grammar, without mounting an editor. */
export function parseMarkdownDocument(markdown: string) {
  const extensions = buildExtensions();
  const manager = new MarkdownManager({ extensions });
  const schema = getSchema(extensions);
  return schema.nodeFromJSON(manager.parse(markdown));
}
