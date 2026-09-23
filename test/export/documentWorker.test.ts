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
