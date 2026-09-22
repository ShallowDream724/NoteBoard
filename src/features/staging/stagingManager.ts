// NoteBoard 暂存管理器
// 编辑停止后增量覆盖副本，正常保存/明确丢弃时清理，暂存关闭与异常终止时保留。

import * as ipc from '../../core/ipc/commands';
import type { StagingDocument, StagingResult } from '../../core/ipc/types';
import { useDocumentStore } from '../../stores/documentStore';
import { useWindowStore } from '../../stores/windowStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { syncDocumentContent } from '../editor-code/orchestration/syncDocumentContent';
// 🔴 R13：dirty 队列签名使用真实每文档 revision
import { getDocumentRevision, subscribeDocumentRevisions } from '../../core/editor/editorRegistry';
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
let writeQueue: Promise<StagingResult[]> = Promise.resolve([]);

/** 统一复用关闭保护策略：空白未命名文件不暂存，有内容或脏态才暂存。 */
const shouldStage = hasUnsavedWork;

/** 收集指定范围内需暂存的文档，并在关闭/失焦前通过异步 flush 捕获编辑器权威内容。 */
interface StagingSnapshot { document: StagingDocument; revision: number; directory: string }
async function collectDocuments(keys?: string[], onlyChanged = false): Promise<StagingSnapshot[]> {
  const tabs = useWindowStore.getState().tabs;
  const documents = useDocumentStore.getState().documents;
  const requestedKeys = keys ? new Set(keys) : null;
  const candidates = tabs.filter((tab) => {
    if (requestedKeys && !requestedKeys.has(tab.key)) return false;
    // 🔴 R01：未加载的恢复标签正文未知（content=null）——自动/批量暂存一律跳过，
    //    绝不能用空占位正文重写原暂存副本；其副本已在磁盘，关闭走保留/丢弃语义。
    if (tab.lazySource) return false;
    return hasUnsavedContent(documents.get(tab.key), tab);
  });

  const snapshots: StagingSnapshot[] = [];
  for (const tab of candidates) {
    const revision = getDocumentRevision(tab.key);
    const directory = useSettingsStore.getState().settings.file.stagingDirectory;
    const record = stagedPaths.get(tab.key);
    const before = useDocumentStore.getState().getDocument(tab.key);
    if (onlyChanged && record?.revision === revision && record.directory === directory
      && record.content !== undefined && record.content === before?.content) continue;

    // Keep the capture's starting revision. Edits arriving during the await
    // must still be captured on the next pass, even if this write succeeds.
    await syncDocumentContent(tab.key);
    const document = useDocumentStore.getState().getDocument(tab.key);
    if (!document || !shouldStage(tab.key)) continue;
    snapshots.push({ revision, directory, document: {
      key: tab.key,
      displayName: tab.displayName || document.displayName,
      content: document.content ?? '',
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
    if (retainedKeys.has(key) || hasUnsavedContent(documents.get(key), tab)) continue;
    // 🔴 R01：未加载的恢复标签（正文未知）不在清理范围——副本是唯一恢复来源
    if (tab?.lazySource) continue;
    stagedPaths.delete(key);
    cleanupTasks.push(ipc.deleteStagedFile(record.path).catch((error) => {
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
  for (const { document, revision, directory } of documents) {
    try {
      const [result] = await ipc.stashDocuments([document]);
      if (!result) {
        errors.push(`${document.displayName}：后端未返回暂存路径`);
        continue;
      }
      const previousPath = document.targetPath;
      // 记录暂存内容：保存后清理需要内容证明（只删被保存覆盖的副本）
      stagedPaths.set(result.key, { path: result.targetPath, content: document.content, revision, directory });
      results.push(result);
      // 修改设置位置后 Rust 会返回新路径，此时清理旧位置中仅用于异常恢复的副本。
      if (previousPath && previousPath !== result.targetPath) {
        ipc.deleteStagedFile(previousPath).catch((error) => {
          console.warn('[stagingManager] 清理旧暂存位置副本失败:', error);
        });
      }
    } catch (error) {
      errors.push(`${document.displayName}：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 只有整批成功时才标记为用户确认保留，失败时窗口继续停留并允许用户重试或正常保存。
  if (errors.length > 0) throw new Error(errors.join('；'));
  if (retain) results.forEach((result) => retainedKeys.add(result.key));
  return results;
}

/**
 * 立即暂存未保存文档。所有调用串行执行；retain=true 表示用户明确要求保留并关闭。
 */
export function stashPendingDocuments(options: { keys?: string[]; retain?: boolean; onlyChanged?: boolean } = {}): Promise<StagingResult[]> {
  const keys = options.keys ? [...options.keys] : undefined;
  const retain = options.retain ?? false;
  writeQueue = writeQueue
    .catch(() => [])
    .then(() => writePendingDocuments(keys, retain, options.onlyChanged && !retain));
  return writeQueue;
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
 * （暂存内容与保存内容逐字一致，或暂存内容为空）才删除；
 * 保存期间产生的新版本暂存（r11 > r10）保留，避免误删恢复副本。
 */
export async function onDocumentSaved(docKey: string, savedContent?: string): Promise<void> {
  // 等待已在途的暂存写入结束，避免“先清理、后写回”在快速保存/退出时遗留假恢复副本。
  await writeQueue.catch(() => []);
  const record = stagedPaths.get(docKey);
  if (!record) return;
  if (savedContent !== undefined) {
    // 🔴 内容证明判定：未知内容（undefined，恢复登记的副本）必须保留；
    //    只有暂存内容为空（此前确认的空写入）或与保存内容一致时才视为被覆盖
    const covered = record.content !== undefined && (record.content === '' || record.content === savedContent);
    if (!covered) {
      retainedKeys.delete(docKey);
      return; // 保留更晚版本或内容未知的恢复副本
    }
  }
  retainedKeys.delete(docKey);
  stagedPaths.delete(docKey);
  await ipc.deleteStagedFile(record.path).catch((error) => {
    console.warn('[stagingManager] 保存后清理暂存副本失败:', error);
  });
}

/** 用户明确选择“不保存”时同步清理副本，保证该动作语义仍是彻底丢弃。 */
export async function discardStagedDocuments(keys: string[]): Promise<void> {
  // 关闭确认前排空写队列，保证明确丢弃后不会被较早排队的定时任务重新写回。
  await writeQueue.catch(() => []);
  const tasks = keys.flatMap((key) => {
    retainedKeys.delete(key);
    const record = stagedPaths.get(key);
    stagedPaths.delete(key);
    return record ? [ipc.deleteStagedFile(record.path)] : [];
  });
  await Promise.allSettled(tasks);
}

/** Keyed revisions keep the edit hot path O(1), including equal-length edits.
 * Structural/restore changes are reconciled by the low-frequency fallback. */
const pendingStagingKeys = new Set<string>();

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
    stashPendingDocuments({ keys: keysToStage.length ? keysToStage : undefined, onlyChanged: true }).catch((error) => {
      console.error('[stagingManager] 增量暂存失败:', error);
    });
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
    stashPendingDocuments({ onlyChanged: true }).catch((error) => {
      console.error('[stagingManager] 定时暂存失败:', error);
    });
  }, STAGING_INTERVAL_MS);

  const handleWindowBlur = () => {
    stashPendingDocuments({ onlyChanged: true }).catch((error) => {
      console.error('[stagingManager] 失焦暂存失败:', error);
    });
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
