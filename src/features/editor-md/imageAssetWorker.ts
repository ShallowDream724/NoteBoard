import { prepareImageSources } from './imageAssetSource';

let receive: ((source: string) => void) | undefined;
self.onmessage = async ({ data }: MessageEvent<{ type: 'prepare'; source: string; format: 'noteboard' | 'markdown' } | { type: 'stored'; source: string }>) => {
  if (data.type === 'stored') { receive?.(data.source); receive = undefined; return; }
  try {
    const result = await prepareImageSources(data.source, data.format, async source => {
      let bytes: ArrayBuffer | undefined, mime = '';
      if (/^data:/i.test(source)) {
        const response = await fetch(source);
        mime = response.headers.get('content-type')?.split(';')[0] ?? '';
        bytes = await response.arrayBuffer();
      }
      return new Promise<string>(resolve => {
        receive = resolve;
        self.postMessage({ type: 'asset', source: bytes ? '' : source, bytes, mime }, { transfer: bytes ? [bytes] : [] });
      });
    });
    self.postMessage({ type: 'result', result });
  } catch (error) { self.postMessage({ type: 'error', error: error instanceof Error ? error.message : String(error) }); }
};
