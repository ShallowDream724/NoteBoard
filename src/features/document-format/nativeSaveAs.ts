import * as ipc from '../../core/ipc/commands';
import { replaceNativeMetadata } from '../../core/nativeDocument';
import { documentTextHash, saveNativeBundle } from '../../core/nativeDocumentIO';
import type { Document } from '../../stores/documentStore';
import { prepareTextExport } from '../export/documentConversion';
import { prepareNativeSave } from './nativePersistence';
import { markdownLinkPath, parentDirectory, relativeDocumentPath } from './nativeLink';

/** Save As moves the editing identity; links keep pointing to the same Markdown. */
export async function saveNativeAs(doc: Document, target: string, source: string) {
  const prepared = await prepareNativeSave(doc, source);
  const markdown = markdownLinkPath(doc.key, prepared.metadata);
  if (markdown && prepared.metadata.markdown) prepared.metadata = { ...prepared.metadata, markdown: { ...prepared.metadata.markdown, path: relativeDocumentPath(target, markdown) } };
  const rebased = await prepareTextExport(source, 'noteboard', doc.key.startsWith('untitled:') ? '' : parentDirectory(doc.key), undefined, 'noteboard');
  prepared.content = replaceNativeMetadata(rebased, prepared.metadata);
  const exists = await ipc.pathExists(target);
  const baseline = exists.exists ? await ipc.readDocument(target) : null;
  if (baseline && baseline.content == null) throw new Error('无法读取目标文件，未执行另存为。');
  prepared.request = { ...prepared.request, path: target, content: prepared.content, createOnly: !exists.exists, expectedHash: baseline ? await documentTextHash(baseline.content!) : undefined };
  const result = await saveNativeBundle(prepared.request);
  return { ...prepared, result };
}
