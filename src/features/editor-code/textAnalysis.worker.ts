import { analyzeText, type TextAnalysisRequest } from './textAnalysis';

self.onmessage = async (event: MessageEvent<{ id: number; request: TextAnalysisRequest }>) => {
  const { id, request } = event.data;
  try {
    self.postMessage({ id, result: await analyzeText(request) });
  } catch (error) {
    self.postMessage({ id, result: { error: error instanceof Error ? error.message : String(error) } });
  }
};
