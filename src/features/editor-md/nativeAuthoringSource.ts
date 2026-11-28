import type { Node, Schema } from '@tiptap/pm/model';
import type { NativeMetadata } from '../../core/nativeDocument';
import { normalizeNativeStructure } from '../../core/nativeDocumentStructure';
import { rebaseDocumentReferences } from '../../core/documentReferences';
import { parseAuthoringWith, rememberAuthoringSource } from '../declarative/codec';
import { documentParser } from './documentExtensions';

/** Map authored text to the same order and resource references as the NB frames. */
export function parseNativeAuthoring(source: string, directory: string) {
  const { manager, schema } = documentParser();
  return parseAuthoringWith(source, manager, schema, parsed => {
    const original = parsed.document.content ?? [];
    normalizeNativeStructure(parsed.document);
    rebaseDocumentReferences(parsed.document, directory);
    if (original === parsed.document.content) return parsed;
    const positions = new Map(parsed.document.content?.map((node, index) => [node, index]));
    return { ...parsed, spans: parsed.spans.map(span => {
      const index = positions.get(original[span.path[0]]);
      return index === undefined ? span : { ...span, path: [index, ...span.path.slice(1)] };
    }) };
  });
}

export function storedNativeAuthoring(metadata: NativeMetadata): string | undefined {
  const entry = metadata.authoring;
  return entry?.version === 1 && typeof entry.source === 'string' ? entry.source : undefined;
}

/** Frames remain readable independently, including when another writer edited them. */
export function restoreNativeAuthoring(doc: Node, metadata: NativeMetadata, directory: string, schema: Schema) {
  const source = storedNativeAuthoring(metadata);
  if (source === undefined) return false;
  try {
    const parsed = parseNativeAuthoring(source, directory);
    const projected = schema.nodeFromJSON(parsed.document);
    const tail = doc.lastChild;
    const withTail = metadata.authoring?.syntheticTail === true && tail?.type.name === 'paragraph' && tail.eq(tail.type.create())
      && doc.childCount === projected.childCount + 1 && doc.content.cut(0, doc.content.size - tail.nodeSize).eq(projected.content);
    if (projected.eq(doc) || withTail) {
      rememberAuthoringSource(doc, parsed);
      return true;
    }
  } catch { /* Fall back to a source projection freshly generated from the frames. */ }
  return false;
}
