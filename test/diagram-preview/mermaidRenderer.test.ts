import { expect, it, vi } from 'vitest';
import { renderMermaidSvg } from '../../src/features/diagram-preview/mermaidRenderer';

const engine = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock('mermaid', () => ({ default: engine }));

it('serializes editor/export renders, drops canceled queued work, and releases a failed render host', async () => {
  let fail!: (error: Error) => void;
  engine.render.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  engine.render.mockResolvedValueOnce({ svg: '<svg>Final result</svg>' });
  const first = renderMermaidSvg('broken', 'dark');
  const failure = expect(first).rejects.toThrow('Broken syntax');
  const cancel = new AbortController();
  const second = renderMermaidSvg('canceled', 'default', cancel.signal);
  const third = renderMermaidSvg('final', 'default');
  await vi.waitFor(() => expect(engine.render).toHaveBeenCalledOnce());
  cancel.abort(); expect(await second).toBe('');
  fail(new Error('Broken syntax')); await failure;
  expect(await third).toBe('<svg>Final result</svg>');
  expect(engine.render.mock.calls.map(call => call[1])).toEqual(['broken', 'final']);
  expect(engine.initialize.mock.calls.map(call => call[0].theme)).toEqual(['dark', 'default']);
  expect(document.body.children).toHaveLength(0);
});
