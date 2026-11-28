import { customCodeMirrorShortcuts } from '../../core/editor/customShortcuts';
// NoteBoard CodeMirror 6 编辑器组件
// 裸 CM6（new EditorView / EditorState.create），挂载到 DOM
// 详见 docs/09-开发路线图.md 4.1

import { useCallback, useEffect, useRef } from 'react';
import {
  EditorView,
  keymap,
} from '@codemirror/view';
import { Annotation, EditorState, Prec, Transaction } from '@codemirror/state';
import { undoDepth as cmUndoDepth } from '@codemirror/commands';
import {
  createBaseExtensions,
  editorHistory,
  editorLineNumberEffect,
  historyCompartment,
  languageCompartment,
  typographyCompartment,
} from './setup';
import { bindLiveEditorSettings } from './editorSettingsBinding';
import { loadLanguageExtension } from './languages';
import { getLinterForLanguage } from './lint';
import { getAnalysisOwner } from './textAnalysisLifecycle';
import {
  handleExpandJson,
  handleMinifyJson,
  validateTextLanguage,
  textAnalysisLifecycle,
} from './jsonOps';
import type { LanguageId } from '../../core/ipc/types';
import { useDocumentStore } from '../../stores/documentStore';
import { useWindowStore } from '../../stores/windowStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { normalizeEol } from '../editor-md/serialize';
import {
  bumpDocumentRevision,
  registerEditorCapabilities,
} from '../../core/editor/editorRegistry';
// 🔴 S09：自动保存统一走每文档写队列
import { getSessionGeneration, queuedAutoSave, submitCapturedContent } from '../session/documentSession';
import { perfMarkEditorInstanceReady } from '../../core/perf/editorReadyMark';
// 🔴 S11：回收前的视图状态在重挂载时恢复（选区/滚动/折叠）
import { takeViewState } from '../session/editorSuspension';
import { foldEffect } from '@codemirror/language';
import { createCodeEditorCapabilities } from './editorCapabilities';
import { codeCursorTracker } from './codeCursorTracker';
import { codeJumpHistory } from './codeNavigation';
import { createCodeSnapshot } from './codeSnapshot';
import { FileTextPreview } from './FileTextPreview';
import { ExternalChangeBanner } from '../external/ExternalChangeBanner';
import { getFileFormat, isCodeSourceFile } from '../../core/fileFormats';
import { getEditorCapabilities } from '../../core/editor/editorRegistry';
import { registerShortcut } from '../../core/shortcuts';
import { useResolvedShortcutLabel } from '../../core/useShortcutBindings';
import { DocumentModeToggle } from '../../components/DocumentModeToggle';
import { switchFilePreviewMode, toggleFilePreviewMode, useFilePreviewMode, type FilePreviewMode } from './filePreviewMode';
import {
  initializeDocumentHistory,
  getCurrentDocumentHistoryContent,
  isApplyingDocumentHistory,
  notifyDocumentHistoryPendingInput,
  recordDocumentChange,
  redoDocumentHistory,
  registerDocumentHistoryAdapter,
  registerDocumentHistoryPendingInput,
  registerHistoryMaterializeHook,
  undoDocumentHistory,
} from '../history/documentHistory';

// ── 实例代际 ──

/** CodeMirror 实例代际序号：同一 docKey 重挂载时递增，用于注册表删除保护 */
let nextEditorInstanceId = 0;
const replaceFromDiskTransaction = Annotation.define<boolean>();

// ── React 组件 ──

interface CodeEditorProps {
  docKey: string;
}

function readFileEditorSettings(docKey: string, language: LanguageId) {
  const settings = useSettingsStore.getState().settings.editor;
  return { ...settings, showLineNumbers: isCodeSourceFile(docKey, language) || settings.showLineNumbers };
}

export function CodeEditor({ docKey }: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const doc = useDocumentStore((s) => s.documents.get(docKey));
  const format = getFileFormat(docKey);
  const hasPreview = format.preview === 'html' || format.preview === 'delimited';
  const fileMode = useFilePreviewMode(docKey);
  const previousFileMode = useRef(fileMode);
  const setTabDirty = useWindowStore((s) => s.setTabDirty);
  const typography = useSettingsStore((s) => s.settings.typography);

  const showSource = useCallback(() => {
    if (useWindowStore.getState().activeKey === docKey) switchFilePreviewMode(docKey, 'source');
  }, [docKey]);

  useEffect(() => {
    if (format.preview !== 'html') return;
    return registerShortcut({
      id: 'markdown.mode',
      key: 'Ctrl+/',
      scope: 'global',
      description: '切换 HTML 预览与源码',
      stopPropagation: true,
      allowRepeat: false,
      when: () => useWindowStore.getState().activeKey === docKey,
      action: () => toggleFilePreviewMode(docKey),
    });
  }, [docKey, format.preview]);

  // 监听排版字体与字号变化并热重配 CM6，并刷新字符度量
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const typographyExt = EditorView.theme({
      '&': {
        fontFamily: 'var(--mono-font-family)',
        fontSize: 'var(--mono-font-size)',
        height: '100%',
        caretColor: 'var(--cm-cursor)',
      },
      '.cm-scroller': {
        lineHeight: 'var(--mono-line-height, 1.5)',
        fontFamily: 'var(--mono-font-family)',
        fontSize: 'var(--mono-font-size)',
      },
      '.cm-content, .cm-line': {
        fontFamily: 'var(--mono-font-family)',
        fontSize: 'var(--mono-font-size)',
        caretColor: 'var(--cm-cursor)',
      },
      '.cm-content': {
        padding: '16px 24px',
        caretColor: 'var(--cm-cursor)',
      },
    });
    view.dispatch({
      effects: typographyCompartment.reconfigure(typographyExt),
    });
    // 强制触发字符度量重排，确保光标与字符宽度即时贴合新字体
    view.requestMeasure();
  }, [
    typography.monoFontFamily,
    typography.monoFontFamilyZh,
    typography.monoFontSize,
    typography.monoLineHeight,
  ]);

  useEffect(() => {
    const fromPreview = previousFileMode.current === 'preview';
    previousFileMode.current = fileMode;
    if (hasPreview && fileMode === 'preview') return;
    // A replacement instance must start from the previous owner's confirmed
    // group, before taking ownership of the capability registration.
    getCurrentDocumentHistoryContent(docKey);
    const currentDoc = useDocumentStore.getState().getDocument(docKey);
    if (!containerRef.current || !currentDoc) return;
    const container = containerRef.current;
    const lang = currentDoc.language;
    const currentLanguage = () => useDocumentStore.getState().getDocument(docKey)?.language ?? lang;
    const readEditorSettings = () => readFileEditorSettings(docKey, currentLanguage());
    initializeDocumentHistory(docKey, currentDoc.content ?? '', 'code');
    const instanceId = `cm-${(nextEditorInstanceId += 1)}`;
    const sessionGeneration = getSessionGeneration(docKey);
    const isCurrent = () => getSessionGeneration(docKey) === sessionGeneration
      && getEditorCapabilities(docKey)?.instanceId === instanceId
      && useDocumentStore.getState().getDocument(docKey) !== undefined;
    const mirrorContent = (content: string, revision: number) => {
      const previous = useDocumentStore.getState().getDocument(docKey);
      if (!submitCapturedContent(docKey, { instanceId, revision, content }, sessionGeneration)) return;
      const latest = useDocumentStore.getState().getDocument(docKey);
      if (!latest) return;
      // setContent already compares changed mirrors to the baseline. If Text
      // returned to the existing mirror, clear the conservative dirty flag here.
      const isDirty = previous?.content === content
        ? normalizeEol(content) !== normalizeEol(latest.baselineContent)
        : latest.isDirty;
      useDocumentStore.getState().setDirty(docKey, isDirty);
      setTabDirty(docKey, isDirty);
    };
    const snapshot = createCodeSnapshot({
      isCurrent,
      commit: (content, revision, options) => {
        recordDocumentChange(docKey, content, options);
        mirrorContent(content, revision);
      },
      pendingChanged: () => notifyDocumentHistoryPendingInput(docKey),
    });

    // 内容变更监听 → 更新 store（防抖 500ms）及自动保存（800ms，仅在 auto 策略时）
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
    const updateListener = EditorView.updateListener.of((update) => {
      if (!update.docChanged || !isCurrent()) return;

      if (debounceTimer) clearTimeout(debounceTimer);
      if (autoSaveTimer) clearTimeout(autoSaveTimer);
      // The conflict resolver publishes the revision and disk baseline together.
      if (update.transactions.some(tr => tr.annotation(replaceFromDiskTransaction))) return;
      // 🔴 内容版本递增：真实修改（含撤销/重做引起的变化）都推进 revision，
      //    供注册表 flush 快照与后续迁移校验使用
      const revision = bumpDocumentRevision(docKey);
      // The history adapter already owns the exact restored string. It updates
      // the mirror after dispatch, without creating a delayed input group.
      if (isApplyingDocumentHistory(docKey)) return;

      const targetDoc = useDocumentStore.getState().getDocument(docKey);
      snapshot.stage({
        text: update.state.doc,
        revision,
        startsNewGroup: cmUndoDepth(update.state) > cmUndoDepth(update.startState),
        beforeSelection: {
          anchor: update.startState.selection.main.anchor,
          head: update.startState.selection.main.head,
        },
        selection: {
          anchor: update.state.selection.main.anchor,
          head: update.state.selection.main.head,
        },
      });
      // Pending immutable input is protected immediately. Exact comparison and
      // the history diff run only when its current group is materialized.
      setTabDirty(docKey, true);
      useDocumentStore.getState().setDirty(docKey, true);
      debounceTimer = setTimeout(() => {
        snapshot.flushPending();
      }, 500);

      // 若处于 auto 自动保存策略，800ms 防抖写入磁盘
      // 🔴 S09：统一走每文档写队列（策略/外部状态/基线检查 + flush-and-compare 脏态 + 带证明暂存清理）
      if (targetDoc?.savePolicy === 'auto') {
        autoSaveTimer = setTimeout(async () => {
          try {
            const content = snapshot.read(view.state.doc);
            if (content !== null) await queuedAutoSave(docKey, content);
          } catch (e) {
            console.error('代码/文本文件自动保存失败:', e);
          }
        }, 800);
      }
    });

    // JSON 与代码操作快捷键（展开、压缩、校验）
    const formatCurrent = (view: EditorView) => handleExpandJson(view, { lang: currentLanguage() });
    const minifyCurrent = (view: EditorView) => currentLanguage() === 'json' && handleMinifyJson(view, { lang: currentLanguage() });
    const validateCurrent = (view: EditorView) => validateTextLanguage(view, currentLanguage());
    const jsonOperationsKeymap = keymap.of([
      // 展开 / 格式化：Shift+Alt+F (VS Code 标准) 或 Mod-Alt-l (JetBrains 标准) 或 Mod-Alt-f
      {
        key: 'Shift-Alt-f',
        run: formatCurrent,
      },
      {
        key: 'Alt-Shift-f',
        run: formatCurrent,
      },
      {
        key: 'Mod-Alt-l',
        run: formatCurrent,
      },
      {
        key: 'Mod-Alt-f',
        run: formatCurrent,
      },
      // 压缩：Shift+Alt+M 或 Mod-Alt-m
      {
        key: 'Shift-Alt-m',
        run: minifyCurrent,
      },
      {
        key: 'Alt-Shift-m',
        run: minifyCurrent,
      },
      {
        key: 'Mod-Alt-m',
        run: minifyCurrent,
      },
      // 校验：Shift+Alt+V 或 Mod-Alt-v 或 Mod-Alt-j
      {
        key: 'Shift-Alt-v',
        run: validateCurrent,
      },
      {
        key: 'Alt-Shift-v',
        run: validateCurrent,
      },
      {
        key: 'Mod-Alt-v',
        run: validateCurrent,
      },
      {
        key: 'Mod-Alt-j',
        run: validateCurrent,
      },
    ]);

    // 最高优先级接管撤销/重做，防止落入当前 CodeMirror 实例的局部历史
    const unifiedHistoryKeymap = Prec.highest(keymap.of([
      {
        key: 'Mod-z',
        run: () => {
          undoDocumentHistory(docKey);
          return true;
        },
      },
      {
        key: 'Mod-y',
        mac: 'Mod-Shift-z',
        run: () => {
          redoDocumentHistory(docKey);
          return true;
        },
      },
      {
        linux: 'Ctrl-Shift-z',
        run: () => {
          redoDocumentHistory(docKey);
          return true;
        },
      },
    ]));

    // 代码与纯文本排版（由 --mono-* CSS 变量驱动，并绑定主题光标）
    const typographyExt = EditorView.theme({
      '&': {
        fontFamily: 'var(--mono-font-family)',
        fontSize: 'var(--mono-font-size)',
        height: '100%',
        caretColor: 'var(--cm-cursor)',
      },
      '.cm-scroller': {
        lineHeight: 'var(--mono-line-height, 1.5)',
        fontFamily: 'var(--mono-font-family)',
        fontSize: 'var(--mono-font-size)',
      },
      '.cm-content, .cm-line': {
        fontFamily: 'var(--mono-font-family)',
        fontSize: 'var(--mono-font-size)',
        caretColor: 'var(--cm-cursor)',
      },
      '.cm-content': {
        // 移除 margin: 0 auto 与 maxWidth，避免破坏 CodeMirror 虚拟选区坐标
        padding: '16px 24px',
        caretColor: 'var(--cm-cursor)',
      },
    });

    // 创建编辑器状态与实例（createBaseExtensions 已包含 typographyCompartment 与 languageCompartment）
    const state = EditorState.create({
      doc: currentDoc.content ?? '',
      extensions: [
        customCodeMirrorShortcuts('code'),
        codeCursorTracker,
        codeJumpHistory,
        unifiedHistoryKeymap,
        ...createBaseExtensions(readEditorSettings()),
        textAnalysisLifecycle,
        bindLiveEditorSettings(readEditorSettings),
        updateListener,
        jsonOperationsKeymap,
      ],
    });

    const view = new EditorView({
      state,
      parent: container,
    });

    // 🔴 注册能力到 core 注册表（保存/搜索/工具栏统一入口）；
    // instanceId 保证旧实例的 disposer 无权删除新实例的注册
    const disposeCapabilities = registerEditorCapabilities(
      createCodeEditorCapabilities(docKey, instanceId, view, lang as LanguageId, {
        materialize: () => snapshot.read(view.state.doc),
        hasPending: snapshot.hasPending,
      }),
    );
    viewRef.current = view;
    snapshot.accept(view.state.doc, currentDoc.content?.replace(/\r\n?/g, '\n') ?? '');
    const unregisterPendingInput = registerDocumentHistoryPendingInput(docKey, snapshot.hasPending);
    const unregisterMaterialize = registerHistoryMaterializeHook(key => {
      if (key === docKey) snapshot.flushPending();
    });

    // 🔴 N10.2：编辑器实例与能力注册完成的里程碑（requestId 与打开请求对齐；
    //    诊断不记完整路径——只保留尾部 40 字符）
    //    （代理标记：真正 interactive = 该标记 + 首笔输入可进历史，后者由同步事务锁保证）
    perfMarkEditorInstanceReady(docKey, instanceId);

    // 🔴 S11：恢复回收前保存的视图状态（选区/滚动/折叠；一次性消费）
    const restoredState = takeViewState(docKey) as {
      kind: 'code';
      selection: { anchor: number; head: number } | null;
      scrollTop: number;
      foldedRanges: Array<{ from: number; to: number }>;
    } | null;
    if (restoredState?.kind === 'code') {
      const validFolds = restoredState.foldedRanges.filter(range => range.from >= 0 && range.from < range.to && range.to <= view.state.doc.length);
      if (validFolds.length > 0) {
        view.dispatch({
          effects: validFolds.map((range) => foldEffect.of(range)),
        });
      }
      if (restoredState.selection) {
        const max = view.state.doc.length;
        view.dispatch({
          selection: {
            anchor: Math.max(0, Math.min(restoredState.selection.anchor, max)),
            head: Math.max(0, Math.min(restoredState.selection.head, max)),
          },
        });
      }
      if (restoredState.scrollTop > 0 && view.scrollDOM) {
        view.scrollDOM.scrollTop = restoredState.scrollTop;
      }
    }
    if (format.preview === 'html' && fromPreview && useWindowStore.getState().activeKey === docKey) {
      view.focus();
    }

    // 将统一历史节点应用到当前代码编辑器；程序化替换明确不进入原生历史
    const unregisterHistoryAdapter = registerDocumentHistoryAdapter(docKey, {
      replaceFromDisk: (content) => {
        if (view.composing) throw new Error('请先完成当前输入，再重新加载。');
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: content },
          annotations: [Transaction.addToHistory.of(false), replaceFromDiskTransaction.of(true)],
          effects: historyCompartment.reconfigure([]),
        });
        view.dispatch({ effects: historyCompartment.reconfigure(editorHistory) });
        snapshot.accept(view.state.doc, normalizeEol(content));
        return 'code';
      },
      applyEntry: (entry, navigation) => {
        const documentLength = view.state.doc.length;
        const preferredSelection = navigation.selectionMode === 'code'
          ? navigation.selection
          : undefined;
        // 跨模式历史没有可直接复用的选区坐标时，定位到前后快照首个差异字符
        const fallbackPosition = Math.min(navigation.changeOffset, entry.content.length);
        const anchor = Math.max(0, Math.min(preferredSelection?.anchor ?? fallbackPosition, entry.content.length));
        const head = Math.max(0, Math.min(preferredSelection?.head ?? anchor, entry.content.length));
        view.dispatch({
          changes: view.state.doc.toString() === entry.content
            ? undefined
            : { from: 0, to: documentLength, insert: entry.content },
          selection: { anchor, head },
          annotations: Transaction.addToHistory.of(false),
          scrollIntoView: true,
        });
        snapshot.accept(view.state.doc, entry.content);
        mirrorContent(entry.content, getEditorCapabilities(docKey)?.getRevision() ?? 0);
        // 历史导航后把输入焦点交还编辑器；不移动操作系统鼠标指针
        view.focus();
      },
    });

    // 注入当前排版配置
    view.dispatch({
      effects: typographyCompartment.reconfigure(typographyExt),
    });

    // 监听 Ctrl + 鼠标滚轮 实时缩放代码字号
    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const delta = e.deltaY < 0 ? 1 : -1;
      const curTypography = useSettingsStore.getState().settings.typography;
      const currentSize = curTypography.monoFontSize;
      const newSize = Math.max(10, Math.min(32, currentSize + delta));
      if (newSize !== currentSize) {
        useSettingsStore.getState().setTypography({ monoFontSize: newSize });
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });

    // 🔴 S06：字体包从 fallback 切换到真实字形后统一度量刷新（CodeMirror 自绘光标依赖测量缓存）
    const handleFontsSettled = () => {
      view.requestMeasure();
    };
    window.addEventListener('noteboard-fonts-settled', handleFontsSettled);

    return () => {
      // 卸载前同步刷新权威内容，避免快速切换标签时 500ms 防抖尚未落入 store 而丢字
      snapshot.flushPending();
      if (debounceTimer) clearTimeout(debounceTimer);
      if (autoSaveTimer) clearTimeout(autoSaveTimer);
      snapshot.discard();
      unregisterMaterialize();
      unregisterPendingInput();
      unregisterHistoryAdapter();
      container.removeEventListener('wheel', handleWheel);
      window.removeEventListener('noteboard-fonts-settled', handleFontsSettled);
      view.destroy();
      // 注销能力注册（内部有代际保护，旧清理不会误删新实例）
      disposeCapabilities();
      if (viewRef.current === view) viewRef.current = null;
    };
  }, [docKey, fileMode, format.preview, hasPreview, setTabDirty]);

  // Syntax choice reconfigures the mounted editor; history and cursor survive.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !doc) return;
    getAnalysisOwner(view).cancel();
    view.dispatch({ effects: editorLineNumberEffect(readFileEditorSettings(docKey, doc.language).showLineNumbers) });
    let current = true;
    loadLanguageExtension(doc.language).then(extension => {
      if (!current || viewRef.current !== view) return;
      const lint = getLinterForLanguage(doc.language);
      view.dispatch({ effects: languageCompartment.reconfigure([extension, ...(lint ? [lint] : [])]) });
    });
    return () => { current = false; };
  }, [docKey, doc?.language, hasPreview, fileMode]);

  if (!doc) return null;

  return <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--editor-bg)' }}>
    <ExternalChangeBanner docKey={docKey} />
    {hasPreview && fileMode === 'preview' && <FileTextPreview format={format} text={doc.content ?? ''} title={doc.displayName} directory={doc.dirPath}
      savedPath={!docKey.startsWith('untitled:') && doc.externalStatus !== 'deleted' ? docKey : undefined} onShowSource={showSource} />}
    {(!hasPreview || fileMode === 'source') && <div style={{ width: '100%', flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) viewRef.current?.focus(); }}>
      <div ref={containerRef} style={{ width: '100%', maxWidth: 'var(--mono-max-width, 100%)', height: '100%' }} />
    </div>}
  </div>;
}
    {hasPreview && <CodeFileModeToggle key={docKey} docKey={docKey} formatId={format.id} mode={fileMode} isHtml={format.preview === 'html'} />}

function CodeFileModeToggle({ docKey, formatId, mode, isHtml }: { docKey: string; formatId: string; mode: FilePreviewMode; isHtml: boolean }) {
  const active = useWindowStore(state => state.activeKey === docKey);
  const transferring = useWindowStore(state => state.isTransferring(docKey));
  const shortcut = useResolvedShortcutLabel(isHtml ? 'Ctrl+/' : undefined);
  if (!active) return null;
  return <DocumentModeToggle label={`${formatId.toUpperCase()} 视图`} viewMode={mode === 'preview' ? 'visual' : 'source'}
    onToggle={next => switchFilePreviewMode(docKey, next === 'visual' ? 'preview' : 'source')}
    options={{
      visual: { label: isHtml ? '预览' : '表格', accessibleName: isHtml ? '预览 HTML' : '表格', shortcut },
      source: { label: '源码', accessibleName: isHtml ? '查看 HTML 源码' : '源码', shortcut },
    }}
    revealOnChange frameEdge={isHtml && mode === 'preview'} disabled={transferring} />;
}
