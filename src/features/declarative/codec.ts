import type { JSONContent } from '@tiptap/core';
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import { resolveAuthoring } from './resolve';
import { authoringSpans, normalizeAuthoringSpanPaths } from './spans';
import { writeAuthoring, type WrittenAuthoring } from './write';
import type { AuthoringParseResult } from './types';
import { maskAuthoringInline } from './syntax';
import { rememberParsedAuthoring, serializeBoundAuthoring } from './sourceCache';
export { rememberAuthoringSource, inheritAuthoringSource, hasAuthoringSource, serializeBoundAuthoring } from './sourceCache';

export interface AuthoringManager { parse(source: string): JSONContent; serialize?(document: JSONContent): string; instance?: import('marked').Marked | typeof import('marked').marked }
const originals = new WeakMap<object, (source: string) => JSONContent>();
const hooked = new WeakSet<object>();
export function parseAuthoringWith(source: string, manager: AuthoringManager, schema?: Schema): AuthoringParseResult {
  if (manager.instance && !hooked.has(manager.instance)) { manager.instance.use({ hooks: { emStrongMask: maskAuthoringInline } }); hooked.add(manager.instance); }
  const parse = originals.get(manager) ?? manager.parse.bind(manager);
  const parsed = parse(source), resolved = resolveAuthoring(source, parsed, schema);
  let document = resolved.document;
  if (schema) { try { document = schema.nodeFromJSON(document).toJSON() as JSONContent; } catch { /* Recovery diagnostics retain the editable source. */ } }
  const spans = manager.instance ? normalizeAuthoringSpanPaths(resolved.document, document, authoringSpans(resolved, parsed, source, manager.instance as typeof import('marked').marked, parse)) : [];
  const result = { document, diagnostics: resolved.diagnostics, spans };
  rememberParsedAuthoring(result, source, next => parseAuthoringWith(next, manager, schema));
  return result;
}
const authoredNodes = new Set(['imageCollection', 'disclosure', 'annotationStore', 'authoringRaw']);
const markdownMarks = new Set(['bold', 'italic', 'strike', 'code', 'link', 'highlight']);
const markdownAttributes: Record<string, readonly string[]> = {
  heading: ['level'], orderedList: ['start'], codeBlock: ['language'], taskItem: ['checked'],
  mathInline: ['latex', 'delimiter'], mathBlock: ['latex', 'delimiter'],
  mermaidBlock: ['code'], plantumlBlock: ['code'], infographicBlock: ['code'],
  image: ['src', 'alt', 'title'], githubAlert: ['kind'], tableCell: ['align'], tableHeader: ['align'],
};
function hasExtraAttributes(attrs: JSONContent['attrs'], allowed: readonly string[], defaults?: Record<string, { default?: unknown }>) {
  return Object.entries(attrs ?? {}).some(([key, value]) =>
    !allowed.includes(key) && JSON.stringify(value) !== JSON.stringify(defaults?.[key]?.default));
}
function needsAuthoring(node: JSONContent, schema?: Schema): boolean {
  const type = node.type ?? '';
  return authoredNodes.has(type)
    || hasExtraAttributes(node.attrs, markdownAttributes[type] ?? [], schema?.nodes[type]?.spec.attrs)
    || !!node.marks?.some(mark => !markdownMarks.has(mark.type)
      || hasExtraAttributes(mark.attrs, mark.type === 'link' ? ['href', 'title'] : [], schema?.marks[mark.type]?.spec.attrs))
    || !!node.content?.some(child => needsAuthoring(child, schema));
}
const listTypes = new Set(['orderedList', 'bulletList', 'taskList']);
/** Render each block with its own grammar. A single rich block must not change
 * ordinary emphasis, tables or punctuation in the rest of a Markdown file. */
function markdownWriter(manager: AuthoringManager, schema: Schema | undefined, serialize: (node: JSONContent) => string) {
  const parse = originals.get(manager)!;
  function read(source: string): PMNode | null {
    try { return schema!.nodeFromJSON(resolveAuthoring(source, parse(source), schema).document); }
    catch { return null; }
  }
  function join(children: JSONContent[], rendered: string[]): string {
    const parts: string[] = [];
    for (const [index, node] of children.entries()) {
      const previous = children[index - 1];
      if (listTypes.has(node.type ?? '') && listTypes.has(previous?.type ?? '')) parts.push('<!-- noteboard-list-boundary -->');
      const source = rendered[index];
      parts.push(!source && node.type === 'paragraph' && previous?.type === 'paragraph' && !previous.content?.length ? '&nbsp;' : source);
    }
    return parts.join('\n\n');
  }
  return (json: JSONContent): string => {
    if (json.type !== 'doc') return needsAuthoring(json, schema) ? writeAuthoring(json, schema).text : serialize(json);
    const children = json.content ?? [], authored = children.map(node => needsAuthoring(node, schema));
    const rendered = children.map((node, i) => {
      if (authored[i]) return writeAuthoring(node, schema).text;
      // A block bypasses the legacy document-wide styles footer. The table
      // renderer supplies its own outer line breaks, which join already adds.
      const raw = serialize(node);
      return node.type === 'table' ? raw.replace(/^\n|\n$/g, '') : raw;
    });
    const source = join(children, rendered);
    if (!schema || authored.every(Boolean)) return source;
    // Verify the whole candidate once. Ordinary large documents do not pay
    // for a fresh Markdown lexer and schema conversion for every paragraph.
    const expected = schema.nodeFromJSON(json), candidate = read(source);
    if (candidate?.eq(expected)) return source;
    let start = 0, end = expected.childCount, candidateEnd = candidate?.childCount ?? 0;
    while (start < end && start < candidateEnd && expected.child(start).eq(candidate!.child(start))) start++;
    while (end > start && candidateEnd > start && expected.child(end - 1).eq(candidate!.child(candidateEnd - 1))) { end--; candidateEnd--; }
    for (let i = start; i < end; i++) {
      if (authored[i] || candidate?.childCount === expected.childCount && candidate.child(i).eq(expected.child(i))) continue;
      const own = read(rendered[i]);
      if (own?.childCount !== 1 || !own.firstChild!.eq(expected.child(i))) rendered[i] = writeAuthoring(children[i], schema).text;
    }
    return join(children, rendered);
  };
}
/** Pure adapter: no editor facade import, and no effect on separate export managers. */
export function installAuthoringCodec(manager: AuthoringManager, schema?: Schema) {
  if (originals.has(manager)) return;
  originals.set(manager, manager.parse.bind(manager));
  const serialize = manager.serialize?.bind(manager);
  manager.parse = source => parseAuthoringWith(source, manager, schema).document;
  if (serialize) manager.serialize = markdownWriter(manager, schema, serialize);
}
export function serializeAuthoring(doc: PMNode): WrittenAuthoring { return serializeBoundAuthoring(doc) ?? writeAuthoring(doc.toJSON() as JSONContent, doc.type.schema); }
export function serializeAuthoringJSON(json: JSONContent, schema?: Schema): WrittenAuthoring { return writeAuthoring(json, schema); }
