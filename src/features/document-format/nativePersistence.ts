import { expectedDiskFromPayload, readDiskText } from '../../core/files/readDiskText';
import { normalizeDocumentEol } from '../../core/documentText';
import { readNativeMetadata, replaceNativeMetadata, type NativeMetadata } from '../../core/nativeDocument';
import { documentTextHash, saveNativeBundle, type NativeSaveRequest, type NativeSaveResult } from '../../core/nativeDocumentIO';
import type { Document } from '../../stores/documentStore';
import { useDocumentStore } from '../../stores/documentStore';
import { prepareTextExport } from '../export/documentConversion';
import { markdownLinkPath, parentDirectory, MARKDOWN_PROJECTION_VERSION } from './nativeLink';
import { prepareDocumentImageAssets } from '../editor-md/prepareImageAssets';
import type { PreparedImageSources } from '../editor-md/imageAssetSource';

export interface PreparedNativeSave {
  request: NativeSaveRequest;
  content: string;
  metadata: NativeMetadata;
  imageAssets?: { captured: string; prepared: PreparedImageSources };
}

type NativeSaveDocument = Pick<Document, 'key' | 'baselineContent' | 'persistedContent' | 'encoding' | 'eol'>;
type NativeWriteFormat = Pick<NativeSaveRequest, 'eol' | 'expectedDisk' | 'expectedHash'>;

/** A projection is produced only at an I/O boundary, never on an editor transaction. */
export async function prepareNativeSave(
  doc: NativeSaveDocument, source: string, imageTarget = doc.key, format: NativeWriteFormat = {},
): Promise<PreparedNativeSave> {
  const captured = source;
  const formatOnly = imageTarget === doc.key && format.expectedDisk && !format.expectedHash && doc.persistedContent != null
    && normalizeDocumentEol(source) === normalizeDocumentEol(doc.persistedContent);
  const assets = formatOnly ? null : await prepareDocumentImageAssets(source, 'noteboard', imageTarget, imageTarget !== doc.key);
  source = assets?.content ?? source;
  let metadata = readNativeMetadata(source);
  const request: NativeSaveRequest = {
    path: doc.key, content: source,
    encoding: 'utf8',
    eol: format.eol ?? doc.eol,
    expectedHash: format.expectedHash ?? (doc.persistedContent == null ? undefined : await documentTextHash(doc.persistedContent)),
    expectedDisk: format.expectedDisk,
    expectedEncoding: format.expectedDisk?.encoding ?? (doc.persistedContent == null ? undefined : doc.encoding),
    createOnly: doc.persistedContent == null,
  };
  // A byte-format conversion of an otherwise unchanged NB has no Markdown projection to save.
  if (formatOnly) return { request, content: source, metadata };
  const link = markdownLinkPath(doc.key, metadata);
  if (link && metadata.markdown) {
    if (useDocumentStore.getState().getDocument(link)) {
      const { flushDocument } = await import('../session/documentSession');
      await flushDocument(link, 'save');
    }
    const linkedOpen = useDocumentStore.getState().getDocument(link);
    if (linkedOpen?.isDirty) throw new Error('关联 Markdown 有未保存的修改，请先保存或关闭它。');
    const disk = await readDiskText(link, linkedOpen?.encodingOverride);
    if (disk.content == null) throw new Error('无法读取关联 Markdown，未执行保存。');
    const baselineMetadata = doc.baselineContent == null ? metadata : readNativeMetadata(doc.baselineContent);
    const previous = markdownLinkPath(doc.key, baselineMetadata) === link ? baselineMetadata.markdown : metadata.markdown;
    const { getAcceptedLinkedMarkdownHash, checkLinkedMarkdownUpdates } = await import('./linkedMarkdownUpdates');
    const expectedHash = getAcceptedLinkedMarkdownHash(doc.key, link, source) ?? previous?.baselineHash;
    if (!expectedHash || await documentTextHash(disk.content) !== expectedHash) {
      await checkLinkedMarkdownUpdates(doc.key);
      throw new Error('关联 Markdown 已在外部修改，请先处理更新提示，再保存。');
    }
    const directory = parentDirectory(doc.key) === parentDirectory(link) ? '' : parentDirectory(doc.key);
    const markdown = await prepareTextExport(source, 'md', directory, undefined, 'noteboard');
    metadata = { ...metadata, markdown: { ...metadata.markdown, baselineHash: await documentTextHash(markdown), projectionVersion: MARKDOWN_PROJECTION_VERSION } };
    request.markdown = {
      path: link, content: markdown, expectedHash, encoding: disk.encoding, eol: disk.eol,
      expectedDisk: expectedDiskFromPayload(disk), expectedEncoding: disk.encoding,
    };
    request.content = replaceNativeMetadata(source, metadata);
  }
  return { request, content: request.content, metadata, ...(assets?.references.length ? { imageAssets: { captured, prepared: assets } } : {}) };
}

export async function persistNativeDocument(doc: NativeSaveDocument, source: string, format?: NativeWriteFormat): Promise<PreparedNativeSave & { result: NativeSaveResult }> {
  const prepared = await prepareNativeSave(doc, source, doc.key, format);
  const result = await saveNativeBundle(prepared.request);
  return { ...prepared, result };
}
