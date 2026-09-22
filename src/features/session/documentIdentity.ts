import { getEditorCapabilities, getDocumentRevision } from '../../core/editor/editorRegistry';
import { useDocumentStore } from '../../stores/documentStore';
import { useWindowStore } from '../../stores/windowStore';
import { flushDocument, drainDocumentWrites, getSessionGeneration, isClosing, migrateDocumentSession, submitCapturedContent } from './documentSession';
import { flushPendingSourceSnapshot, flushPendingVisualSnapshot } from '../editor-md/visualSnapshot';
import { getBaseline, removeBaseline } from '../editor-md/serialize';
import { moveDocumentHistory } from '../history/documentHistory';
import { drainStagingWrites, migrateStagedDocumentKey } from '../staging/stagingManager';
import { saveViewState, takeViewState } from './editorSuspension';
import { kindFromPath } from '../../core/docKind';

export interface DocumentIdentityLease {
  key: string;
  generation: number;
  release(): void;
}

/** Reuse window-transfer protection: blur first so IME finishes before capture. */
export function protectDocumentIdentity(key: string): DocumentIdentityLease {
  const tabs = useWindowStore.getState();
  if (tabs.isWindowClosing || tabs.isTransferring(key) || isClosing(key)) throw new Error('文档正在关闭或迁移，请稍后重试');
  const generation = getSessionGeneration(key);
  tabs.enterTransfer(key);
  try { (globalThis.document?.activeElement as HTMLElement | null)?.blur(); } catch { /* no DOM */ }
  return { key, generation, release: () => useWindowStore.getState().exitTransfer(key) };
}

export function assertDocumentIdentity(lease: DocumentIdentityLease): void {
  if (getSessionGeneration(lease.key) !== lease.generation || isClosing(lease.key)) {
    throw new Error('文档会话已改变，路径迁移已取消');
  }
}

/** Synchronous final boundary; must run before advancing the source generation. */
export function materializeIdentityPending(key: string): void {
  flushPendingSourceSnapshot(key);
  flushPendingVisualSnapshot(key);
}

/** Flush authority and drain old-path I/O without saving unsaved content. */
export async function prepareDocumentIdentity(lease: DocumentIdentityLease): Promise<void> {
  assertDocumentIdentity(lease);
  const capabilities = getEditorCapabilities(lease.key);
  const captured = await flushDocument(lease.key, 'transfer');
  assertDocumentIdentity(lease);
  if (captured) submitCapturedContent(lease.key, captured, lease.generation);
  materializeIdentityPending(lease.key);
  if (capabilities && !captured && capabilities.hasUnconfirmedInput?.() !== false) {
    throw new Error('无法取得编辑器的最新正文，路径迁移已取消');
  }
  const { prepareImageAssetsForIdentity } = await import('../editor-md/imageAssetLifecycle');
  await prepareImageAssetsForIdentity(lease.key);
  assertDocumentIdentity(lease);
  await drainDocumentWrites(lease.key);
  assertDocumentIdentity(lease);
  await drainStagingWrites();
  assertDocumentIdentity(lease);
  // Inputs queued while the barriers awaited still belong to the old generation.
  materializeIdentityPending(lease.key);
}

/** All post-I/O identity changes are synchronous, followed by one tab publication.
 * The new editor mounts from the captured store; old capabilities are not rekeyed. */
export function commitDocumentIdentity(from: string, to: string, publish: () => void): void {
  if (from === to) { publish(); return; }
  materializeIdentityPending(from);
  let view: unknown = null;
  if (kindFromPath(from) === kindFromPath(to)) {
    try { view = getEditorCapabilities(from)?.captureViewState?.() ?? takeViewState(from); } catch { /* view state is optional */ }
  } else takeViewState(from);
  const baseline = getBaseline(from).getBaseline();
  moveDocumentHistory(from, to);
  migrateStagedDocumentKey(from, to);
  migrateDocumentSession(from, to);
  if (baseline !== null) getBaseline(to).setBaseline(baseline);
  removeBaseline(from);
  if (view != null) saveViewState(to, view);
  publish();
}

/** Capture once more after a caller's final await, then commit without another await. */
export async function refreshDocumentIdentity(lease: DocumentIdentityLease): Promise<void> {
  assertDocumentIdentity(lease);
  const before = getDocumentRevision(lease.key);
  const captured = await flushDocument(lease.key, 'transfer');
  assertDocumentIdentity(lease);
  if (captured) submitCapturedContent(lease.key, captured, lease.generation);
  materializeIdentityPending(lease.key);
  // A mounted adapter owns the mirror commit. No fallback may replace it with an
  // earlier snapshot captured before a drain or native ownership call.
  if (getDocumentRevision(lease.key) < before) throw new Error('文档版本已改变，路径迁移已取消');
  if (!useDocumentStore.getState().getDocument(lease.key)) throw new Error('文档会话已结束');
}
