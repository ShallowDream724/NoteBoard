/** One lazy module and serial queue for editor views and document export.
 * Mermaid needs a real browser SVG layout engine; it must not run in a DOM shim. */
type Theme = 'default' | 'dark' | 'forest';
type RenderTask = { id: number; code: string; theme: Theme; signal: AbortSignal; resolve(svg: string): void; reject(error: Error): void };
const queue: RenderTask[] = [];
let processing = false, nextId = 0;
let loading: Promise<typeof import('mermaid')> | undefined;

async function processQueue(): Promise<void> {
  if (processing) return;
  const task = queue.shift(); if (!task) return;
  processing = true;
  let host: HTMLDivElement | undefined;
  try {
    if (task.signal.aborted) { task.resolve(''); return; }
    loading ??= import('mermaid').catch(error => { loading = undefined; throw error; });
    const mermaid = await loading;
    if (task.signal.aborted) { task.resolve(''); return; }
    mermaid.default.initialize({ startOnLoad: false, securityLevel: 'strict', theme: task.theme });
    // A measurable, hidden host prevents Mermaid's temporary/error SVGs from
    // flashing in the editor. Every success, failure and cancellation releases it.
    host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:0;width:1000px;visibility:hidden;pointer-events:none';
    document.body.append(host);
    const { svg } = await mermaid.default.render(`nb-mermaid-${task.id}`, task.code, host);
    task.resolve(task.signal.aborted ? '' : svg);
  } catch (error) { task.reject(error instanceof Error ? error : new Error(String(error))); }
  finally { host?.remove(); processing = false; if (queue.length) void processQueue(); }
}

export function renderMermaidSvg(code: string, theme: Theme = 'default', signal = new AbortController().signal): Promise<string> {
  return new Promise((resolve, reject) => {
    const abort = () => { const index = queue.indexOf(task); if (index >= 0) queue.splice(index, 1); task.resolve(''); };
    const task: RenderTask = { id: nextId++, code, theme, signal,
      resolve: svg => { signal.removeEventListener('abort', abort); resolve(svg); },
      reject: error => { signal.removeEventListener('abort', abort); reject(error); } };
    if (signal.aborted) { resolve(''); return; }
    signal.addEventListener('abort', abort, { once: true }); queue.push(task); void processQueue();
  });
}

export function resetMermaidRenderer(): void {
  loading = undefined;
  for (const task of queue.splice(0)) task.resolve('');
  // An active renderer retains the serial lock until its own finally block.
}
