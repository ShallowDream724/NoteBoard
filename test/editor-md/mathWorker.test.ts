import { afterEach, expect, it, vi } from 'vitest';
import type { MathWorkerRequest, MathWorkerResponse } from '../../src/features/editor-md/mathWorkerProtocol';

const { render } = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('../../src/features/editor-md/mathEngine', () => ({ renderMathMarkup: render }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetModules(); });

it('streams completed expressions and returns the unfinished tail after its time budget', async () => {
  let elapsed = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
  render.mockImplementation(async (latex: string) => { elapsed += 5; return { html: latex }; });
  const messages: MathWorkerResponse[] = [];
  const scope = { postMessage: (message: MathWorkerResponse) => messages.push(message), onmessage: undefined as undefined | ((event: { data: MathWorkerRequest }) => Promise<void>) };
  vi.stubGlobal('self', scope);
  await import('../../src/features/editor-md/mathWorker');
  await scope.onmessage!({ data: { batchId: 7, expressions: [1, 2, 3].map(id => ({ id, latex: String(id), displayMode: false })) } });
  expect(messages).toEqual([{ batchId: 7, id: 1, result: { html: '1' } }, { batchId: 7, id: 2, result: { html: '2' }, done: true }]);
  expect(render.mock.calls.map(call => call[0])).toEqual(['1', '2']);
});
