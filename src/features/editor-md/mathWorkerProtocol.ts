import type { MathRendering } from './mathRendering';

/** A slice bounds queued source and priority latency; one expression can exceed
 * the soft time budget and remains subject to the main thread's hard deadline. */
export const MATH_BATCH_LIMITS = { expressions: 16, sourceCharacters: 8_192, milliseconds: 8 } as const;
export interface MathWorkerExpression { id: number; latex: string; displayMode: boolean }
export interface MathWorkerRequest { batchId: number; expressions: MathWorkerExpression[] }
export type MathWorkerResponse =
  | { batchId: number; id: number; result: MathRendering; done?: true }
  | { batchId: number; done: true };
