// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it('converts Markdown in the real worker entry without browser window events or nested workers', async () => {
  const postMessage = vi.fn();
  const scope = { postMessage, onmessage: undefined as undefined | ((event: { data: unknown }) => Promise<void>) };
  const nestedWorker = vi.fn(() => { throw new Error('unexpected nested worker'); });
  vi.stubGlobal('self', scope); vi.stubGlobal('Worker', nestedWorker);
  for (const name of ['window', 'document', 'DOMParser']) vi.stubGlobal(name, undefined);
  await import('../../src/features/export/documentWorker');
  expect(typeof window.addEventListener).toBe('undefined');
  await scope.onmessage!({ data: { type: 'convert', markdown: '# Export\n\n```js\nconst value = 42;\n```\n\n$x^2$', title: 'test', directory: '', format: 'html' } });
  const message = postMessage.mock.calls.at(-1)?.[0];
  expect(message?.type, JSON.stringify(message)).toBe('result');
  expect(message.result.html).toContain('hljs-keyword');
  expect(message.result.html).toContain('katex');
  expect(message.result.html).toContain('Export');
  expect(nestedWorker).not.toHaveBeenCalled();
});

it.each(['md', 'pandoc', 'standalone-html', 'html'])('decodes NB source inside the worker for %s and preserves broken source blocks', async format => {
  const postMessage = vi.fn();
  const scope = { postMessage, onmessage: undefined as undefined | ((event: { data: unknown }) => Promise<void>) };
  vi.stubGlobal('self', scope);
  for (const name of ['window', 'document', 'DOMParser']) vi.stubGlobal(name, undefined);
  const { encodeNativeDocument } = await import('../../src/core/nativeDocument');
  const source = encodeNativeDocument({ type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'NativeWorkerBody' }] },
    { type: 'nativeError', attrs: { raw: '@broken source fragment', message: 'Malformed record' } },
  ] });
  await import('../../src/features/export/documentWorker');
  await scope.onmessage!({ data: { type: 'convert', inputFormat: 'noteboard', markdown: source, title: 'Native', directory: '', format } });
  const message = postMessage.mock.calls.at(-1)?.[0];
  expect(message?.type, JSON.stringify(message)).toBe('result');
  const output = typeof message.result === 'string' ? message.result : message.result.html;
  expect(output).toContain('NativeWorkerBody');
  expect(output).toContain('@broken source fragment');
  expect(output).not.toContain('#!noteboard');
});

it('keeps NB-looking Markdown prose as Markdown when its input format is explicit', async () => {
  const postMessage = vi.fn();
  const scope = { postMessage, onmessage: undefined as undefined | ((event: { data: unknown }) => Promise<void>) };
  vi.stubGlobal('self', scope);
  for (const name of ['window', 'document', 'DOMParser']) vi.stubGlobal(name, undefined);
  await import('../../src/features/export/documentWorker');
  await scope.onmessage!({ data: { type: 'convert', inputFormat: 'markdown', markdown: '#!noteboard 1\n\nOrdinary prose', title: 'Example', directory: '', format: 'md' } });
  expect(postMessage.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'result', result: expect.stringContaining('#!noteboard 1') });
});
