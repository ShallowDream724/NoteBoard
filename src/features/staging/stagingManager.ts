// NoteBoard 暂存管理器
// 编辑停止后增量覆盖副本，正常保存/明确丢弃时清理，暂存关闭与异常终止时保留。

import * as ipc from '../../core/ipc/commands';
import type { StagingDocument, StagingResult } from '../../core/ipc/types';
import { useDocumentStore } from '../../stores/documentStore';
import { useWindowStore } from '../../stores/windowStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { syncDocumentContent } from '../editor-code/orchestration/syncDocumentContent';
// 🔴 R13：dirty 队列签名使用真实每文档 revision
import { getDocumentRevision, getEditorCapabilities, subscribeDocumentRevisions } from '../../core/editor/editorRegistry';
import { getSessionGeneration } from '../session/documentSession';
import { hasUnsavedWork, hasUnsavedContent } from './stagingPolicy';

/** 编辑停止后快速落盘，缩小任务管理器强制终止时可能丢失的时间窗口。 */
const STAGING_DEBOUNCE_MS = 800;
/** 定时兜底覆盖，处理编辑器未触发常规失焦或订阅事件的边界。 */
const STAGING_INTERVAL_MS = 5_000;

// 每个文档在一次编辑会话内复用同一暂存文件，避免每次键入都生成历史副本。
/** 暂存记录：key → 副本路径与暂存内容（undefined=内容未知，如恢复登记的副本；内容证明用于保存后只清理被覆盖的副本） */
const stagedPaths = new Map<string, { path: string; content?: string; revision?: number; directory?: string }>();
// 明确选择“暂存”的文档不再由标签移除后的清理流程删除。
const retainedKeys = new Set<string>();
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let intervalTimer: ReturnType<typeof setInterval> | null = null;
let stopRevisionSubscription: (() => void) | null = null;
let writeQueue: Promise<unknown> = Promise.resolve();
function enqueueStaging<T>(task: () => Promise<T>): Promise<T> {
  const result = writeQueue.catch(() => undefined).then(task);
  writeQueue = result;
  return result;
}

export async function drainStagingWrites(): Promise<void> {
  await writeQueue.catch(() => undefined);
}

/** Called after draining writes, in the same synchronous identity commit. */
export function migrateStagedDocumentKey(from: string, to: string): void {
  if (from === to) return;
  const record = stagedPaths.get(from);
  if (record) { stagedPaths.delete(from); stagedPaths.set(to, { ...record, revision: undefined }); }
  if (retainedKeys.delete(from)) retainedKeys.add(to);
  if (pendingStagingKeys.delete(from)) pendingStagingKeys.add(to);
  if (automaticKeys.delete(from)) automaticKeys.add(to);
}

/** 统一复用关闭保护策略：空白未命名文件不暂存，有内容或脏态才暂存。 */
const shouldStage = hasUnsavedWork;

/** 收集指定范围内需暂存的文档，并在关闭/失焦前通过异步 flush 捕获编辑器权威内容。 */
interface StagingSnapshot { document: StagingDocument; revision: number; directory: string; generation: number }
async function collectDocuments(keys?: string[], onlyChanged = false): Promise<StagingSnapshot[]> {
  const tabs = useWindowStore.getState().tabs;
  const documents = useDocumentStore.getState().documents;
  const requestedKeys = keys ? new Set(keys) : null;
  const candidates = tabs.filter((tab) => {
    if (requestedKeys && !requestedKeys.has(tab.key)) return false;
    if (useWindowStore.getState().isTransferring(tab.key)) return false;
    // 🔴 R01：未加载的恢复标签正文未知（content=null）——自动/批量暂存一律跳过，
    //    绝不能用空占位正文重写原暂存副本；其副本已在磁盘，关闭走保留/丢弃语义。
    if (tab.lazySource) return false;
    return hasUnsavedContent(documents.get(tab.key), tab);
  });

  const snapshots: StagingSnapshot[] = [];
  for (const tab of candidates) {
    let revision = getDocumentRevision(tab.key);
    const generation = getSessionGeneration(tab.key);
    const directory = useSettingsStore.getState().settings.file.stagingDirectory;
    const record = stagedPaths.get(tab.key);
    const before = useDocumentStore.getState().getDocument(tab.key);
    if (onlyChanged && record?.revision === revision && record.directory === directory
      && record.content !== undefined && record.content === before?.content) continue;

    // Keep the capture's starting revision. Edits arriving during the await
    // must still be captured on the next pass, even if this write succeeds.
    const capabilities = getEditorCapabilities(tab.key);
    let capturedContent: string | undefined;
    if (capabilities) {
      const captured = await capabilities.flush('stage');
      if (!captured || captured.content === null) throw new Error(`${tab.displayName}：未能获取当前内容，已保留原暂存副本`);
      if (getSessionGeneration(tab.key) !== generation || getEditorCapabilities(tab.key)?.instanceId !== captured.instanceId) continue;
      capturedContent = captured.content;
      revision = captured.revision;
    } else await syncDocumentContent(tab.key);
    const document = useDocumentStore.getState().getDocument(tab.key);
    if (!document || !shouldStage(tab.key) || getSessionGeneration(tab.key) !== generation || useWindowStore.getState().isTransferring(tab.key)) continue;
    if (capturedContent === undefined && document.content === null) throw new Error(`${tab.displayName}：内容尚未加载，已保留原暂存副本`);
    snapshots.push({ revision, directory, generation, document: {
      key: tab.key,
      displayName: tab.displayName || document.displayName,
      content: capturedContent ?? document.content!,
      encoding: document.encoding,
      eol: document.eol,
      targetPath: stagedPaths.get(tab.key)?.path ?? null,
    } });
  }
  return snapshots;
}

/** 清理已恢复干净且未被明确保留的副本，避免正常编辑产生长期垃圾。 */
async function cleanupResolvedCopies(): Promise<void> {
  const cleanupTasks: Promise<void>[] = [];
  const tabs = new Map(useWindowStore.getState().tabs.map(tab => [tab.key, tab]));
  const documents = useDocumentStore.getState().documents;
  for (const [key, record] of stagedPaths) {
    const tab = tabs.get(key);
    if (useWindowStore.getState().isTransferring(key)) continue;
    if (retainedKeys.has(key) || hasUnsavedContent(documents.get(key), tab)) continue;
    // 🔴 R01：未加载的恢复标签（正文未知）不在清理范围——副本是唯一恢复来源
    if (tab?.lazySource) continue;
    cleanupTasks.push(ipc.deleteStagedFile(record.path).then(() => {
      if (stagedPaths.get(key) === record) stagedPaths.delete(key);
    }).catch((error) => {
      console.warn('[stagingManager] 清理已恢复文档的暂存副本失败:', error);
    }));
  }
  await Promise.all(cleanupTasks);
}

/** 实际执行一次暂存写入；由串行队列调用，防止定时器与关闭事件并发覆盖。 */
async function writePendingDocuments(keys?: string[], retain = false, onlyChanged = false): Promise<StagingResult[]> {
  await cleanupResolvedCopies();
  // 🔴 R01：显式指定范围（用户"暂存并关闭"）中被跳过的未加载恢复标签：
  //    原暂存副本即用户要求保留的内容，标记保留且不重写。
  if (keys) {
    for (const key of keys) {
      const tab = useWindowStore.getState().getTab(key);
      if (tab?.lazySource && stagedPaths.has(key)) {
        retainedKeys.add(key);
      }
    }
  }
  const documents = await collectDocuments(keys, onlyChanged);
  if (documents.length === 0) return [];

  const results: StagingResult[] = [];
  const errors: string[] = [];
  // 逐份调用以保留部分成功结果：某一文件失败时，其余文件仍能得到异常退出保护与稳定覆盖路径。
  for (const { document, revision, directory, generation } of documents) {
    try {
      if (getSessionGeneration(document.key) !== generation || useWindowStore.getState().isTransferring(document.key)) continue;
      const [result] = await ipc.stashDocuments([document]);
      if (!result) {
        errors.push(`${document.displayName}：后端未返回暂存路径`);
        continue;
      }
      // A closed/reopened session cannot inherit a late write's ownership.
      // The completed recovery file remains available for recovery on disk.
      if (getSessionGeneration(document.key) !== generation) continue;
      const previousPath = document.targetPath;
      // 记录暂存内容：保存后清理需要内容证明（只删被保存覆盖的副本）
      stagedPaths.set(result.key, { path: result.targetPath, content: document.content, revision, directory });
      results.push(result);
      // 修改设置位置后 Rust 会返回新路径，此时清理旧位置中仅用于异常恢复的副本。
      if (previousPath && previousPath !== result.targetPath) {
        await ipc.deleteStagedFile(previousPath).catch((error) => {
          console.warn('[stagingManager] 清理旧暂存位置副本失败:', error);
        });
      }
    } catch (error) {
      errors.push(`${document.displayName}：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 只有整批成功时才标记为用户确认保留，失败时窗口继续停留并允许用户重试或正常保存。
  if (errors.length > 0) throw new Error(errors.join('；'));
  if (retain) {
    assertStagedDocumentsCurrent(keys ?? documents.map(item => item.document.key));
    results.forEach((result) => retainedKeys.add(result.key));
  }
  return results;
}

/** Closing must consume proof of the current version, not merely a completed
 * write. Recheck synchronously after the caller's last await too. */
export function assertStagedDocumentsCurrent(keys: readonly string[]): void {
  for (const key of keys) {
    const tab = useWindowStore.getState().getTab(key);
    const document = useDocumentStore.getState().getDocument(key);
    if (!hasUnsavedContent(document, tab)) continue;
    const record = stagedPaths.get(key);
    if (tab?.lazySource && record) continue;
    if (!record || record.revision !== getDocumentRevision(key) || record.content !== document?.content) {
      throw new Error('暂存期间有新的修改，请再次暂存后关闭');
    }
  }
}

/**
 * 立即暂存未保存文档。所有调用串行执行；retain=true 表示用户明确要求保留并关闭。
 */
export function stashPendingDocuments(options: { keys?: string[]; retain?: boolean; onlyChanged?: boolean } = {}): Promise<StagingResult[]> {
  const keys = options.keys ? [...options.keys] : undefined;
  const retain = options.retain ?? false;
  return enqueueStaging(() => writePendingDocuments(keys, retain, options.onlyChanged && !retain));
}

/** 返回当前编辑会话已分配的暂存路径，供最近关闭窗口快照建立原路径/暂存路径关系。 */
export function getStagedPath(docKey: string): string | null {
  return stagedPaths.get(docKey)?.path ?? null;
}

/**
 * S10：恢复副本的内容与版本未知；只有显式捕获后才能证明已保存覆盖。
 */
export function registerRestoredStagedPath(docKey: string, path: string): void {
  if (!stagedPaths.has(docKey)) {
    // 🔴 R01：内容未知（undefined）——onDocumentSaved 对未知内容不删（见下），
    //    只有确认内容被保存覆盖后才清理。
    stagedPaths.set(docKey, { path, content: undefined });
  }
}

/**
 * 正常保存完成后清理该文档的异常恢复副本。
 * 🔴 S09：携带已保存内容证明（savedContent）——只有暂存副本被本次保存覆盖
 * （暂存内容与保存内容逐字一致）才删除；
 * 保存期间产生的新版本暂存（r11 > r10）保留，避免误删恢复副本。
 */
export function onDocumentSaved(docKey: string, savedContent?: string): Promise<void> {
  const generation = getSessionGeneration(docKey);
  return enqueueStaging(async () => {
    if (savedContent === undefined || getSessionGeneration(docKey) !== generation) return;
    const record = stagedPaths.get(docKey);
    if (!record) return;
    // Empty content is a real version too, not proof that an older save covers it.
    const covered = record.content !== undefined && record.content === savedContent;
    retainedKeys.delete(docKey);
    if (!covered) return;
    await ipc.deleteStagedFile(record.path).then(() => {
      if (stagedPaths.get(docKey) === record) stagedPaths.delete(docKey);
    }).catch((error) => {
      console.warn('[stagingManager] 保存后清理暂存副本失败:', error);
    });
  });
}

/** 用户明确选择“不保存”时同步清理副本，保证该动作语义仍是彻底丢弃。 */
export function discardStagedDocuments(keys: string[]): Promise<void> {
  const generations = keys.map(key => getSessionGeneration(key));
  return enqueueStaging(async () => {
    const tasks = keys.flatMap((key, index) => {
      if (getSessionGeneration(key) !== generations[index]) return [];
      retainedKeys.delete(key);
      const record = stagedPaths.get(key);
      return record ? [ipc.deleteStagedFile(record.path).then(() => {
        if (stagedPaths.get(key) === record) stagedPaths.delete(key);
      })] : [];
    });
    await Promise.all(tasks);
  });
}

/** Keyed revisions keep the edit hot path O(1), including equal-length edits.
 * Structural/restore changes are reconciled by the low-frequency fallback. */
const pendingStagingKeys = new Set<string>();
const automaticKeys = new Set<string>();
let automaticAll = false;
let automaticQueued = false;

/** At most one running and one pending automatic pass, even with a slow disk. */
function requestAutomaticStaging(keys?: string[]): void {
  if (keys) keys.forEach(key => automaticKeys.add(key));
  else automaticAll = true;
  if (automaticQueued) return;
  automaticQueued = true;
  void enqueueStaging(async () => {
    const requested = automaticAll ? undefined : [...automaticKeys];
    automaticKeys.clear(); automaticAll = false; automaticQueued = false;
    return writePendingDocuments(requested, false, true);
  }).catch(error => console.error('[stagingManager] 暂存失败:', error));
}

/** 文档变化时安排一次近期限时暂存；已有任务不顺延，避免连续输入长期推迟异常保护。 */
function scheduleStaging(keys?: string[]): void {
  if (keys) {
    for (const key of keys) pendingStagingKeys.add(key);
  }
  if (debounceTimer) return;
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    // 只暂存变化集合（队列快照后清空；执行期间新变化进入下一轮）
    const keysToStage = [...pendingStagingKeys];
    pendingStagingKeys.clear();
    requestAutomaticStaging(keysToStage.length ? keysToStage : undefined);
  }, STAGING_DEBOUNCE_MS);
}

/**
 * 内容版本通知安排近期限时暂存；失焦、隐藏及定时兜底只捕获未暂存的版本。
 */
export function startStagingManager(): () => void {
  if (stopRevisionSubscription) {
    return stopStagingManager;
  }

  stopRevisionSubscription = subscribeDocumentRevisions(key => scheduleStaging([key]));
  intervalTimer = setInterval(() => {
    requestAutomaticStaging();
  }, STAGING_INTERVAL_MS);

  const handleWindowBlur = () => {
    requestAutomaticStaging();
  };
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden') handleWindowBlur();
  };
  window.addEventListener('blur', handleWindowBlur);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  stopEventListeners = () => {
    window.removeEventListener('blur', handleWindowBlur);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };
  scheduleStaging();
  return stopStagingManager;
}

let stopEventListeners: (() => void) | null = null;

/** 停止本窗口的定时器与订阅；不删除副本，以免卸载阶段误伤异常恢复文件。 */
function stopStagingManager(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  if (intervalTimer) clearInterval(intervalTimer);
  debounceTimer = null;
  pendingStagingKeys.clear();
  intervalTimer = null;
  stopRevisionSubscription?.();
  stopEventListeners?.();
  stopRevisionSubscription = null;
  stopEventListeners = null;
}
