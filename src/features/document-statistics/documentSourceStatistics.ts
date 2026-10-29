import { decodeNativeDocument } from '../../core/nativeDocument';
import { countDocumentText, countNativeDocument, type DocumentStatistics } from './documentStatistics';

export type StatisticsSourceKind = 'markdown' | 'noteboard' | 'code';
// Load the shared editing grammar only when source statistics need it. The
// caller runs this in an isolated worker, not on every caret movement.
let grammar: Promise<typeof import('../editor-md/documentExtensions')> | undefined;
export async function countDocumentSource(content: string, kind: StatisticsSourceKind): Promise<DocumentStatistics> {
  if (kind === 'noteboard') return countNativeDocument(decodeNativeDocument(content));
  if (kind === 'code') return countDocumentText(content);
  grammar ??= import('../../core/workerDocumentDom').then(({ installWorkerDocumentDom }) => {
    if (typeof document === 'undefined') installWorkerDocumentDom();
    return import('../editor-md/documentExtensions');
  });
  const { documentParser } = await grammar;
  return countNativeDocument(documentParser().manager.parse(content));
}
