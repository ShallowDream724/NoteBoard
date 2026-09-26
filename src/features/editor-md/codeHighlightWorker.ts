import { tokenizeCode } from './codeHighlightEngine';

self.onmessage = async ({ data }: MessageEvent<{ id: number; code: string; language: string }>) => {
  try { self.postMessage({ id: data.id, tokens: await tokenizeCode(data.code, data.language) }); }
  catch { self.postMessage({ id: data.id, tokens: [], unavailable: true }); }
};
