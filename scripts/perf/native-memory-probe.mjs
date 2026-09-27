// Read-only CDP metrics for the launched WebView. Requires Node's built-in WebSocket.
const targets = await (await fetch(`http://127.0.0.1:${process.argv[2]}/json/list`, { signal: AbortSignal.timeout(10_000) })).json();
const page = targets.find(target => target.type === 'page');
if (!page) throw new Error('No WebView page target');
const socket = new globalThis.WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let nextId = 0;
const pending = new Map();
socket.addEventListener('message', event => { const data = JSON.parse(event.data); const callback = pending.get(data.id); if (callback) { pending.delete(data.id); data.error ? callback.reject(data.error) : callback.resolve(data.result); } });
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
try {
  const heap = await send('Runtime.getHeapUsage');
  const dom = await send('Memory.getDOMCounters');
  const metrics = await send('Runtime.evaluate', { expression: `JSON.stringify({url:location.href,width:innerWidth,height:innerHeight,dpr:devicePixelRatio,images:document.images.length,canvas:document.querySelectorAll('canvas').length,iframes:document.querySelectorAll('iframe').length})`, returnByValue: true });
  console.log(JSON.stringify({ heap, dom, page: JSON.parse(metrics.result.value) }));
} finally { socket.close(); }
