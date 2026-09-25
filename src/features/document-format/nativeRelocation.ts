import { decodeNativeDocument, encodeNativeDocument, readNativeMetadata, type NativeMetadata } from '../../core/nativeDocument';
import { rebaseDocumentReferences } from '../../core/documentReferences';
import { sameKey } from '../explorer/pathUtils';
import { markdownLinkPath, parentDirectory, relativeDocumentPath } from './nativeLink';

/** Final synchronous identity boundary for input arriving during Save As I/O.
 * The ordinary snapshot uses a Worker; this preserves any last pending input. */
export function relocatePendingNativeSource(source: string, from: string, target: string, receipt: NativeMetadata): string {
  const document = decodeNativeDocument(source);
  rebaseDocumentReferences(document, from.startsWith('untitled:') ? '' : parentDirectory(from));
  let metadata = readNativeMetadata(source);
  const link = markdownLinkPath(from, metadata);
  const writtenLink = markdownLinkPath(target, receipt);
  if (link && metadata.markdown) {
    metadata = { ...metadata, markdown: {
      ...metadata.markdown,
      ...(writtenLink && sameKey(link, writtenLink) ? { baselineHash: receipt.markdown!.baselineHash, projectionVersion: receipt.markdown!.projectionVersion } : {}),
      path: relativeDocumentPath(target, link),
    } };
  }
  return encodeNativeDocument(document, metadata);
}
