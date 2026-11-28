import { getHistoryOrder, lastHistoryEdit, markHistoryEdit, nextHistoryOrder } from '../../core/historyOrder';
import { copyPathIntoDirectoryWithReceipt, redoCopiedPath, releaseCopiedReceipts, undoCopiedPath } from '../../core/ipc/commands';
import { getEditorCapabilities } from '../../core/editor/editorRegistry';
import { useDocumentStore } from '../../stores/documentStore';
import { showToast } from '../../stores/toastStore';
import { useWindowStore } from '../../stores/windowStore';
import { markOpenDocumentDeleted } from '../external/missingFileGuard';
import { assertDocumentIdentity, prepareDocumentIdentity, protectDocumentIdentity, type DocumentIdentityLease } from '../session/documentIdentity';
import { refreshExplorerDirectory } from './explorerActions';
import { useExplorerStore } from './explorerStore';
import { isSubPath, normalizePath, parentDirectory } from './pathUtils';
import { renameOpenPath } from './renameOpenPath';

export interface ExplorerMove { from: string; to: string; directory: boolean }
type MoveEntry = ExplorerMove & { type: 'path'; identity: string };
type ImportEntry = { type: 'import'; path: string; receipt: string };
type Entry = MoveEntry | ImportEntry;
type OperationKind = 'move' | 'rename' | 'import';
type Direction = 'undo' | 'redo';
type Batch = { workspace: string; kind: OperationKind; order: number; entries: Entry[] };
type Replay = {
  batch: Batch;
  direction: Direction;
  startedAt: number;
  redoEpoch: number;
  oppositeOrder: number;
  result: Promise<boolean>;
  completed?: Batch;
  followUp?: Promise<boolean>;
  discardRemainder?: boolean;
};

const undoHistory: Batch[] = [];
const redoHistory: Batch[] = [];
const labels = { move: '移动', rename: '重命名', import: '导入' };
let pending: { batch: Batch; settled: Promise<void> } | undefined;
let applying: Replay | undefined;
let redoGeneration = 0;

function currentWorkspace(): string | undefined {
  const { root, workspaceRoot } = useExplorerStore.getState();
  if (!root) return undefined;
  return normalizePath(workspaceRoot && isSubPath(workspaceRoot, root) ? workspaceRoot : root).toLowerCase();
}

function latest(history: Batch[], workspace: string | undefined): Batch | undefined {
  if (!workspace) return;
  for (let index = history.length - 1; index >= 0; index--) {
    if (history[index].workspace === workspace) return history[index];
  }
}

function append(history: Batch[], batch: Batch): void {
  history.push(batch);
  if (history.length > 50) discardAt(history, 0);
}

function releaseEntries(entries: Entry[]): void {
  const receipts = entries.flatMap(entry => entry.type === 'import' ? [entry.receipt] : []);
  if (receipts.length) void releaseCopiedReceipts(receipts).catch(error => console.warn('导入撤销暂存清理失败:', error));
}

function discardAt(history: Batch[], index: number): void {
  const [batch] = history.splice(index, 1);
  releaseEntries(batch.entries);
}

const lastEdit = () => Math.max(lastHistoryEdit('workspace'), lastHistoryEdit('document'));

function pruneRedo(all = false): void {
  const after = lastEdit();
  for (let index = redoHistory.length - 1; index >= 0; index--) {
    const batch = redoHistory[index];
    if (!all && batch.order >= after) continue;
    if (applying?.direction === 'redo' && applying.batch === batch) applying.discardRemainder = true;
    else discardAt(redoHistory, index);
  }
}

export function clearExplorerRedo(): void {
  redoGeneration++;
  pruneRedo(true);
}

const reason = (error: unknown) => error instanceof Error ? error.message : String(error);
const filename = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

/** Reserve the user action's order synchronously, before any IPC can resolve. */
function record<T>(kind: OperationKind, perform: (entries: Entry[], markChanged: () => void) => Promise<T>): Promise<T> {
  const workspace = currentWorkspace();
  if (!workspace || pending || applying) return Promise.reject(new Error('正在处理其他文件操作，请稍候'));
  const batch: Batch = { workspace, kind, order: nextHistoryOrder(), entries: [] };
  const result = Promise.resolve().then(async () => {
    const summary = await perform(batch.entries, () => {
      markHistoryEdit('workspace', batch.order);
      pruneRedo();
    });
    if (batch.entries.length) append(undoHistory, batch);
    return summary;
  }).finally(() => { pending = undefined; });
  pending = { batch, settled: result.then(() => undefined, () => undefined) };
  return result;
}

export function moveExplorerEntries(plans: readonly ExplorerMove[], kind: 'move' | 'rename' = 'move') {
  return record(kind, async (entries, markChanged) => {
    let moved = 0;
    const failures: string[] = [];
    for (const plan of plans) {
      try {
        const identity = await renameOpenPath(plan.from, plan.to, plan.directory, {});
        if (moved++ === 0) markChanged();
        if (identity) entries.push({ ...plan, type: 'path', identity });
      } catch (error) {
        failures.push(reason(error));
      }
    }
    return { moved, undoable: entries.length, failures };
  });
}

export function importExplorerEntries(paths: readonly string[], directory: string) {
  return record('import', async (entries, markChanged) => {
    let copied = 0, firstCopy: string | undefined;
    const failures: string[] = [];
    for (const source of paths) {
      try {
        const copy = await copyPathIntoDirectoryWithReceipt(source, directory);
        if (copied++ === 0) markChanged();
        firstCopy ??= copy.path;
        if (copy.receipt) entries.push({ type: 'import', path: copy.path, receipt: copy.receipt });
      } catch (error) {
        failures.push(`${filename(source)}：${reason(error)}`);
      }
    }
    return { copied, undoable: entries.length, firstCopy, failures };
  });
}

export function latestExplorerUndoOrder(): number | undefined {
  const workspace = currentWorkspace();
  const replay = pendingOpposite('undo', workspace);
  if (replay) return replay.completed?.order ?? replay.oppositeOrder;
  return workspace && pending?.batch.workspace === workspace
    ? pending.batch.order
    : latest(undoHistory, workspace)?.order;
}

export function latestExplorerRedoOrder(): number | undefined {
  pruneRedo();
  const workspace = currentWorkspace();
  const replay = pendingOpposite('redo', workspace);
  return replay ? replay.completed?.order ?? replay.oppositeOrder : latest(redoHistory, workspace)?.order;
}

function branchUnchanged(replay: Replay): boolean {
  return replay.redoEpoch === redoGeneration && lastEdit() <= replay.startedAt;
}

function pendingOpposite(direction: Direction, workspace = currentWorkspace()): Replay | undefined {
  const replay = applying;
  return replay && replay.batch.workspace === workspace && replay.direction !== direction && branchUnchanged(replay)
    ? replay : undefined;
}

/** A queued opposite shortcut must not drift to an older action if this replay fails. */
export function guardExplorerOpposite(direction: Direction, order: number): (() => boolean) | undefined {
  const replay = pendingOpposite(direction);
  if (!replay || order !== (replay.completed?.order ?? replay.oppositeOrder)) return;
  return () => !!replay.completed && replay.batch.workspace === currentWorkspace() && branchUnchanged(replay);
}

function describe(entry: Entry, kind: OperationKind, direction: Direction): string {
  if (entry.type === 'import') return filename(entry.path);
  const target = direction === 'undo' ? entry.from : entry.to;
  if (kind === 'rename') return `${filename(direction === 'undo' ? entry.to : entry.from)} → ${filename(target)}`;
  return `${filename(target)} → ${filename(parentDirectory(target))}`;
}

function openKeysWithin(path: string): string[] {
  const keys = new Set([...useDocumentStore.getState().documents.keys(), ...useWindowStore.getState().tabs.map(tab => tab.key)]);
  return [...keys].filter(key => isSubPath(path, key));
}

async function undoImport(entry: ImportEntry): Promise<void> {
  const leases: DocumentIdentityLease[] = [];
  const keys = openKeysWithin(entry.path);
  try {
    for (const key of keys) leases.push(protectDocumentIdentity(key));
    for (const lease of leases) await prepareDocumentIdentity(lease);
    leases.forEach(assertDocumentIdentity);
    if (keys.some(key => useDocumentStore.getState().getDocument(key)?.isDirty || getEditorCapabilities(key)?.hasExplicitDraft?.())) {
      throw new Error('导入件有未保存的更改，已保留原处');
    }
    await undoCopiedPath(entry.path, entry.receipt, keys);
    keys.forEach(key => markOpenDocumentDeleted(key, true));
  } finally {
    leases.forEach(lease => lease.release());
  }
}

async function redoImport(entry: ImportEntry): Promise<void> {
  await redoCopiedPath(entry.path, entry.receipt);
  const windows = useWindowStore.getState();
  const documents = useDocumentStore.getState();
  for (const key of openKeysWithin(entry.path)) {
    if (!windows.getTab(key)?.isImportParked) continue;
    windows.setTabDetached(key, false);
    windows.setTabExternalStatus(key, 'clean');
    documents.setExternalStatus(key, 'clean');
  }
}

async function applyBatch(replay: Replay): Promise<boolean> {
  const { batch, direction } = replay;
  const source = direction === 'undo' ? undoHistory : redoHistory;
  const target = direction === 'undo' ? redoHistory : undoHistory;
  const succeeded: Entry[] = [];
  const failures: string[] = [];
  const changed = new Set<string>();
  let revealed: string | undefined;
  const order = direction === 'undo' ? [...batch.entries].reverse() : [...batch.entries];
  for (const entry of order) {
    try {
      if (entry.type === 'path') {
        const [from, to] = direction === 'undo' ? [entry.to, entry.from] : [entry.from, entry.to];
        await renameOpenPath(from, to, entry.directory, { expectedIdentity: entry.identity });
        changed.add(parentDirectory(from));
        changed.add(parentDirectory(to));
        revealed = to;
      } else {
        changed.add(parentDirectory(entry.path));
        if (direction === 'undo') {
          await undoImport(entry);
          const explorer = useExplorerStore.getState();
          if (explorer.revealed && isSubPath(entry.path, explorer.revealed)) explorer.setRevealed(null, false);
        } else {
          await redoImport(entry);
          revealed = entry.path;
        }
      }
      succeeded.push(entry);
      batch.entries.splice(batch.entries.indexOf(entry), 1);
    } catch (error) {
      failures.push(`${describe(entry, batch.kind, direction)}：${reason(error)}`);
    }
  }
  if (!batch.entries.length && source.includes(batch)) source.splice(source.indexOf(batch), 1);
  if (succeeded.length && (direction === 'redo' || branchUnchanged(replay))) {
    replay.completed = {
      ...batch,
      order: direction === 'undo' ? nextHistoryOrder() : replay.oppositeOrder,
      entries: direction === 'undo' ? succeeded.reverse() : succeeded,
    };
    append(target, replay.completed);
  } else if (succeeded.length) releaseEntries(succeeded);
  const refreshes = await Promise.allSettled([...changed].map(refreshExplorerDirectory));
  if (refreshes.some(result => result.status === 'rejected')) failures.push('目录列表暂未刷新，请手动刷新');
  if (revealed && currentWorkspace() === batch.workspace && isSubPath(useExplorerStore.getState().root, revealed)) {
    useExplorerStore.getState().setRevealed(revealed, false);
  }
  const verb = direction === 'undo' ? '撤销' : '重做';
  const operation = labels[batch.kind];
  const completed = succeeded.length
    ? `已${verb}${operation}：${describe(succeeded[0], batch.kind, direction)}${succeeded.length > 1 ? `等 ${succeeded.length} 项` : ''}`
    : `未能${verb}${operation}`;
  showToast([completed, ...failures.slice(0, 2)].join('；'), failures.length ? 'warning' : 'success', 2200);
  return succeeded.length > 0;
}

function startReplay(direction: Direction, expectedOrder?: number): Promise<boolean> {
  if (applying) {
    if (applying.direction === direction) return applying.result;
    const replay = pendingOpposite(direction);
    if (!replay || (expectedOrder !== undefined && expectedOrder !== (replay.completed?.order ?? replay.oppositeOrder))) {
      return Promise.resolve(false);
    }
    replay.followUp ??= replay.result.then(changed => {
      if (!changed || !replay.completed || !branchUnchanged(replay)) return false;
      return startReplay(direction, replay.completed.order);
    });
    return replay.followUp;
  }
  const workspace = currentWorkspace();
  const submitted = pending;
  pruneRedo();
  const batch = direction === 'undo' && submitted && submitted.batch.workspace === workspace
    ? submitted.batch
    : latest(direction === 'undo' ? undoHistory : redoHistory, workspace);
  if (!batch || (expectedOrder !== undefined && batch.order !== expectedOrder)) return Promise.resolve(false);
  const replay: Replay = {
    batch, direction, startedAt: getHistoryOrder(), redoEpoch: redoGeneration,
    oppositeOrder: nextHistoryOrder(), result: Promise.resolve(false),
  };
  replay.result = Promise.resolve().then(async () => {
    await submitted?.settled;
    if (batch.workspace !== currentWorkspace() || !batch.entries.length) return false;
    pruneRedo();
    if (direction === 'redo' && !redoHistory.includes(batch)) return false;
    return applyBatch(replay);
  }).finally(() => {
    applying = undefined;
    const index = redoHistory.indexOf(batch);
    if (direction === 'redo' && replay.discardRemainder && index >= 0) discardAt(redoHistory, index);
    pruneRedo();
  });
  applying = replay;
  return replay.result;
}

export const undoExplorerOperation = (expectedOrder?: number) => startReplay('undo', expectedOrder);
export const redoExplorerOperation = (expectedOrder?: number) => startReplay('redo', expectedOrder);
export const hasExplorerMoveUndo = () => latestExplorerUndoOrder() !== undefined;
export const undoExplorerMove = undoExplorerOperation;
