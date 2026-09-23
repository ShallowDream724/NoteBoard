import { renderMathMarkup } from './mathEngine';
import { MATH_BATCH_LIMITS, type MathWorkerRequest, type MathWorkerResponse } from './mathWorkerProtocol';

const reply = (message: MathWorkerResponse) => self.postMessage(message);
self.onmessage = async ({ data }: MessageEvent<MathWorkerRequest>) => {
  const started = performance.now();
  for (const [index, expression] of data.expressions.entries()) {
    const result = await renderMathMarkup(expression.latex, expression.displayMode);
    // Stream completed work without waiting for a main-thread round trip. This
    // identifies the exact unfinished expression if a later one stalls.
    const done = index === data.expressions.length - 1 || performance.now() - started >= MATH_BATCH_LIMITS.milliseconds;
    reply({ batchId: data.batchId, id: expression.id, result, ...(done ? { done: true as const } : {}) });
    if (done) return;
  }
  reply({ batchId: data.batchId, done: true });
};
