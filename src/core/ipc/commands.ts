// NoteBoard IPC 命令封装
// 组件禁止直接调 invoke，只能用这些封装
// 详见 docs/08-数据契约与持久化.md §2

import { invoke } from '@tauri-apps/api/core';
import type {
  DocumentPayload,
  FileTreeNode,
  FontFamily,
  ProbeResult,
  PathExistsResult,
  RegisterResult,
  ReconcileResult,
  Settings,
  SettingsPatch,
  WriteResult,
  WindowIntent,
  CreateWindowResponse,
  OpenRequestItemDto,
  OpenRequestSource,
  OpenOutcome,
  WindowBootDto,
  TransferredDocument,
  BeginTransferResponse,
  TransferStatusDto,
  PreparedDocument,
  Eol,
  Encoding,
  UpdateCheckResult,
  StagingDocument,
  StagingResult,
  SessionSnapshot,
  FontPackStatus,
  FavoritesData,
} from './types';

// ── 窗口（S04 打开队列 + 迁移协议） ──
export interface ShortcutProbe { binding: string; status: 'unclaimed' | 'occupied' | 'unknown'; errorCode: number | null }
export function probeShortcuts(bindings: string[]): Promise<ShortcutProbe[]> {
  return invoke<ShortcutProbe[]>('probe_shortcuts', { bindings });
}

/** 监听就绪握手：返回 consumer 代际与启动模式；不显示窗口、不消费请求 */
export function windowListenersReady(label: string): Promise<WindowBootDto> {
  return invoke<WindowBootDto>('window_listeners_ready', { label });
}

/** 壳就绪：只负责基础 DOM/主题已应用后的 show/focus */
export function windowShellReady(label: string): Promise<void> {
  return invoke<void>('window_shell_ready', { label });
}

/** 非破坏读取本窗口未确认请求（批量上限默认 32；旧 consumer 返回 null） */
export function listOpenRequests(
  label: string,
  consumerId: string,
  limit?: number,
): Promise<OpenRequestItemDto[] | null> {
  return invoke<OpenRequestItemDto[] | null>('list_open_requests', {
    label,
    consumerId,
    limit: limit ?? null,
  });
}

/** 幂等确认打开请求：业务处理有明确结果才调用 */
export function ackOpenRequest(
  label: string,
  consumerId: string,
  requestId: string,
  outcome: OpenOutcome,
): Promise<boolean> {
  return invoke<boolean>('ack_open_request', { label, consumerId, requestId, outcome });
}

/** 前端入队打开请求（拖拽 / 文件对话框来源） */
export function enqueueOpenRequests(
  label: string,
  paths: string[],
  source: OpenRequestSource,
  cwd?: string | null,
): Promise<[string, number]> {
  return invoke<[string, number]>('enqueue_open_requests', {
    label,
    paths,
    cwd: cwd ?? null,
    source,
  });
}

export function createWindow(intent: WindowIntent): Promise<CreateWindowResponse> {
  return invoke<CreateWindowResponse>('create_window', { intent });
}

// ── 文档迁移（transferId 协议） ──

/** 发起迁移：源 flush 权威内容后携带完整载荷调用 */
export function beginDocumentTransfer(
  sourceLabel: string,
  doc: TransferredDocument,
  expectedRevision: number,
): Promise<BeginTransferResponse> {
  return invoke<BeginTransferResponse>('begin_document_transfer', {
    sourceLabel,
    doc,
    expectedRevision,
  });
}

/** 目标窗口一次性拉取迁移载荷 */
export function takeTransferPayload(
  label: string,
  transferId: string,
): Promise<TransferredDocument | null> {
  return invoke<TransferredDocument | null>('take_transfer_payload', { label, transferId });
}

/** 目标回报 prepared：后端原子切换所有权并标 committed，通知双方 */
/**
 * 目标回报 prepared：后端原子校验并切换所有权，committed 后本窗口解锁。
 * @param actualRevision 目标从载荷读取的修订版本——与源捕获的 expected_revision
 *        对账（🔴 N01：不一致说明载荷在接纳途中被替换，后端按中止处理）
 */
export function prepareTransferComplete(
  label: string,
  transferId: string,
  actualRevision?: number,
): Promise<TransferStatusDto> {
  return invoke<TransferStatusDto>('prepare_transfer_complete', {
    label,
    transferId,
    actualRevision: actualRevision ?? null,
  });
}

/** 中止迁移（committed 后拒绝） */
export function abortTransfer(
  label: string,
  transferId: string,
  reason: string,
): Promise<TransferStatusDto> {
  return invoke<TransferStatusDto>('abort_transfer', { label, transferId, reason });
}

/** 查询迁移状态（源窗口等待确认用） */
export function queryTransfer(transferId: string): Promise<TransferStatusDto | null> {
  return invoke<TransferStatusDto | null>('query_transfer', { transferId });
}

export function focusWindow(label: string): Promise<void> {
  return invoke<void>('focus_window', { label });
}

export function closeWindow(label: string): Promise<void> {
  return invoke<void>('close_window', { label });
}

// ── 文档注册表 ──

export function registerDocument(
  label: string,
  key: string,
  kind: string,
): Promise<RegisterResult> {
  return invoke<RegisterResult>('register_document', { label, key, kind });
}

export function unregisterDocument(label: string, key: string): Promise<void> {
  return invoke<void>('unregister_document', { label, key });
}

export function reconcileDocuments(label: string, keys: string[]): Promise<ReconcileResult> {
  return invoke<ReconcileResult>('reconcile_documents', { label, keys });
}

export function setDocumentDirty(key: string, isDirty: boolean): Promise<void> {
  return invoke<void>('set_document_dirty', { key, isDirty });
}

// 🔴 wire 类型修正：Rust find_document_owner 返回 Option<String>，
//    JSON 序列化结果就是 string | null 本身，不是 { ownerLabel } 包装对象。
export function findDocumentOwner(key: string): Promise<string | null> {
  return invoke<string | null>('find_document_owner', { key });
}

// ── 文件 I/O ──

export function readDocument(path: string): Promise<DocumentPayload> {
  return invoke<DocumentPayload>('read_document', { path });
}

export function probeDocument(path: string): Promise<ProbeResult> {
  return invoke<ProbeResult>('probe_document', { path });
}

/**
 * S07 统一文件准备：读盘前归属查询（本窗口在途/已开、其他窗口已开直接返回）、
 * 在途去重、blocking worker 读取与判别。
 */
export function prepareDocument(label: string, path: string, maxReadBytes?: number): Promise<PreparedDocument> {
  return invoke<PreparedDocument>('prepare_document', { label, path, maxReadBytes });
}

export function writeDocument(
  path: string,
  content: string,
  encoding: Encoding,
  eol: Eol,
): Promise<WriteResult> {
  return invoke<WriteResult>('write_document', { path, content, encoding, eol });
}

/** Publish only a content-addressed recovery image; native code verifies bytes and never replaces another file. */
export function publishRecoveryImage(source: string, directory: string): Promise<string> {
  return invoke<string>('publish_recovery_image', { source, directory });
}
export function storeImageAsset(directory: string, extension: string, data: Uint8Array): Promise<string> {
  return invoke<string>('store_image_asset', data, { headers: {
    'x-noteboard-image': `directory=${encodeURIComponent(directory)}&extension=${encodeURIComponent(extension)}`,
  } });
}

/** Keep encoded image bytes out of JSON and atomically save the chosen export. */
export function writeImageEdit(path: string, data: Uint8Array): Promise<WriteResult> {
  return invoke<WriteResult>('write_image_edit', data, { headers: {
    'x-noteboard-image-edit': `path=${encodeURIComponent(path)}`,
  } });
}

// 保存二进制文件（如粘贴或插入的图片数据）
export function saveBinaryFile(
  path: string,
  data: Uint8Array | number[],
): Promise<WriteResult> {
  return invoke<WriteResult>('save_binary_file', {
    path,
    data: Array.from(data),
  });
}

export function readDir(path: string, showHidden: boolean): Promise<FileTreeNode[]> {
  return invoke<FileTreeNode[]>('read_dir', { path, showHidden });
}

/** Grant the non-recursive scope before subscribing to an opened directory. */
export function prepareDirectoryWatch(path: string): Promise<void> {
  return invoke<void>('prepare_directory_watch', { path });
}

export function createFile(
  dir: string,
  name: string,
  template: string,
): Promise<DocumentPayload> {
  return invoke<DocumentPayload>('create_file', { dir, name, template });
}

export function createDir(dir: string, name: string): Promise<void> {
  return invoke<void>('create_dir', { dir, name });
}

export function renamePath(label: string, from: string, to: string, expectedKeys: string[]): Promise<void> {
  return invoke<void>('rename_path', { label, from, to, expectedKeys });
}
export interface BrowseLocation { name: string; path: string; kind: 'folder' | 'drive' }
export function browseLocations(): Promise<BrowseLocation[]> { return invoke('browse_locations'); }

export function moveToTrash(path: string): Promise<void> {
  return invoke<void>('move_to_trash', { path });
}

export function recycleDocumentImage(documentPath: string, imagePath: string, imageDirectory: string, referenceRoot: string | null) {
  return invoke<{ ticket: string; path: string }>('recycle_document_image', { documentPath, imagePath, imageDirectory, referenceRoot });
}
export function recycleDocumentImages(documentPath: string, imagePaths: string[], imageDirectory: string, referenceRoot: string | null) {
  return invoke<Array<{ path: string; ticket?: string; error?: string }>>('recycle_document_images',
    { documentPath, imagePaths, imageDirectory, referenceRoot });
}
export function restoreDocumentImage(ticket: string): Promise<void> {
  return invoke<void>('restore_document_image', { ticket });
}

export function pathExists(path: string): Promise<PathExistsResult> {
  return invoke<PathExistsResult>('path_exists', { path });
}

export function revealInExplorer(path: string): Promise<void> {
  return invoke<void>('reveal_in_explorer', { path });
}

export function openWithDefaultApp(path: string): Promise<void> {
  return invoke<void>('open_with_default_app', { path });
}

// ── 设置与系统 ──

export function loadSettings(): Promise<Settings> {
  return invoke<Settings>('load_settings');
}

export function defaultTypography(): Promise<Settings['typography']> {
  return invoke<Settings['typography']>('default_typography');
}

/** An explicit install supplies its starting selection; automatic startup supplies none. */
export function applyRecommendedFonts(expected?: Settings['typography']): Promise<Settings> {
  return invoke<Settings>('apply_recommended_fonts', { expected: expected ?? null });
}

export function saveSettings(settings: Settings): Promise<number> {
  return invoke<number>('save_settings', { settings });
}

export function patchSettings(patch: SettingsPatch): Promise<Settings> {
  return invoke<Settings>('patch_settings', { patch });
}

// ── 暂存 ──

/** 获取内置默认暂存目录，供设置页恢复默认。 */
export function getDefaultStagingDirectory(): Promise<string> {
  return invoke<string>('get_default_staging_directory');
}

/** 创建并返回当前设置对应的暂存目录。 */
export function ensureStagingDirectory(): Promise<string> {
  return invoke<string>('ensure_staging_directory');
}

/** 使用系统文件管理器打开当前暂存目录。 */
export function openStagingDirectory(): Promise<string> {
  return invoke<string>('open_staging_directory');
}

/** 批量写入未保存文档，并返回可复用的暂存路径。 */
export function stashDocuments(documents: StagingDocument[]): Promise<StagingResult[]> {
  return invoke<StagingResult[]>('stash_documents', { documents });
}

/** 正常保存或明确丢弃后清理本次编辑会话的暂存副本。 */
export function deleteStagedFile(path: string): Promise<void> {
  return invoke<void>('delete_staged_file', { path });
}

export function listSystemFonts(forceRefresh?: boolean): Promise<FontFamily[]> {
  return invoke<FontFamily[]>('list_system_fonts', { forceRefresh: forceRefresh ?? null });
}

/** 查询字体包状态；验证未完成时返回 verifying（SHA 在后台 worker 执行） */
export function getFontPackStatus(): Promise<FontPackStatus> {
  return invoke<FontPackStatus>('get_font_pack_status');
}

/** 显式修复/刷新：使后端缓存失效并强制重验 */
export function refreshFontPackStatus(): Promise<FontPackStatus> {
  return invoke<FontPackStatus>('refresh_font_pack_status');
}

/** 从固定 GitHub Release 下载、校验并原子安装应用字体包。 */
export function downloadFontPack(): Promise<FontPackStatus> {
  return invoke<FontPackStatus>('download_font_pack');
}

/** 导入离线 ZIP；Rust 端仍执行与在线包相同的固定哈希校验。 */
export function importFontPack(sourcePath: string): Promise<FontPackStatus> {
  return invoke<FontPackStatus>('import_font_pack', { sourcePath });
}

/** 删除当前应用字体包，不会触碰 Windows 系统字体。 */
export function removeFontPack(): Promise<FontPackStatus> {
  return invoke<FontPackStatus>('remove_font_pack');
}

// ── 会话 ──

export function loadSession(): Promise<SessionSnapshot | null> {
  return invoke<SessionSnapshot | null>('load_session');
}

export function saveSession(session: SessionSnapshot): Promise<void> {
  return invoke<void>('save_session', { session });
}

/** 完成恢复或关闭功能开关时清理最近关闭窗口快照。 */
export function clearSession(): Promise<void> {
  return invoke<void>('clear_session');
}

export function listRecent(): Promise<unknown[]> {
  return invoke<unknown[]>('list_recent');
}

export function pushRecent(path: string, isDir: boolean): Promise<void> {
  return invoke<void>('push_recent', { path, isDir });
}

export function writeDraft(key: string, content: string, kind: string): Promise<void> {
  return invoke<void>('write_draft', { key, content, kind });
}

export function deleteDraft(key: string): Promise<void> {
  return invoke<void>('delete_draft', { key });
}

export function listDrafts(): Promise<unknown[]> {
  return invoke<unknown[]>('list_drafts');
}

// ── 收藏夹 ──

export function loadFavorites(): Promise<FavoritesData> {
  return invoke<FavoritesData>('load_favorites');
}

export function saveFavorites(favorites: FavoritesData): Promise<void> {
  return invoke<void>('save_favorites', { favorites });
}

// ── 应用更新与外部链接 ──

// 检查 GitHub 最新版本
export function checkForUpdates(): Promise<UpdateCheckResult> {
  return invoke<UpdateCheckResult>('check_for_updates');
}

export function getDismissedUpdateNotices(): Promise<string[]> {
  return invoke<string[]>('get_dismissed_update_notices');
}

export function dismissUpdateNotice(version: string): Promise<void> {
  return invoke<void>('dismiss_update_notice', { version });
}

// 下载更新安装包并在落盘后启动安装器
export function downloadAndInstallUpdate(params: {
  downloadUrl: string;
  assetName: string;
  installerSize?: number | null;
}): Promise<string> {
  return invoke<string>('download_and_install_update', {
    downloadUrl: params.downloadUrl,
    assetName: params.assetName,
    installerSize: params.installerSize ?? null,
  });
}

// 使用系统默认浏览器打开外部超链接
export function openExternalUrl(url: string): Promise<boolean> {
  return invoke<boolean>('open_external_url', { url });
}

// ── 性能诊断（未启用时 Rust 侧为 no-op） ──

/** 批量上报 web 端 spans（时间原点为 performance.now，与 Rust 时钟分轴保存） */
export function recordWebSpans(label: string, spans: unknown[]): Promise<void> {
  return invoke<void>('record_web_spans', { label, spans });
}

/** 把当前进程已收集的全部 spans 批量写入临时目录，返回文件路径 */
export function dumpPerfSpans(reason: string): Promise<string | null> {
  return invoke<string | null>('dump_perf_spans', { reason });
}

