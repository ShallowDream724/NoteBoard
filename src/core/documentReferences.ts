import type { JSONContent } from '@tiptap/core';
import { visitNativeDocument } from './nativeDocument';
import { resolveRelativeDocPath } from './documentPath';

/** Export copies may live anywhere. Keep local references resolving to their
 * original files rather than silently interpreting them in the new directory.
 * This mutates only a detached export copy, never the editor's document. */
export function rebaseDocumentReferences(document: JSONContent, baseDirectory: string): void {
  if (!baseDirectory) return;
  const resolve = (value: unknown) => typeof value === 'string' && value && !/^(?:[a-z][a-z0-9+.-]*:|[\\/#])/i.test(value)
    ? resolveRelativeDocPath(baseDirectory, value).replace(/\\/g, '/') : value;
  visitNativeDocument(document, node => {
    if (node.type === 'image' && node.attrs) node.attrs.src = resolve(node.attrs.src);
    for (const mark of node.marks ?? []) if (mark.type === 'link' && mark.attrs) mark.attrs.href = resolve(mark.attrs.href);
  });
}
