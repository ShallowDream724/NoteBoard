import { renderMath, type MathRendering } from './mathRendering';
import { mathMarkupNodeCount } from './mathLimits';

type Request = { latex: string; display: boolean; priority?: () => number; isScrolling?: () => boolean; done: (value: MathRendering) => void };
interface Entry { id: string; request: Request; controller: AbortController; started: boolean; result?: MathRendering; nodes: number; rank: number }
interface Retirement { readyAt: number; done: () => void }
const pending = new Map<string, Entry>();
const retirements = new Map<string, Retirement>();
const waiting = [new Set<Entry>(), new Set<Entry>(), new Set<Entry>()];
const ready = [new Set<Entry>(), new Set<Entry>(), new Set<Entry>()];
const MAX_IN_FLIGHT = 16;
const FOREGROUND_RESERVE = 4;
const MAX_READY_CHARACTERS = 256 * 1024;
const readyByRank = [0, 0, 0];
// HTML parsing time excludes the browser's following layout. Charge estimated
// DOM work too; one large expression is indivisible and admitted alone.
const FRAME_NODES = 1000;
const FRAME_MILLISECONDS = 3;
let inFlight = 0, readyCharacters = 0, frame = 0, dirtyPriorities = false;
let retry: ReturnType<typeof setTimeout> | undefined;
const rank = (request: Request) => Math.max(0, Math.min(2, request.priority?.() ?? 1));
function schedule() { if (!frame) frame = requestAnimationFrame(flush); }
export function refreshMathQueue() { dirtyPriorities = true; if (pending.size || retirements.size) schedule(); }

function remove(entry: Entry) {
  if (pending.get(entry.id) !== entry) return;
  pending.delete(entry.id); waiting[entry.rank].delete(entry); ready[entry.rank].delete(entry);
  if (entry.result) { readyCharacters -= entry.result.html.length; readyByRank[entry.rank] -= entry.result.html.length; }
  else if (entry.started) inFlight--;
}

/** Owners cancel independently; a result never writes into a replaced view. */
export function queueMath(id: string, request: Request): () => void {
  const previous = pending.get(id);
  if (previous) { remove(previous); previous.controller.abort(); }
  const entry: Entry = { id, request, controller: new AbortController(), started: false, nodes: 0, rank: rank(request) };
  pending.set(id, entry); waiting[entry.rank].add(entry); schedule();
  return () => { remove(entry); entry.controller.abort(); schedule(); };
}

/** Only resident-budget eviction uses this path; leaving the viewport alone
 * does not destroy a formula. Mutations share one frame scheduler. */
export function retireMath(id: string, done: () => void): () => void {
  const entry = { readyAt: performance.now() + 180, done };
  retirements.set(id, entry); schedule();
  return () => { if (retirements.get(id) === entry) retirements.delete(id); };
}

function refreshPriorities() {
  if (!dirtyPriorities) return;
  dirtyPriorities = false;
  // Once per viewport notification batch, never once per item removed.
  for (const entry of pending.values()) {
    const next = rank(entry.request); if (next === entry.rank) continue;
    if (entry.result) { readyByRank[entry.rank] -= entry.result.html.length; readyByRank[next] += entry.result.html.length; }
    const buckets = entry.result ? ready : !entry.started ? waiting : undefined;
    buckets?.[entry.rank].delete(entry); entry.rank = next; buckets?.[next].add(entry);
  }
}
function prepare() {
  for (let priority = 0; priority < waiting.length; priority++) {
    const bucket = waiting[priority];
    const limit = priority === 0 ? MAX_IN_FLIGHT : MAX_IN_FLIGHT - FOREGROUND_RESERVE;
    // Deferred background markup must never lock out a newly visible formula.
    while (bucket.size && inFlight < limit && (priority === 0 ? readyByRank[0] : readyCharacters) < MAX_READY_CHARACTERS) {
      const entry = bucket.values().next().value!; bucket.delete(entry);
      entry.started = true; inFlight++;
      void renderMath(entry.request.latex, entry.request.display, { signal: entry.controller.signal, priority: entry.request.priority }).then(result => {
        if (pending.get(entry.id) !== entry) return;
        inFlight--; entry.result = result; entry.nodes = Math.max(1, mathMarkupNodeCount(result.html));
        readyCharacters += result.html.length; readyByRank[entry.rank] += result.html.length; ready[entry.rank].add(entry); schedule();
      }, () => { remove(entry); schedule(); });
    }
  }
}
function flush() {
  frame = 0; clearTimeout(retry); retry = undefined; refreshPriorities(); prepare();
  const start = performance.now(); let nodes = 0, mutations = 0, deferred = false;
  for (const bucket of ready) {
    for (const entry of bucket) {
      const scrolling = entry.request.isScrolling?.() ?? false;
      if (scrolling && (entry.nodes > FRAME_NODES || entry.result!.html.length > 32_768 || entry.rank === 2)) { deferred = true; continue; }
      if (mutations && (nodes + entry.nodes > FRAME_NODES || performance.now() - start >= FRAME_MILLISECONDS)) break;
      remove(entry); entry.request.done(entry.result!); nodes += entry.nodes; mutations++;
    }
    if (nodes >= FRAME_NODES || performance.now() - start >= FRAME_MILLISECONDS) break;
  }
  const now = performance.now(); let nextRetirement = Infinity;
  for (const [id, entry] of retirements) {
    if (entry.readyAt <= now && mutations < 16 && performance.now() - start < FRAME_MILLISECONDS) {
      retirements.delete(id); entry.done(); mutations++;
    } else nextRetirement = Math.min(nextRetirement, entry.readyAt);
  }
  prepare();
  if ((ready.some(bucket => bucket.size) && (!deferred || mutations > 0)) || nextRetirement <= now) schedule();
  else {
    const delay = Math.min(deferred ? 80 : Infinity, nextRetirement - now);
    if (Number.isFinite(delay)) retry = setTimeout(() => { retry = undefined; schedule(); }, delay);
  }
}
