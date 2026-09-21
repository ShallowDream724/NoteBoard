import { renderMathMarkup } from './mathEngine';

self.onmessage = async ({ data }: MessageEvent<{ id: number; latex: string; displayMode: boolean }>) => {
  self.postMessage({ id: data.id, result: await renderMathMarkup(data.latex, data.displayMode) });
};
