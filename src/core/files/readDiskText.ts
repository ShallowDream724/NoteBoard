import { readDocument } from '../ipc/commands';
import type { DocumentPayload, Encoding, ExpectedDisk } from '../ipc/types';

/** Honor a manually chosen decoder and still handle a file replaced in a new encoding. */
export async function readDiskText(path: string, encodingOverride?: Encoding | null, maxReadBytes?: number) {
  if (encodingOverride) {
    try { return await readDocument(path, maxReadBytes, encodingOverride); }
    catch { /* The replacement file may declare or require a different decoder. */ }
  }
  return maxReadBytes === undefined ? readDocument(path) : readDocument(path, maxReadBytes);
}

export function expectedDiskFromPayload({ content, encoding, mtime, size }: DocumentPayload): ExpectedDisk | undefined {
  if (content === null) return;
  return { content, encoding, mtime, size };
}
