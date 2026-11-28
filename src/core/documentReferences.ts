import type { JSONContent } from '@tiptap/core';
import { visitNativeDocument } from './nativeDocument';
import { resolveRelativeDocPath } from './documentPath';

export function rebaseDocumentReference(value: unknown, baseDirectory: string): unknown {
  return baseDirectory && typeof value === 'string' && value && !/^(?:[a-z][a-z0-9+.-]*:|[\\/#])/i.test(value)
    ? resolveRelativeDocPath(baseDirectory, value).replace(/\\/g, '/') : value;
}

/** Export copies may live anywhere. Keep local references resolving to their
 * original files rather than silently interpreting them in the new directory.
 * This mutates only a detached export copy, never the editor's document. */
export function rebaseDocumentReferences(document: JSONContent, baseDirectory: string): void {
  if (!baseDirectory) return;
  visitNativeDocument(document, node => {
    if (node.type === 'image' && node.attrs) node.attrs.src = rebaseDocumentReference(node.attrs.src, baseDirectory);
    for (const mark of node.marks ?? []) if (mark.type === 'link' && mark.attrs) mark.attrs.href = rebaseDocumentReference(mark.attrs.href, baseDirectory);
    if (Array.isArray(node.attrs?.captionContent)) for (const item of node.attrs.captionContent) {
      for (const mark of item?.marks ?? []) if (mark.type === 'link' && mark.attrs) mark.attrs.href = rebaseDocumentReference(mark.attrs.href, baseDirectory);
    }
  });
}
