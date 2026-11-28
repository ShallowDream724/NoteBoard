import { tokenizeEditorCode } from './codeHighlightEngine';

self.onmessage = async ({ data }: MessageEvent<{ id: number; code: string; language: string }>) => {
  try { self.postMessage({ id: data.id, tokens: await tokenizeEditorCode(data.code, data.language) }); }
  catch { self.postMessage({ id: data.id, tokens: [], unavailable: true }); }
};
