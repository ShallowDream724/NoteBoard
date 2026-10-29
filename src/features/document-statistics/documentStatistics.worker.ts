import { countDocumentSource, type StatisticsSourceKind } from './documentSourceStatistics';

self.onmessage = async (event: MessageEvent<{ id: number; content: string; kind: StatisticsSourceKind }>) => {
  const { id, content, kind } = event.data;
  try { self.postMessage({ id, value: await countDocumentSource(content, kind) }); }
  catch { self.postMessage({ id, value: null }); }
};
