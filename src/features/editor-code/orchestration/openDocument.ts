// NoteBoard 打开文档编排（S07：统一文件准备）
// prepare_document 一次往返完成：归属查询提前（已打开/在途在读盘前返回，不重复读盘、
// 不覆盖脏内容）→ 在途去重 → blocking 读取判别；目录展开与最近记录在建 Tab 后延后执行。
// 详见 docs/09-开发路线图.md 4.13 与启动性能计划 §G

import * as ipc from '../../../core/ipc/commands';
import { notifyOpenRequestsAvailable } from '../../../core/ipc/events';
import type { OpenRequestSource } from '../../../core/ipc/types';
import { useDocumentStore } from '../../../stores/documentStore';
import { useWindowStore, type Tab } from '../../../stores/windowStore';
import { activateWithExplorerPolicy, beginExplorerNavigation, openExplorerDirectory, openExplorerFileParent, releaseExplorerNavigation, revealExplorerFile, type ExplorerNavigation } from '../../explorer/explorerActions';
import { useLayoutStore } from '../../../stores/layoutStore';
import { kindFromPath, languageFromPath } from '../../../core/docKind';
import { prefetchEditor, resolveEditorKind } from '../../editor-host/editorLoaders';
import { showToast } from '../../../stores/toastStore';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { confirmLargeFile, getLargeFileThresholdBytes } from '../../../core/files/largeFilePolicy';

// ── 打开文件 ──

/** 打开结果（S04：映射到打开队列 ACK 的 OpenOutcome） */
export type OpenDocumentResult = 'opened' | 'focused' | 'cancelled' | 'failed';

/**
 * 目录展开任务（G 节：目录及最近记录在可编辑后有序执行，不阻塞打开链路返回）。
 * 带发起时的活动标签与资源管理器根校验：用户已切换目录/标签时放弃旧结果，
 * 不覆盖用户新切换的目录。
 */
function scheduleExplorerFollowUp(targetKey: string, dirPath: string, navigation?: ExplorerNavigation): void {
  if (navigation) {
    void openExplorerFileParent(targetKey, dirPath, navigation, () => useWindowStore.getState().activeKey === targetKey)
      .catch(error => console.error('加载父文件夹目录失败:', error));
    return;
  }
  useLayoutStore.getState().setExplorerVisible(true);
  void revealExplorerFile(targetKey, dirPath, () => useWindowStore.getState().activeKey === targetKey)
    .catch(error => console.error('加载父文件夹目录失败:', error));
}

/** 最近记录更新延后执行（失败静默，不阻塞打开链路） */
function scheduleRecentRecord(path: string, isDir: boolean): void {
  void ipc.pushRecent(path, isDir).catch(() => {
    // 非关键路径
  });
}

/** 按 Tab 信息构造（kind/language 已知时直接使用） */
function buildTab(key: string, displayName: string, kind: Tab['kind'], language: string, viewMode: Tab['viewMode'] = null): Tab {
  return {
    key,
    displayName,
    path: key,
    kind,
    language,
    isDirty: false,
    isPreview: false,
    viewMode,
    externalStatus: null,
    isDetached: false,
  };
}

interface OpenDocumentOptions {
  exportNotice?: Tab['exportNotice'];
  /** External requests enter the parent; export activation preserves the complete Explorer view. */
  explorer?: 'parent' | 'preserve';
  /** Preserved when an external open is routed to the document's actual owner. */
  openRequestSource?: OpenRequestSource;
}

/** Keep explicit and passive Explorer follow-up behavior aligned for every local activation. */
function activateDocumentTab(key: string, options: OpenDocumentOptions, tab?: Tab): void {
  activateWithExplorerPolicy(key, options.explorer === 'preserve' ? 'preserve' : 'follow', () => {
    const store = useWindowStore.getState();
    if (tab) store.openTab(tab);
    else store.activateTab(key);
  });
}

/** 打开文档（对外入口；already-open 重试经 openDocumentInternal 受限递归） */
export async function openDocument(path: string, options: OpenDocumentOptions = {}): Promise<OpenDocumentResult> {
  if (!path.trim()) return 'failed';
  const navigation = options.explorer === 'parent' ? beginExplorerNavigation(path) : undefined;
  try {
    return await openDocumentInternal(path, 0, options, navigation);
  } finally {
    if (navigation) releaseExplorerNavigation(navigation);
  }
}

async function openDocumentInternal(path: string, retryDepth: number, options: OpenDocumentOptions, navigation?: ExplorerNavigation): Promise<OpenDocumentResult> {
  if (retryDepth > 2) {
    showToast('该文件当前处于打开状态，请稍后重试', 'warning');
    return 'failed';
  }
  const fileName = path.split(/[\\/]/).pop() ?? path;
  const kind = kindFromPath(path);
  const label = getCurrentWindow().label;

  // 0. 🔴 S05：路径解析出类型后立即预取唯一目标编辑器入口，与读盘并行
  {
    const loaderKind = resolveEditorKind({ kind, language: languageFromPath(path) });
    if (loaderKind !== 'unsupported') prefetchEditor(loaderKind);
  }

  // 1. 🔴 S07：统一文件准备（归属查询在读盘前；已打开/在途直接返回）
  let prepared: Awaited<ReturnType<typeof ipc.prepareDocument>>;
  try {
    prepared = await ipc.prepareDocument(label, path, getLargeFileThresholdBytes());
    while (prepared.type === 'confirmation-required') {
      if (!await confirmLargeFile(prepared.displayName, prepared.size)) return 'cancelled';
      // Approval applies to this observed size. A growing file must be checked
      // again; ownership is also rechecked before the native reader proceeds.
      prepared = await ipc.prepareDocument(label, path, Math.max(getLargeFileThresholdBytes(), prepared.size));
    }
  } catch (e) {
    console.error('文件准备失败:', e);
    showToast(`无法打开文件: ${fileName}`, 'error');
    return 'failed';
  }

  // 2. 分派判别结果
  switch (prepared.type) {
    case 'already-open': {
      // 已打开（本窗口/在途或其他窗口）：只激活或聚焦，不重复读盘、不覆盖脏内容
      if (prepared.ownerIsSelf) {
        activateDocumentTab(prepared.key, options);
        // 🔴 R04：归属仍在但标签已不存在（刚关闭且注销 IPC 在途 / 首请求尚未建标签）——
        //    小重试等待归属注销或标签建立，最后重新走完整打开链
        if (!useWindowStore.getState().getTab(prepared.key)) {
          for (let attempt = 0; attempt < 5; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 60));
            const tabNow = useWindowStore.getState().getTab(prepared.key);
            if (tabNow) {
              activateDocumentTab(prepared.key, options);
              scheduleExistingTabFollowUp(prepared.key, navigation);
              return 'focused';
            }
          }
          // 归属可能已被注销完成 → 重新尝试完整打开（受限递归）
          return openDocumentInternal(path, retryDepth + 1, options, navigation);
        }
        scheduleExistingTabFollowUp(prepared.key, navigation);
      } else {
        return focusDocumentOwner(prepared.ownerLabel, prepared.key, options);
      }
      return 'focused';
    }

    case 'directory': {
      // A directory has no document tab, so opening it cannot satisfy a preserve request.
      if (options.explorer === 'preserve') return 'failed';
      // 拖入/打开的是文件夹：资源管理器定位到该目录（延后执行，不阻塞返回）
      useLayoutStore.getState().setExplorerVisible(true);
      try { await openExplorerDirectory(prepared.path, navigation); }
      catch (error) { showToast(`无法打开文件夹：${String(error)}`, 'error'); return 'failed'; }
      scheduleRecentRecord(prepared.path, true);
      return 'opened';
    }

    case 'image': {
      const docStore = useDocumentStore.getState();
      docStore.upsertFromPayload({
        key: prepared.key,
        displayName: prepared.displayName,
        dirPath: prepared.dirPath,
        kind: 'image',
        language: 'plaintext',
        content: null,
        encoding: 'utf8',
        eol: 'lf',
        size: prepared.size,
        mtime: prepared.mtime,
        readonly: true,
      });
      try {
        const regResult = await ipc.registerDocument(label, prepared.key, 'image');
        if (regResult.type === 'already-open') {
          // 并发窗口竞争注册：聚焦已有所有者，本窗口不建 Tab
          if (regResult.ownerLabel !== label) {
            return focusDocumentOwner(regResult.ownerLabel, prepared.key, options);
          }
          activateDocumentTab(prepared.key, options);
          scheduleExistingTabFollowUp(prepared.key, navigation);
          return 'focused';
        }
      } catch (e) {
        console.error('注册图片文档失败:', e);
      }
      activateDocumentTab(prepared.key, options, buildTab(prepared.key, prepared.displayName, 'image', 'plaintext'));
      if (prepared.dirPath && options.explorer !== 'preserve') scheduleExplorerFollowUp(prepared.key, prepared.dirPath, navigation);
      scheduleRecentRecord(path, false);
      return 'opened';
    }

    case 'unsupported': {
      if (!options.exportNotice) showToast(`文件格式不受支持: ${prepared.displayName}，无法直接编辑`, 'warning');
      useDocumentStore.getState().upsertFromPayload({
        key: prepared.key,
        displayName: prepared.displayName,
        dirPath: prepared.dirPath,
        kind: 'unsupported',
        language: 'plaintext',
        content: null,
        encoding: 'utf8',
        eol: 'lf',
        size: prepared.size,
        mtime: 0,
        readonly: true,
      });
      activateDocumentTab(prepared.key, options, { ...buildTab(prepared.key, prepared.displayName, 'unsupported', 'plaintext'), exportNotice: options.exportNotice });
      if (prepared.dirPath && options.explorer !== 'preserve') scheduleExplorerFollowUp(prepared.key, prepared.dirPath, navigation);
      return 'opened';
    }

    case 'failed': {
      console.error('打开文件失败:', prepared.message);
      showToast(`无法打开文件: ${fileName}`, 'error');
      return 'failed';
    }

    case 'text': {
      const payload = prepared.payload;
      // 注册文档（跨窗口并发竞争由 register 的 already-open 兜底）
      try {
        const regResult = await ipc.registerDocument(label, payload.key, payload.kind);
        if (regResult.type === 'already-open') {
          if (regResult.ownerLabel !== label) {
            return focusDocumentOwner(regResult.ownerLabel, payload.key, options);
          } else {
            activateDocumentTab(payload.key, options);
            scheduleExistingTabFollowUp(payload.key, navigation);
          }
          return 'focused';
        }
      } catch (e) {
        console.error('注册文档失败:', e);
      }

      // 建 Document 与 Tab 并激活（关键路径：到此即可编辑）
      useDocumentStore.getState().upsertFromPayload(payload);
      activateDocumentTab(payload.key, options, buildTab(payload.key, payload.displayName, payload.kind, payload.language));

      // 目录展开与最近记录延后（不阻塞打开链路返回，不阻塞队列下一条）
      if (payload.dirPath && payload.key && options.explorer !== 'preserve') {
        scheduleExplorerFollowUp(payload.key, payload.dirPath, navigation);
      }
      scheduleRecentRecord(path, false);
      return 'opened';
    }
  }
}

/** Forward only remote ownership; the owner's already-open/self branch never re-enqueues. */
async function focusDocumentOwner(ownerLabel: string, key: string, options: OpenDocumentOptions): Promise<OpenDocumentResult> {
  if (options.explorer === 'parent' && ownerLabel !== getCurrentWindow().label) {
    let queueVersion: number;
    try {
      [, queueVersion] = await ipc.enqueueOpenRequests(ownerLabel, [key], options.openRequestSource ?? 'second-instance');
    } catch (error) {
      console.error('转交文件打开请求失败:', error);
      showToast('无法将文件打开请求转交给已有窗口，请重试', 'error');
      return 'failed';
    }
    try {
      await notifyOpenRequestsAvailable(ownerLabel, queueVersion);
    } catch (error) {
      // The queue remains durable; focusing the owner also triggers its recovery drain.
      console.warn('通知已有窗口消费打开请求失败:', error);
    }
  }
  try {
    await ipc.focusWindow(ownerLabel);
  } catch (error) {
    console.error('聚焦已打开窗口失败:', error);
  }
  return 'focused';
}

/** Already-open responses carry only the canonical key; reuse the loaded document's parent. */
function scheduleExistingTabFollowUp(key: string, navigation?: ExplorerNavigation): void {
  if (!navigation) return;
  const directory = useDocumentStore.getState().getDocument(key)?.dirPath;
  if (directory) scheduleExplorerFollowUp(key, directory, navigation);
}

// ── 从路径构建 Tab（不实际打开，用于会话恢复）──

export function buildTabFromPath(path: string): Tab {
  const kind = kindFromPath(path);
  const language = languageFromPath(path);
  const name = path.split(/[\\/]/).pop() ?? path;

  return {
    key: path,
    displayName: name,
    path,
    kind,
    language,
    isDirty: false,
    isPreview: false,
    viewMode: null,
    externalStatus: null,
    isDetached: false,
  };
}
