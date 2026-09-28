// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); });

let workerCase = 0;
// Re-run the entry in a fresh scope while keeping its grammar dependencies
// together. Resetting only Vite modules leaves external ProseMirror registries
// alive and incorrectly registers every custom Step a second time.
async function startWorker() {
  await import(/* @vite-ignore */ `../../src/features/export/documentWorker.ts?case=${workerCase++}`);
}

it('preserves completed task checks in the production worker DOM', async () => {
  const postMessage = vi.fn();
  const scope = { postMessage, onmessage: undefined as undefined | ((event: { data: unknown }) => Promise<void>) };
  vi.stubGlobal('self', scope);
  for (const name of ['window', 'document', 'DOMParser']) vi.stubGlobal(name, undefined);
  await startWorker();
  await scope.onmessage!({ data: { type: 'convert', markdown: '- [x] 已完成\n- [ ] 待完成', title: 'Tasks', directory: '', format: 'html' } });
  const message = postMessage.mock.calls.at(-1)?.[0];
  expect(message?.type, JSON.stringify(message)).toBe('result');
  const root = document.createElement('div'); root.innerHTML = message.result.html;
  const tasks = root.querySelectorAll('li[data-type="taskItem"]');
  expect(tasks[0].querySelector('.export-task-check')?.getAttribute('aria-label')).toBe('已完成');
  expect(tasks[0].querySelector('.export-task-check > path')).not.toBeNull();
  expect(tasks[1].querySelector('.export-task-check path')).toBeNull();
});

it('converts Markdown in the real worker entry without browser window events or nested workers', async () => {
  const postMessage = vi.fn();
  const scope = { postMessage, onmessage: undefined as undefined | ((event: { data: unknown }) => Promise<void>) };
  const nestedWorker = vi.fn(() => { throw new Error('unexpected nested worker'); });
  vi.stubGlobal('self', scope); vi.stubGlobal('Worker', nestedWorker);
  for (const name of ['window', 'document', 'DOMParser']) vi.stubGlobal(name, undefined);
  await startWorker();
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
  await startWorker();
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
  await startWorker();
  await scope.onmessage!({ data: { type: 'convert', inputFormat: 'markdown', markdown: '#!noteboard 1\n\nOrdinary prose', title: 'Example', directory: '', format: 'md' } });
  expect(postMessage.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'result', result: expect.stringContaining('#!noteboard 1') });
});

it('waits for one real-browser diagram batch before serializing its final print HTML', async () => {
  const postMessage = vi.fn();
  const scope = { postMessage, onmessage: undefined as undefined | ((event: { data: unknown }) => Promise<void>) };
  vi.stubGlobal('self', scope);
  for (const name of ['window', 'document', 'DOMParser']) vi.stubGlobal(name, undefined);
  await startWorker();
  const converting = scope.onmessage!({ data: { type: 'convert', markdown: '```mermaid\ngraph LR\nA-->B\n```', title: 'Diagram', directory: '', format: 'html' } });
  await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: 'diagrams', requests: [{ kind: 'mermaid', code: 'graph LR\nA-->B' }] }));
  expect(postMessage.mock.calls.some(call => call[0].type === 'result')).toBe(false);
  await scope.onmessage!({ data: { type: 'diagram-results', results: [{ html: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><text>Final graphic</text></svg>' }] } });
  await converting;
  const output = postMessage.mock.calls.at(-1)?.[0];
  expect(output.type).toBe('result'); expect(output.result.html).toContain('Final graphic');
  expect(output.result.html).not.toContain('A--&gt;B');
  expect(output.result.html).not.toContain('exportSourceOnly');
});
