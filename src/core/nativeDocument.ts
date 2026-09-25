/** Public NB semantic model. It deliberately has no editor-runtime dependency. */
export interface NativeMark { type: string; attrs?: Record<string, unknown> }
export interface NativeNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: NativeNode[];
  marks?: NativeMark[];
  text?: string;
  [field: string]: unknown;
}
export interface NativeMetadata {
  markdown?: { path: string; baselineHash: string; projectionVersion: number };
  /** Unknown namespaces are preserved; each must be a JSON object. */
  [namespace: string]: unknown;
}
export interface NativeDiagnostic { line: number; message: string; raw: string }
export const NATIVE_DOCUMENT_FORMAT = 'noteboard';
export const NATIVE_DOCUMENT_VERSION = 1;
export const NATIVE_DOCUMENT_HEADER = '#!noteboard 1';
export const NATIVE_DOCUMENT_EXTENSIONS = ['nb', 'nbdoc'];
export const DEFAULT_NATIVE_EXTENSION = NATIVE_DOCUMENT_EXTENSIONS[0];
export const NATIVE_CHILD_CONTAINERS = new Set(['table', 'bulletList', 'orderedList', 'taskList', 'annotationStore', 'imageCollection']);
const origins = new WeakMap<NativeNode, { raw: string; line: number }>();
export function nativeNodeSource(node: NativeNode): { raw: string; line: number } | undefined { return origins.get(node); }
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function validateShape(value: unknown): asserts value is NativeNode {
  const pending = [{ value, depth: 0 }];
  while (pending.length) {
    const { value: item, depth } = pending.pop()!;
    if (depth > 256 || !object(item) || typeof item.type !== 'string' || (item.attrs !== undefined && !object(item.attrs))
      || (item.text !== undefined && typeof item.text !== 'string') || (item.content !== undefined && !Array.isArray(item.content))
      || (item.marks !== undefined && (!Array.isArray(item.marks) || item.marks.some(mark => !object(mark) || typeof mark.type !== 'string' || mark.attrs !== undefined && !object(mark.attrs))))) throw new Error('内容节点结构无效或嵌套过深。');
    for (const child of item.content as unknown[] ?? []) pending.push({ value: child, depth: depth + 1 });
  }
}
function metadataValue(value: unknown): NativeMetadata {
  if (!object(value) || Object.entries(value).some(([key, entry]) => !/^[a-z][a-z0-9.-]*$/i.test(key) || !object(entry))) throw new Error('元数据命名空间必须是 JSON 对象。');
  const link = value.markdown;
  if (link !== undefined && (!object(link) || typeof link.path !== 'string' || !link.path.trim() || typeof link.baselineHash !== 'string'
    || !Number.isInteger(link.projectionVersion) || Number(link.projectionVersion) < 1)) throw new Error('Markdown 关联元数据不完整。');
  return value as NativeMetadata;
}
function* lines(source: string): Generator<{ raw: string; line: number; start: number; end: number }> {
  let start = 0, line = 1;
  while (start < source.length) {
    const boundary = source.indexOf('\n', start), end = boundary < 0 ? source.length : boundary + 1;
    yield { raw: source.slice(start, boundary < 0 ? end : boundary).replace(/\r$/, ''), line: line++, start, end };
    start = end;
  }
}
/** Header-only scan: never split or parse the document body. */
export function readNativeMetadata(source: string): NativeMetadata {
  for (const { raw, line } of lines(source)) {
    if (line === 1) { if (raw.replace(/^\uFEFF/, '') !== NATIVE_DOCUMENT_HEADER) return {}; continue; }
    if (!raw.trim()) continue;
    if (!raw.startsWith('@meta ')) return {};
    try { return metadataValue(JSON.parse(raw.slice(6))); } catch { return {}; }
  }
  return {};
}
/** Change only the metadata record. Body bytes (including invalid frames) survive. */
export function replaceNativeMetadata(source: string, metadata: NativeMetadata): string {
  metadataValue(metadata);
  const record = `@meta ${JSON.stringify(metadata)}`;
  for (const { raw, line, start, end } of lines(source)) {
    if (line === 1) {
      if (raw.replace(/^\uFEFF/, '') !== NATIVE_DOCUMENT_HEADER) throw new Error('无法更新缺少有效 NB 文档头的元数据。');
      continue;
    }
    if (!raw.trim()) continue;
    if (raw.startsWith('@meta ')) return source.slice(0, start) + record + (source.slice(start, end).endsWith('\n') ? (source.slice(start, end).endsWith('\r\n') ? '\r\n' : '\n') : '') + source.slice(end);
    return source.slice(0, start) + record + '\n' + source.slice(start);
  }
  return source + (source.endsWith('\n') ? '' : '\n') + record + '\n';
}
export function nativeError(raw: string, message: string, line?: number): NativeNode {
  return { type: 'nativeError', attrs: { raw, message, ...(line === undefined ? {} : { line }) } };
}
/** A failed child stays at the same row/item position in its container. */
export function nativeErrorChild(container: string | undefined, error: NativeNode): NativeNode {
  if (container === 'table') return { type: 'tableRow', content: [{ type: 'tableCell', content: [error] }] };
  if (container === 'bulletList' || container === 'orderedList' || container === 'taskList') return {
    type: container === 'taskList' ? 'taskItem' : 'listItem', content: [{ type: 'paragraph' }, error],
  };
  return error;
}
/** Return the original child record from a structural placeholder wrapper. */
export function nativeErrorRecord(node: NativeNode): string | undefined {
  if (node.type === 'nativeError' && typeof node.attrs?.raw === 'string') return node.attrs.raw;
  const error = node.type === 'tableRow' && node.content?.[0]?.content?.length === 1 && node.content.slice(1).every(cell => cell.content?.every(block => block.type === 'paragraph' && !block.content?.length))
    ? node.content[0].content[0] : ['listItem', 'taskItem'].includes(node.type ?? '') && node.content?.length === 2 && !node.content[0].content?.length ? node.content[1] : undefined;
  return error?.type === 'nativeError' && typeof error.attrs?.raw === 'string' && error.attrs.raw.startsWith('@child ') ? error.attrs.raw : undefined;
}
export function decodeNativeFile(source: string): { document: NativeNode; metadata: NativeMetadata; diagnostics: NativeDiagnostic[] } {
  const content: NativeNode[] = [], diagnostics: NativeDiagnostic[] = [];
  let metadata: NativeMetadata = {}, container: NativeNode | undefined, header = false, body = false, hasMeta = false;
  const fail = (raw: string, line: number, message: string, child = false) => {
    diagnostics.push({ raw, line, message });
    const error = nativeError(raw, message, line);
    if (child && container) (container.content ??= []).push(nativeErrorChild(container.type, error));
    else content.push(error);
  };
  for (const { raw, line } of lines(source)) {
    if (line === 1) {
      header = raw.replace(/^\uFEFF/, '') === NATIVE_DOCUMENT_HEADER;
      if (header) continue;
      fail(raw, line, '缺少或不支持 NB 文档头；原文已保留。');
      continue;
    }
    if (!raw.trim()) continue;
    if (raw.startsWith('@block ')) { container = undefined; body = true; }
    const child = raw.startsWith('@child ');
    try {
      if (raw.startsWith('@meta ') && !body && !hasMeta && header) { metadata = metadataValue(JSON.parse(raw.slice(6))); hasMeta = true; continue; }
      if (!raw.startsWith('@block ') && !child) throw new Error('无法识别此记录。每个块必须从 @block 开始。');
      if (child && !container) throw new Error('@child 前需要一个可分片的 @block 容器。');
      const value: unknown = JSON.parse(raw.slice(7));
      validateShape(value);
      const node = value as NativeNode;
      if (!child && NATIVE_CHILD_CONTAINERS.has(node.type!) && node.content?.length) throw new Error('容器 @block 只保存骨架；请把每行或每项写为独立 @child 记录。');
      origins.set(node, { raw, line });
      if (child) (container!.content ??= []).push(node);
      else { content.push(node); if (NATIVE_CHILD_CONTAINERS.has(node.type!)) container = node; }
    } catch (error) {
      fail(raw, line, error instanceof Error ? error.message : '无法解析此记录。', child);
      if (!child) container = undefined;
      body = true;
    }
  }
  if (!source) fail('', 1, '缺少 NB 文档头。');
  return { document: { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }, metadata, diagnostics };
}
export function decodeNativeDocument(source: string): NativeNode { return decodeNativeFile(source).document; }
export function encodeNativeDocument(document: NativeNode, metadata: NativeMetadata = {}): string {
  const records = [NATIVE_DOCUMENT_HEADER];
  if (Object.keys(metadata).length) { metadataValue(metadata); records.push(`@meta ${JSON.stringify(metadata)}`); }
  for (const block of document.content ?? []) {
    const raw = nativeErrorRecord(block);
    if (raw !== undefined) { records.push(raw); continue; }
    if (NATIVE_CHILD_CONTAINERS.has(block.type ?? '')) {
      const { content, ...skeleton } = block;
      records.push(`@block ${JSON.stringify(skeleton)}`);
      for (const child of content ?? []) records.push(nativeErrorRecord(child) ?? `@child ${JSON.stringify(child)}`);
    } else records.push(`@block ${JSON.stringify(block)}`);
  }
  return records.join('\n') + '\n';
}
export const EMPTY_NATIVE_DOCUMENT = encodeNativeDocument({ type: 'doc', content: [{ type: 'paragraph' }] });
export function visitNativeDocument(document: NativeNode, visit: (node: NativeNode) => void): void {
  const pending = [document];
  while (pending.length) { const node = pending.pop()!; visit(node); if (node.content) for (let index = node.content.length - 1; index >= 0; index--) pending.push(node.content[index]); }
}
