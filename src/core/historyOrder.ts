// Document edits and file operations share an order within this window.
// A slow disk operation reserves its place on start and commits it on success.
let order = 0;
const edits = { document: 0, workspace: 0 };
const workspaceEditListeners = new Set<() => void>();
type Domain = keyof typeof edits;

export function nextHistoryOrder(): number { return ++order; }
export function getHistoryOrder(): number { return order; }
export function lastHistoryEdit(domain: Domain): number { return edits[domain]; }
export function markHistoryEdit(domain: Domain, editOrder: number): void {
  if (editOrder <= edits[domain]) return;
  edits[domain] = editOrder;
  if (domain === 'workspace') for (const listener of workspaceEditListeners) {
    try { listener(); }
    catch (error) { console.error('工作区历史监听失败:', error); }
  }
}

export function subscribeWorkspaceHistoryEdit(listener: () => void): () => void {
  workspaceEditListeners.add(listener);
  return () => { workspaceEditListeners.delete(listener); };
}
