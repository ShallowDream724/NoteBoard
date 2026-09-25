import type { JSONContent } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export interface AnnotationRecord { id: string; node: ProseMirrorNode; pos: number }
export interface AnnotationAnchor { id: string; from: number; to: number; block: boolean }

export function annotationId(value: unknown): string | null {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : null;
}
export function newAnnotationId(): string { return `note_${globalThis.crypto.randomUUID().replaceAll('-', '')}`; }

export function collectAnnotations(doc: ProseMirrorNode): Map<string, AnnotationRecord> {
  const records = new Map<string, AnnotationRecord>();
  doc.forEach((node, pos) => {
    if (node.type.name !== 'annotationStore') return;
    node.forEach((body, offset) => {
      const id = annotationId(body.attrs.id);
      if (id && !records.has(id)) records.set(id, { id, node: body, pos: pos + offset + 1 });
    });
  });
  return records;
}

export function annotationAnchors(doc: ProseMirrorNode): AnnotationAnchor[] {
  const anchors: AnnotationAnchor[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'annotationStore' || node.type.name === 'annotationBody') return false;
    const id = annotationId(node.attrs.annotationId);
    if (id) anchors.push({ id, from: pos, to: pos + node.nodeSize, block: true });
    for (const mark of node.marks) {
      if (mark.type.name !== 'annotationReference') continue;
      const reference = annotationId(mark.attrs.id); if (!reference) continue;
      const previous = anchors.at(-1);
      if (previous?.id === reference && !previous.block && previous.to === pos) previous.to += node.nodeSize;
      else anchors.push({ id: reference, from: pos, to: pos + node.nodeSize, block: false });
    }
  });
  return anchors;
}
export function referencedAnnotationIds(doc: ProseMirrorNode): Set<string> {
  return new Set(annotationAnchors(doc).map(anchor => anchor.id));
}

/** Strip recursive notes from body drafts/imports while preserving ordinary rich content. */
export function annotationBodyContent(content: JSONContent[]): JSONContent[] {
  function clean(node: JSONContent): JSONContent | null {
    if (node.type === 'annotationStore' || node.type === 'annotationBody') return null;
    const attrs = node.attrs ? { ...node.attrs } : undefined;
    if (attrs) delete attrs.annotationId;
    return { ...node, ...(attrs ? { attrs } : {}),
      ...(node.marks ? { marks: node.marks.filter(mark => mark.type !== 'annotationReference') } : {}),
      ...(node.content ? { content: node.content.map(clean).filter((child): child is JSONContent => child !== null) } : {}),
    };
  }
  const result = content.map(clean).filter((node): node is JSONContent => node !== null);
  return result.length ? result : [{ type: 'paragraph' }];
}

function jsonReferenceIds(json: JSONContent): Set<string> {
  const ids = new Set<string>();
  function visit(node: JSONContent) {
    if (node.type === 'annotationStore' || node.type === 'annotationBody') return;
    const block = annotationId(node.attrs?.annotationId); if (block) ids.add(block);
    for (const mark of node.marks ?? []) { const id = annotationId(mark.attrs?.id); if (mark.type === 'annotationReference' && id) ids.add(id); }
    node.content?.forEach(visit);
  }
  visit(json); return ids;
}
export function annotationBodiesForFragment(doc: ProseMirrorNode, fragment: JSONContent): JSONContent[] {
  const records = collectAnnotations(doc);
  return [...jsonReferenceIds(fragment)].flatMap(id => records.has(id) ? [records.get(id)!.node.toJSON()] : []);
}

/** Call once on a self-contained clipboard document, after attaching its referenced bodies. */
export function remapAnnotationIds(json: JSONContent, createId = newAnnotationId): JSONContent {
  const ids = new Map<string, string>();
  function remap(value: unknown) {
    const id = annotationId(value); if (!id) return null;
    if (!ids.has(id)) ids.set(id, createId());
    return ids.get(id)!;
  }
  function visit(node: JSONContent): JSONContent {
    const attrs = node.attrs ? { ...node.attrs } : undefined;
    if (attrs && node.type === 'annotationBody') attrs.id = remap(attrs.id);
    if (attrs?.annotationId) attrs.annotationId = remap(attrs.annotationId);
    return { ...node, ...(attrs ? { attrs } : {}),
      ...(node.marks ? { marks: node.marks.map(mark => mark.type === 'annotationReference' ? { ...mark, attrs: { ...mark.attrs, id: remap(mark.attrs?.id) } } : { ...mark }) } : {}),
      ...(node.content ? { content: node.content.map(visit) } : {}),
    };
  }
  return visit(json);
}
