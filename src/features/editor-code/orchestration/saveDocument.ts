// NoteBoard 保存文档编排
// Ctrl+S / Ctrl+Shift+S → 脏态 → 原子写 → WriteError 分类提示
// 详见 docs/09-开发路线图.md 4.11

import { save } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import * as ipc from '../../../core/ipc/commands';
import { useDocumentStore } from '../../../stores/documentStore';
import { useWindowStore } from '../../../stores/windowStore';
import { getBaseline } from '../../editor-md/serialize';
import { kindFromPath, languageFromPath } from '../../../core/docKind';
import { DEFAULT_NATIVE_EXTENSION, NATIVE_DOCUMENT_EXTENSIONS } from '../../../core/nativeDocument';
import type { WriteError } from '../../../core/ipc/types';
import { DEFAULT_DRAWIO_XML } from './syncDocumentContent';
import { onDocumentSaved } from '../../staging/stagingManager';
import { showToast } from '../../../stores/toastStore';
import { noteSelfWrite } from '../../explorer/directoryWatcher';
import { normalizePath } from '../../explorer/pathUtils';
// 🔴 R01/N02：保存未加载的恢复标签前先按需加载正文；正文出口统一前置屏障
import { ensureWritableContent } from '../../session/closedWindowSession';
// 🔴 R3-02：无能力实例时保存前的 pending 物化（J2 未物化输入是正文权威）
import { flushPendingSourceSnapshot, flushPendingVisualSnapshot } from '../../../core/editor/pendingSnapshots';
// 🔴 R3-04：另存为事务的会话身份校验（对话框/授权/写盘每个 await 后验证）
import { getSessionGeneration } from '../../session/documentSession';
import { assertDocumentIdentity, commitDocumentIdentity, materializeIdentityPending, prepareDocumentIdentity, protectDocumentIdentity, refreshDocumentIdentity, type DocumentIdentityLease } from '../../session/documentIdentity';
// 🔴 S09：统一异步屏障 + 每文档串行写队列 + 身份迁移（H 节）
import {
  flushDocument,
  writeDocumentWithBarrier,
  enqueueDocumentWrite,
} from '../../session/documentSession';

// ── 保存单个文档 ──

/** 🔴 N03：最近一次保存的身份迁移结果（另存为：原 key → 新 key）；
 *    "保存并关闭"等调用方据此用实际新 key 继续后续流程（take 后清空） */
let lastSaveIdentityMove: { from: string; to: string } | null = null;

/** 读取并清空最近一次保存的身份迁移（未发生迁移为 null） */
export function takeLastSaveIdentityMove(): { from: string; to: string } | null {
  const move = lastSaveIdentityMove;
  lastSaveIdentityMove = null;
  return move;
}

/** 规范化路径身份比较（Windows 大小写不敏感） */
function samePathIdentity(a: string, b: string): boolean {
  return normalizePath(a).toLowerCase() === normalizePath(b).toLowerCase();
}

export async function saveDocument(docKey: string): Promise<boolean> {
  const store = useDocumentStore.getState();
  const doc = store.getDocument(docKey);
  if (!doc) {
    console.warn('saveDocument: 文档不存在', docKey);
    return false;
  }

  // 🔴 N02：正文出口统一前置屏障——未加载的恢复标签正文未知（content=null），
  //    先按需加载；失败/未知一律中止，绝不用空占位镜像或 '' 补成合法空文件写盘
  const writable = await ensureWritableContent(docKey);
  if (writable === null) {
    showToast('正文尚未加载完成，未执行保存', 'warning');
    return false;
  }

  // 🔴 S09：统一异步屏障捕获确切 revision 的权威快照（输入 A 立刻 Ctrl+S → 磁盘含 A）
  // 🔴 R3-02：无能力实例（source 首开尚未注册/内核替身环境）也必须先物化 pending——
  //    未物化的输入不能被旧镜像覆盖（J2 的 pending 是正文权威，与注册表无关）
  const captured = await flushDocument(docKey, 'save');
  let authoritativeContent: string | null = captured?.content ?? null;
  if (authoritativeContent === null) {
    // 无实例快照：按当前模式的 pending 物化（source/visual 分别尝试）
    const materializedSource = flushPendingSourceSnapshot(docKey);
    const materializedVisual = materializedSource === null
      ? flushPendingVisualSnapshot(docKey)
      : null;
    const materialized = materializedSource ?? materializedVisual;
    if (materialized !== null) {
      const storeNow = useDocumentStore.getState().getDocument(docKey);
      authoritativeContent = storeNow?.content ?? null;
    }
  }

  const updatedDoc = useDocumentStore.getState().getDocument(docKey);
  if (!updatedDoc) return false;

  // 🔴 N02：权威内容优先取 flush 快照（编辑器内核），无实例时回退镜像；
  //    两者皆未知（null）时中止——空字符串是合法正文，与"未知"严格区分
  if (authoritativeContent === null) {
    authoritativeContent = updatedDoc.content;
  }
  if (authoritativeContent == null) {
    showToast('无法获取文档正文，未执行保存', 'warning');
    return false;
  }

  // 运行期间原文件被删除后，Ctrl+S 也必须转为另存为，禁止悄悄在旧路径重建文件。
  const detached = useWindowStore.getState().getTab(docKey)?.isDetached ?? false;
  if (updatedDoc.externalStatus === 'deleted' || detached) {
    return saveAs(updatedDoc.key, authoritativeContent);
  }

  // 没有路径 → 另存为
  if (!updatedDoc.key || updatedDoc.key.startsWith('untitled:')) {
    return saveAs(updatedDoc.key, authoritativeContent);
  }

  // 🔴 S09：每文档写队列内完成写盘（旧写入不得覆盖新内容）、基线更新为实际写入文本、
  //    脏态 flush-and-compare 精确重算（写盘期间新输入仍脏；改回基线清脏）、
  //    携带内容证明的暂存清理（只删被覆盖副本）
  try {
    return await writeDocumentWithBarrier(docKey, authoritativeContent);
  } catch (e) {
    console.error('保存失败:', e);
    showWriteError({ kind: 'io', message: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

// ── 另存为 ──

/**
 * 另存为（🔴 N03 事务：授权 → 快照 → 写盘 → 提交身份迁移）。
 * @param _content 兼容保留的旧参数——快照统一在取得目标授权后从编辑器捕获
 */
export async function saveAs(originalKey: string, _content: string): Promise<boolean> {
  // 🔴 R3-04：会话身份必须在任何 await 之前捕获（含 ensureWritableContent 的
  //    按需加载）——对话框/加载期间源关闭重开（会话换代）时中止旧另存为（C06）
  const originalGeneration = getSessionGeneration(originalKey);
  // 🔴 N02：正文出口统一前置屏障——未加载的懒标签先按需加载（Ctrl+Shift+S
  //    直达入口同样受保护）；失败/未知一律中止，不用 '' 补成合法空文件
  const writable = await ensureWritableContent(originalKey);
  if (writable === null) {
    showToast('正文尚未加载完成，未执行另存为', 'warning');
    return false;
  }
  // 🔴 R3-04：加载 await 后会话身份校验（加载期间源被关闭/重开）
  if (getSessionGeneration(originalKey) !== originalGeneration) {
    showToast('文档已发生变更，另存为已取消', 'warning');
    return false;
  }
  // 另存为可能由“原文件已删除”提示触发，先抓取编辑器权威内容（统一屏障），避免写入防抖前的旧镜像。
  await flushDocument(originalKey, 'save');
  // 🔴 R3-04：flush await 后会话身份校验
  if (getSessionGeneration(originalKey) !== originalGeneration) {
    showToast('文档已发生变更，另存为已取消', 'warning');
    return false;
  }
  const doc = useDocumentStore.getState().getDocument(originalKey);

  let defaultExtension = 'txt';
  let filters: Array<{ name: string; extensions: string[] }> = [
    { name: '文本文档 (*.txt)', extensions: ['txt'] },
    { name: '全部文件 (*.*)', extensions: ['*'] },
  ];

  if (doc?.kind === 'noteboard') {
    defaultExtension = DEFAULT_NATIVE_EXTENSION;
    filters = NATIVE_DOCUMENT_EXTENSIONS.map(ext => ({ name: `NoteBoard 文档 (*.${ext})`, extensions: [ext] }));
  } else if (doc?.kind === 'markdown' || originalKey.includes('markdown')) {
    defaultExtension = 'md';
    filters = [
      { name: 'Markdown 笔记 (*.md)', extensions: ['md', 'markdown'] },
      { name: '全部文件 (*.*)', extensions: ['*'] },
    ];
  } else if (doc?.kind === 'bitable' || originalKey.includes('bitable') || originalKey.includes('table')) {
    // 多维表格保存为 .bitable 格式，避免因 language 为 json 误回退到 .json 扩展名
    defaultExtension = 'bitable';
    filters = [
      { name: '多维表格 (*.bitable)', extensions: ['bitable', 'table'] },
      { name: '全部文件 (*.*)', extensions: ['*'] },
    ];
  } else if (doc?.kind === 'mindmap' || originalKey.includes('mindmap')) {
    defaultExtension = 'mindmap';
    filters = [
      { name: '思维导图文件 (*.mindmap)', extensions: ['mindmap'] },
      { name: 'XMind 思维导图 (*.xmind)', extensions: ['xmind'] },
      { name: '全部文件 (*.*)', extensions: ['*'] },
    ];
  } else if (doc?.kind === 'drawio' || originalKey.includes('drawio')) {
    defaultExtension = 'drawio';
    filters = [
      { name: 'Draw.io 架构图 (*.drawio)', extensions: ['drawio'] },
      { name: 'Draw.io XML (*.xml)', extensions: ['xml'] },
      { name: '全部文件 (*.*)', extensions: ['*'] },
    ];
  } else if (doc?.kind === 'board' || originalKey.includes('board') || originalKey.includes('excalidraw')) {
    defaultExtension = 'excalidraw';
    filters = [
      { name: '自由画板 (*.excalidraw)', extensions: ['excalidraw', 'board', 'canvas'] },
      { name: '全部文件 (*.*)', extensions: ['*'] },
    ];
  } else if (doc?.language === 'mermaid' || originalKey.includes('mermaid')) {
    defaultExtension = 'mmd';
    filters = [
      { name: 'Mermaid 图表 (*.mmd)', extensions: ['mmd', 'mermaid'] },
      { name: '全部文件 (*.*)', extensions: ['*'] },
    ];
  } else if (doc?.language === 'infographic' || originalKey.includes('infographic')) {
    defaultExtension = 'infographic';
    filters = [
      { name: '信息图源码 (*.infographic)', extensions: ['infographic', 'ig'] },
      { name: '全部文件 (*.*)', extensions: ['*'] },
    ];
  } else if (doc?.language === 'plantuml' || originalKey.includes('plantuml')) {
    defaultExtension = 'puml';
    filters = [
      { name: 'PlantUML 图表 (*.puml)', extensions: ['puml', 'plantuml', 'iuml', 'uml'] },
      { name: '全部文件 (*.*)', extensions: ['*'] },
    ];
  } else if (doc?.language === 'json' || originalKey.includes('json')) {
    defaultExtension = 'json';
    filters = [
      { name: 'JSON 数据 (*.json)', extensions: ['json'] },
      { name: '全部文件 (*.*)', extensions: ['*'] },
    ];
  } else if (doc?.language === 'yaml' || originalKey.includes('yaml')) {
    defaultExtension = 'yaml';
    filters = [
      { name: 'YAML 配置文件 (*.yaml, *.yml)', extensions: ['yaml', 'yml'] },
      { name: '全部文件 (*.*)', extensions: ['*'] },
    ];
  } else if (doc?.language === 'sql' || originalKey.includes('sql')) {
    defaultExtension = 'sql';
    filters = [
      { name: 'SQL 脚本 (*.sql)', extensions: ['sql'] },
      { name: '全部文件 (*.*)', extensions: ['*'] },
    ];
  } else if (doc?.language === 'xml' || originalKey.includes('xml')) {
    defaultExtension = 'xml';
    filters = [
      { name: 'XML 文档 (*.xml)', extensions: ['xml'] },
      { name: '全部文件 (*.*)', extensions: ['*'] },
    ];
  }

  const defaultPath = doc?.displayName || `未命名.${defaultExtension}`;

  try {
    const selectedPath = await save({
      defaultPath,
      filters,
    });

    if (!selectedPath) return false;

    // 🔴 N03：目标等于原路径（规范化身份比较）→ 普通保存语义，
    //    避免重复标签与历史串线
    if (!originalKey.startsWith('untitled:') && samePathIdentity(selectedPath, originalKey)) {
      return saveDocument(originalKey);
    }

    const encoding = doc?.encoding ?? 'utf8';
    const eol = doc?.eol ?? 'lf';
    const kind = kindFromPath(selectedPath);
    if ((doc?.kind === 'noteboard') !== (kind === 'noteboard')) {
      showToast('请在“导出”中转换 NoteBoard 文档与 Markdown 格式', 'warning');
      return false;
    }
    const language = languageFromPath(selectedPath);
    const label = getCurrentWindow().label;

    // ── 🔴 N03/R3-04 另存为事务：同窗口冲突检查 → 授权 → 快照 → 写盘 → 提交身份迁移 ──

    // 第 0 步：🔴 R3-04 同窗口冲突前端自查。Rust 同 owner 幂等 register 返回 ok
    //    （IPC 契约不提供 already-open(self) 分支）——目标标签已在本窗口打开时，
    //    由前端检查目标标签并中止，不覆盖目标正文、不产生重复 key（C04）
    if (useWindowStore.getState().getTab(selectedPath)) {
      showToast('目标文件已在本窗口打开，请先关闭对应标签后重试', 'warning');
      return false;
    }
    // 🔴 R3-04：对话框 await 后会话身份校验——源已关闭/重开则中止
    if (getSessionGeneration(originalKey) !== originalGeneration) {
      showToast('文档已发生变更，另存为已取消', 'warning');
      return false;
    }

    // 第 1 步：先取得目标写入授权（register 先于任何写盘）。
    //    其它窗口占用（already-open 且 owner≠本窗口）、注册异常——中止，零写盘。
    //    🔴 R3-04：授权结果记录 newlyOwned——写盘/迁移失败时按 finally 释放本次
    //    新取得的目标归属（不误注销原已存在的目标，C05）
    let regResult: Awaited<ReturnType<typeof ipc.registerDocument>>;
    let newlyOwned = false;
    try {
      regResult = await ipc.registerDocument(label, selectedPath, kind);
    } catch (e) {
      console.error('另存为：注册目标所有权失败:', e);
      showToast('无法取得目标文件的所有权，另存为已取消', 'error');
      return false;
    }
    if (regResult.type === 'already-open') {
      showToast(
        regResult.ownerLabel === label
          ? '目标文件已在本窗口打开，请先关闭对应标签后重试'
          : `目标文件已在其它窗口打开（${regResult.ownerLabel}），请先关闭后重试`,
        'warning',
      );
      return false;
    }
    // 后端返回 ok：目标此前无归属——本次新取得授权（失败时按 finally 释放）
    newlyOwned = true;
    let identityLease: DocumentIdentityLease | undefined;
    let sourceOwnershipReleased = false;

    try {
      // 🔴 R3-04：授权 await 后会话身份再校验
      if (getSessionGeneration(originalKey) !== originalGeneration) {
        showToast('文档已发生变更，另存为已取消', 'warning');
        return false;
      }

      identityLease = protectDocumentIdentity(originalKey);
      await prepareDocumentIdentity(identityLease);

      // 第 2 步：对话框返回后重新捕获快照——对话框期间的合法编辑（含清空为 ''）
      //    必须随另存为写入，不得使用打开对话框前的旧正文
      const captured = await flushDocument(originalKey, 'save');
      const docNow = useDocumentStore.getState().getDocument(originalKey);
      const snapshot = captured?.content ?? docNow?.content;
      if (snapshot == null) {
        showToast('无法获取文档正文，另存为已取消', 'warning');
        return false;
      }
      let saveContent = (doc?.kind === 'drawio' && !snapshot.trim()) ? DEFAULT_DRAWIO_XML : snapshot;
      const capturedContent = saveContent;
      let nativeWritten: Awaited<ReturnType<typeof import('../../document-format/nativeSaveAs').saveNativeAs>> | undefined;

      // 第 3 步：写盘（目标 key 的每文档写队列内；保存后 autosave 以新 key 排队，
      //    防止旧内容迟到覆盖）。失败时保留权威内容、dirty、历史和原身份——不迁移。
      //    🔴 R3-04：失败释放本次新取得的目标归属（finally 统一处理）
      const result = await enqueueDocumentWrite(selectedPath, async () => {
        if (doc?.kind === 'markdown' || doc?.kind === 'noteboard' || /\.(?:html?|mdx)$/i.test(originalKey)) {
          const { restoreImageAssetsForContent } = await import('../../editor-md/imageAssetLifecycle');
          await restoreImageAssetsForContent(originalKey, saveContent);
        }
        if (getSessionGeneration(originalKey) !== originalGeneration) {
          throw new Error('文档会话已结束，另存为已取消');
        }
        let writeResult;
        if (docNow?.kind === 'noteboard') {
          const { saveNativeAs } = await import('../../document-format/nativeSaveAs');
          const written = await saveNativeAs(docNow, selectedPath, saveContent);
          nativeWritten = written;
          saveContent = written.content;
          writeResult = { ok: written.result.ok, mtime: written.result.native?.mtime ?? 0, size: written.result.native?.size ?? 0,
            ...(written.result.error ? { error: { kind: 'io' as const, message: written.result.error.message } } : {}) };
          if (written.result.ok && written.request.markdown) noteSelfWrite(written.request.markdown.path);
        } else writeResult = await ipc.writeDocument(selectedPath, saveContent, encoding, eol);
        noteSelfWrite(selectedPath);
        return writeResult;
      });
      if (!result.ok) {
        if (result.error) showWriteError(result.error);
        return false;
      }

      // 🔴 R3-04：写盘 await 后会话身份再校验——源已被迁走/关闭则中止（不提交迁移）
      if (getSessionGeneration(originalKey) !== originalGeneration) {
        return false;
      }

      // The final barriers precede generation migration. Pending input arriving
      // during any await is materialized while its source generation is valid.
      const nativeCodec = docNow?.kind === 'noteboard' ? await import('../../../core/nativeDocument') : null;
      const nativeRelocation = nativeCodec ? await import('../../document-format/nativeRelocation') : null;
      const linkedPath = nativeWritten?.request.markdown?.path;
      if (linkedPath && useDocumentStore.getState().getDocument(linkedPath)) await flushDocument(linkedPath, 'save');
      await prepareDocumentIdentity(identityLease);
      await refreshDocumentIdentity(identityLease);
      try {
        await ipc.unregisterDocument(label, originalKey);
        sourceOwnershipReleased = true;
      } catch { /* native reconciliation releases a stale original registration */ }
      assertDocumentIdentity(identityLease);
      // Keep the original generation valid through the final await. Consuming
      // source/visual pending after migrateSession would discard this input.
      materializeIdentityPending(originalKey);
      let finalContent = saveContent;

      const displayName = selectedPath.split(/[\\/]/).pop() ?? selectedPath;
      const dirPath = selectedPath.substring(0, selectedPath.lastIndexOf('\\')) || selectedPath;

      commitDocumentIdentity(originalKey, selectedPath, () => {
        // This is the last source-pending materialization boundary. No await may
        // separate this read from publishing the new identity.
        const latest = useDocumentStore.getState().getDocument(originalKey)?.content ?? capturedContent;
        finalContent = latest === capturedContent ? saveContent : latest;
        if (nativeCodec && nativeRelocation && latest !== capturedContent) {
          finalContent = nativeRelocation.relocatePendingNativeSource(latest, originalKey, selectedPath, nativeCodec.readNativeMetadata(saveContent));
        }
        useDocumentStore.getState().remove(originalKey);
        useDocumentStore.getState().upsertFromPayload({
          key: selectedPath,
          displayName,
          dirPath,
          kind,
          language,
          content: finalContent,
          encoding,
          eol,
          size: result.size,
          mtime: result.mtime,
          readonly: false,
        });
        // Baseline is the actual write; later input stays dirty in the new session.
        useDocumentStore.getState().updateBaseline(selectedPath, saveContent, result.mtime, result.size);
        getBaseline(selectedPath).updateBaseline(saveContent);
        useWindowStore.getState().updateTabPath(originalKey, selectedPath, displayName);
        useWindowStore.getState().setTabDirty(selectedPath, finalContent !== saveContent);
      });

      // 🔴 N03：记录身份迁移——“保存并关闭”等调用方用实际新 key 继续后续流程
      lastSaveIdentityMove = { from: originalKey, to: selectedPath };

      // 事务成功：身份已提交给新 key——授权随迁移兑现（不再释放）
      newlyOwned = false;
      if (nativeWritten) {
        const { commitNativeSaveMetadata } = await import('../../document-format/nativeSaveCommit');
        commitNativeSaveMetadata(selectedPath, nativeWritten);
      }
      await onDocumentSaved(selectedPath, saveContent);
      return true;
    } finally {
      identityLease?.release();
      // 🔴 R3-04：未提交成功的目标授权按 token 释放（写盘/迁移/快照失败均覆盖）
      if (newlyOwned) {
        if (sourceOwnershipReleased && getSessionGeneration(originalKey) === originalGeneration && useDocumentStore.getState().hasDocument(originalKey)) {
          try {
            const restored = await ipc.registerDocument(label, originalKey, doc?.kind ?? kindFromPath(originalKey));
            if (restored.type === 'already-open' && restored.ownerLabel !== label) {
              useWindowStore.getState().setTabDetached(originalKey, true);
              showToast('原路径已由其它窗口打开，未保存内容已保留，请另存为新文件', 'warning');
            }
          } catch (error) {
            useWindowStore.getState().setTabDetached(originalKey, true);
            console.error('另存为失败后恢复原文档归属失败:', error);
          }
        }
        try {
          await ipc.unregisterDocument(label, selectedPath);
        } catch {
          // 非关键：reconcile 兜底
        }
      }
    }
  } catch (err) {
    console.error('另存为失败:', err);
    showWriteError({ kind: 'io', message: err instanceof Error ? err.message : String(err) });
  }

  return false;
}

// ── WriteError 分类提示 ──

export function getWriteErrorMessage(error: WriteError): string {
  switch (error.kind) {
    case 'permission-denied':
      return `没有权限写入文件：${error.path}`;
    case 'disk-full':
      return '磁盘空间不足，无法保存';
    case 'file-locked':
      return `文件被其他程序锁定：${error.path}`;
    case 'readonly':
      return `文件是只读的：${error.path}`;
    case 'path-not-found':
      return `路径不存在：${error.path}`;
    case 'io':
      return `写入出错：${error.message}`;
  }
}

export function showWriteError(error: WriteError): void {
  const msg = getWriteErrorMessage(error);
  console.error('保存错误:', msg);
}
