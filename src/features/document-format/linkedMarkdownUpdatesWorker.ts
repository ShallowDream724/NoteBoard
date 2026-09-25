import { decodeNativeFile, encodeNativeDocument, replaceNativeMetadata } from '../../core/nativeDocument';
import { mergeLinkedMarkdownTrees } from './linkedMarkdownUpdatesMerge';
import type { LinkedWorkerRequest, LinkedWorkerResult } from './linkedMarkdownUpdatesWorkerClient';

self.onmessage = ({ data }: MessageEvent<LinkedWorkerRequest>) => {
  let result: LinkedWorkerResult;
  try {
    const baseline = decodeNativeFile(data.baselineSource), local = decodeNativeFile(data.currentSource), projection = decodeNativeFile(data.projectedNative), external = decodeNativeFile(data.externalNative);
    if ([baseline, local, projection, external].some(decoded => decoded.diagnostics.length) || !local.metadata.markdown) {
      result = { kind: 'invalid', message: '文档包含尚未修复的内容，已保留当前原生文档。' };
    } else {
      const merged = mergeLinkedMarkdownTrees(baseline.document, local.document, projection.document, external.document, data.accepted);
      if (merged.kind === 'conflict') result = merged;
      else {
        const metadata = { ...local.metadata, markdown: { ...local.metadata.markdown, baselineHash: data.externalHash } };
        const content = merged.kind === 'merged' ? encodeNativeDocument(merged.document, metadata) : replaceNativeMetadata(data.currentSource, metadata);
        result = { kind: merged.kind, content, patches: merged.patches, changedBlocks: merged.changedBlocks };
      }
    }
  } catch (error) { result = { kind: 'invalid', message: error instanceof Error ? error.message : '文档合并失败，已保留当前内容。' }; }
  self.postMessage(result);
};
