import { renderMath, type MathRendering } from './mathRendering';

type Request = { latex: string; display: boolean; done: (value: MathRendering) => void };
const pending = new Map<string, Request>();
let running = false;
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

/** Only nearby, mounted formulas enqueue work. Leaving the viewport cancels it. */
export function queueMath(id: string, request: Request): () => void {
  pending.set(id, request);
  if (!running) void flush();
  return () => { if (pending.get(id) === request) pending.delete(id); };
}

async function flush() {
  running = true;
  try {
    while (pending.size) {
      await frame();
      const start = performance.now();
      while (pending.size && performance.now() - start < 6) {
        const [id, request] = pending.entries().next().value!;
        const result = await renderMath(request.latex, request.display);
        if (pending.get(id) === request) { pending.delete(id); request.done(result); }
      }
    }
  } finally { running = false; }
}
