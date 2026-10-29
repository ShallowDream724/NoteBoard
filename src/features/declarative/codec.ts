import type { JSONContent } from '@tiptap/core';
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import { resolveAuthoring } from './resolve';
import { authoringSpans, normalizeAuthoringSpanPaths } from './spans';
import { writeAuthoring, type WrittenAuthoring } from './write';
import type { AuthoringParseResult } from './types';
import { maskAuthoringInline } from './syntax';
import { rememberParsedAuthoring, serializeBoundAuthoring } from './sourceCache';
export { rememberAuthoringSource, inheritAuthoringSource, hasAuthoringSource } from './sourceCache';

export interface AuthoringManager { parse(source: string): JSONContent; serialize?(document: JSONContent): string; instance?: import('marked').Marked | typeof import('marked').marked }
const originals = new WeakMap<object, (source: string) => JSONContent>();
const hooked = new WeakSet<object>();
export function parseAuthoringWith(source: string, manager: AuthoringManager, schema?: Schema): AuthoringParseResult {
  if (manager.instance && !hooked.has(manager.instance)) { manager.instance.use({ hooks: { emStrongMask: maskAuthoringInline } }); hooked.add(manager.instance); }
  const parsed = (originals.get(manager) ?? manager.parse.bind(manager))(source), resolved = resolveAuthoring(source, parsed, schema);
  let document = resolved.document;
  if (schema) { try { document = schema.nodeFromJSON(document).toJSON() as JSONContent; } catch { /* Recovery diagnostics retain the editable source. */ } }
  const spans = manager.instance ? normalizeAuthoringSpanPaths(resolved.document, document, authoringSpans(resolved.document, source, manager.instance as typeof import('marked').marked, resolved.records)) : [];
  const result = { document, diagnostics: resolved.diagnostics, spans };
  rememberParsedAuthoring(result, source, next => parseAuthoringWith(next, manager, schema));
  return result;
}
function needsAuthoring(node: JSONContent, schema?: Schema): boolean {
  return ['imageCollection', 'disclosure', 'annotationStore', 'authoringRaw'].includes(node.type ?? '')
    || !!node.marks?.some(mark => !['bold', 'italic', 'strike', 'code', 'link'].includes(mark.type) || Object.entries(mark.attrs ?? {}).some(([key, value]) => !(mark.type === 'link' && ['href', 'title'].includes(key)) && JSON.stringify(value) !== JSON.stringify(schema?.marks[mark.type]?.spec.attrs?.[key]?.default)))
    || !!node.attrs && Object.entries(node.attrs).some(([key, value]) => !['heading:level', 'orderedList:start', 'codeBlock:language', 'mathInline:latex', 'mathInline:delimiter', 'mathBlock:latex', 'mathBlock:delimiter', 'mermaidBlock:code', 'plantumlBlock:code', 'infographicBlock:code', 'image:src', 'image:alt', 'image:title', 'taskItem:checked', 'link:href'].includes(`${node.type}:${key}`) && JSON.stringify(value) !== JSON.stringify(schema?.nodes[node.type ?? '']?.spec.attrs?.[key]?.default))
    || !!node.content?.some(child => needsAuthoring(child, schema));
}
/** Pure adapter: no editor facade import, and no effect on separate export managers. */
export function installAuthoringCodec(manager: AuthoringManager, schema?: Schema) {
  if (originals.has(manager)) return;
  originals.set(manager, manager.parse.bind(manager));
  const serialize = manager.serialize?.bind(manager);
  manager.parse = source => parseAuthoringWith(source, manager, schema).document;
  if (serialize) manager.serialize = json => needsAuthoring(json, schema) ? writeAuthoring(json, schema).text : serialize(json);
}
export function serializeAuthoring(doc: PMNode): WrittenAuthoring { return serializeBoundAuthoring(doc) ?? writeAuthoring(doc.toJSON() as JSONContent, doc.type.schema); }
export function serializeAuthoringJSON(json: JSONContent, schema?: Schema): WrittenAuthoring { return writeAuthoring(json, schema); }
