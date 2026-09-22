import { tokenizeCode } from './codeHighlightEngine';

self.onmessage = ({ data }: MessageEvent<{ id: number; code: string; language: string }>) => {
  self.postMessage({ id: data.id, tokens: tokenizeCode(data.code, data.language) });
};
