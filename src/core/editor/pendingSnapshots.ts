/** Synchronous save/identity barriers can reach pending edits after a view is
 * unmounted without loading an editor into the application shell. An editor
 * installs these handlers before it can create its first pending snapshot. */
interface Materializers {
  source(docKey: string): string | null;
  visual(docKey: string): string | null;
}
let handlers: Materializers | null = null;
export function registerPendingSnapshotMaterializers(value: Materializers): void { handlers = value; }
export function flushPendingSourceSnapshot(docKey: string): string | null { return handlers?.source(docKey) ?? null; }
export function flushPendingVisualSnapshot(docKey: string): string | null { return handlers?.visual(docKey) ?? null; }
