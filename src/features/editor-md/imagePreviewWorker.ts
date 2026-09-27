import { createDisplayImagePreview } from './imagePreviewEngine';

self.onmessage = async ({ data }: MessageEvent<{ id: number; src: string; width: number }>) => {
  try {
    const response = await fetch(data.src, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('Image source unavailable');
    const result = await createDisplayImagePreview(await response.blob(), data.width);
    self.postMessage({ id: data.id, result });
  } catch { self.postMessage({ id: data.id, result: null }); }
};
