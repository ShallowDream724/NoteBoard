import { renderMath, type MathRendering } from './mathRendering';

type Request = { latex: string; display: boolean; priority?: () => number; isScrolling?: () => boolean; done: (value: MathRendering) => void };
interface Entry { request: Request; controller: AbortController; started: boolean; result?: MathRendering }
const pending = new Map<string, Entry>();
let frame = 0;
let retry: ReturnType<typeof setTimeout> | undefined;
const priority = (entry: Entry) => entry.request.priority?.() ?? 1;
function schedule() { if (!frame) frame = requestAnimationFrame(flush); }
export function refreshMathQueue() { if (pending.size) schedule(); }

/** Render completion never blocks the frame queue. Both worker work and a ready
 * DOM commit disappear when their owner leaves the nearby viewport. */
export function queueMath(id: string, request: Request): () => void {
  pending.get(id)?.controller.abort();
  const entry: Entry = { request, controller: new AbortController(), started: false };
  pending.set(id, entry); schedule();
  return () => {
    if (pending.get(id) === entry) pending.delete(id);
    entry.controller.abort(); schedule();
  };
}
function prepare() {
  // A newly visible expression can reclaim preparation slots held by overscan.
  let waitingPriority = Infinity;
  for (const entry of pending.values()) if (!entry.started) waitingPriority = Math.min(waitingPriority, priority(entry));
  for (const entry of pending.values()) if (entry.started && priority(entry) > waitingPriority) {
    entry.controller.abort(); entry.controller = new AbortController();
    entry.started = false; entry.result = undefined;
  }
  // Bound both worker lead and completed markup retained before DOM commits.
  let count = 0; for (const entry of pending.values()) if (entry.started) count++;
  while (count < 3) {
    let next: [string, Entry] | undefined;
    for (const item of pending) if (!item[1].started && (!next || priority(item[1]) < priority(next[1]))) next = item;
    if (!next) return;
    const [id, entry] = next, controller = entry.controller; entry.started = true; count++;
    void renderMath(entry.request.latex, entry.request.display, { signal: controller.signal, priority: entry.request.priority }).then(result => {
      if (pending.get(id) !== entry || entry.controller !== controller) return;
      entry.result = result; schedule();
    }, () => { if (pending.get(id) === entry && entry.controller === controller) pending.delete(id); schedule(); });
  }
}
function flush() {
  frame = 0; prepare();
  const start = performance.now(); let inserted = 0, markup = 0;
  while (inserted < 2 && markup < 32_768 && performance.now() - start < 3) {
    let next: [string, Entry] | undefined;
    for (const item of pending) {
      const entry = item[1]; if (!entry.result) continue;
      // A single large native HTML parse cannot be preempted. Commit it only
      // once scrolling rests; it remains cancellable while it is deferred.
      if (entry.result.html.length > 32_768 && entry.request.isScrolling?.()) continue;
      if (!next || priority(entry) < priority(next[1])) next = item;
    }
    if (!next) break;
    const [id, entry] = next; pending.delete(id);
    const result = entry.result!;
    entry.request.done(result); inserted++; markup += result.html.length;
  }
  prepare();
  const ready = [...pending.values()].filter(entry => entry.result);
  if (ready.some(entry => entry.result!.html.length <= 32_768 || !entry.request.isScrolling?.())) schedule();
  else if (ready.length && retry === undefined) retry = setTimeout(() => { retry = undefined; schedule(); }, 80);
}
