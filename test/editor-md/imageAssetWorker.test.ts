import { afterEach, expect, it, vi } from 'vitest';
import type { PreparedImageSources } from '@/features/editor-md/imageAssetSource';
afterEach(() => vi.unstubAllGlobals());
it('the actual worker decodes data images once, transfers bytes and rewrites all references', async () => {
  const messages: Array<{ type: string; result?: PreparedImageSources; bytes?: ArrayBuffer; mime?: string }> = [];
  const runtime = { onmessage: null as ((event: MessageEvent) => Promise<void>) | null, postMessage: vi.fn((message, options) => {
    messages.push(message);
    if (message.type === 'asset') {
      expect(new Uint8Array(message.bytes)).toEqual(new Uint8Array([0, 1, 2]));
      expect(options.transfer).toEqual([message.bytes]);
      queueMicrotask(() => { void runtime.onmessage?.({ data: { type: 'stored', source: './img/test.png' } } as MessageEvent); });
    }
  }) };
  vi.stubGlobal('self', runtime);
  await import('@/features/editor-md/imageAssetWorker');
  const image = { type: 'image', attrs: { src: 'data:image/png;base64,AAEC' } };
  await runtime.onmessage!({ data: { type: 'prepare', format: 'noteboard', source: '#!noteboard 1\n@block ' + JSON.stringify({ type: 'disclosure', content: [image, image] }) + '\n' } } as MessageEvent);
  expect(messages.filter(message => message.type === 'asset')).toHaveLength(1);
  const result = messages.find(message => message.type === 'result')!.result!;
  expect(result.content.match(/\.\/img\/test\.png/g)).toHaveLength(2);
  expect(result.content).not.toContain('data:image/');
});
