// NoteBoard code 编辑器能力实现（编辑器侧，可依赖 CodeMirror 内核 API）
// 由 CodeEditor 挂载时调用 createCodeEditorCapabilities 并注册到 core 注册表；
// core 层只持有 editorTypes 声明的接口，不接触 EditorView。

import type { EditorView } from '@codemirror/view';
import { foldState, toggleFold, unfoldAll } from '@codemirror/language';
import { toggleGoToLine } from './toggleGoToLine';
import type {
  CodeOpsCapabilities,
  EditorCapabilities,
  SearchCapabilities,
  TextSearchOptions,
} from '../../core/editor/editorTypes';
import {
  executeSearch,
  executeFindNext,
  executeFindPrev,
  executeReplace,
  executeReplaceAll,
  cancelSearch,
  watchSearchUpdates,
} from '../search/searchController';
import {
  handleExpandJson,
  handleMinifyJson,
  handleValidateJson,
  handleFormatXml,
  validateTextLanguage,
} from './jsonOps';
import { useDocumentStore } from '../../stores/documentStore';
import { handleTransformCase } from '../toolbar/textOps';
import type { LanguageId } from '../../core/ipc/types';
import { getDocumentRevision, getEditorCapabilities } from '../../core/editor/editorRegistry';
import { getSessionGeneration, submitCapturedContent } from '../session/documentSession';
import { createCodeNavigation } from './codeNavigation';
import { supportsCodeSymbols } from './codeSymbols';
import { codeCursorTracker } from './codeCursorTracker';
import { sourceReadingPlugin } from './sourceReading';
import { getFileFormat, textToolbarKind } from '../../core/fileFormats';
import { createIndentationOps } from './indentationOps';

/**
 * 构造 code 编辑器的能力对象。
 * @param docKey 文档键
 * @param instanceId 实例代际（与注册表删除保护一致）
 * @param view 当前挂载的 CodeMirror 视图
 * @param lang 语言 ID（JSON/XML 等操作分发用）
 */
export function createCodeEditorCapabilities(
  docKey: string,
  instanceId: string,
  view: EditorView,
  lang: LanguageId,
  snapshots?: { materialize: () => string | null; hasPending: () => boolean },
): EditorCapabilities {
  // 🔴 N04：捕获能力创建（编辑器挂载）时的会话代际——flush 迟到返回时
  //    同路径会话已换代（关闭重开）则提交被丢弃
  const sessionGeneration = getSessionGeneration(docKey);
  const getLanguage = () => useDocumentStore.getState().getDocument(docKey)?.language ?? lang;
  const filePath = docKey.startsWith('untitled:') ? useDocumentStore.getState().getDocument(docKey)?.displayName ?? docKey : docKey;
  const format = textToolbarKind(filePath);
  const operationLanguage = () => format === 'json' || format === 'xml' ? format : getLanguage();
  const codeNavigation = createCodeNavigation(view, getLanguage);
  const reading = view.plugin(sourceReadingPlugin);
  // 搜索能力：包装统一搜索控制器（CodeMirror 分支），行为与改造前完全一致
  const search: SearchCapabilities = {
    search: (options: TextSearchOptions) => executeSearch({ type: 'codemirror', view }, options),
    findNext: (options: TextSearchOptions) => executeFindNext({ type: 'codemirror', view }, options),
    findPrev: (options: TextSearchOptions) => executeFindPrev({ type: 'codemirror', view }, options),
    replace: (options: TextSearchOptions) => executeReplace({ type: 'codemirror', view }, options),
    replaceAll: (options: TextSearchOptions) => executeReplaceAll({ type: 'codemirror', view }, options),
    subscribe: listener => watchSearchUpdates({ type: 'codemirror', view }, listener),
    cancel: () => cancelSearch({ type: 'codemirror', view }),
  };

  // 代码操作能力：JSON/XML/大小写转换，内部持有内核视图
  const codeOps: CodeOpsCapabilities = {
    expandJson: (options) => handleExpandJson(view, { ...options, lang: operationLanguage() }),
    minifyJson: (scope) => handleMinifyJson(view, { scope, lang: operationLanguage() }),
    validateJson: (scope) => handleValidateJson(view, { scope, lang: operationLanguage() }),
    transformCase: (mode) => handleTransformCase(view, mode),
    formatXml: (scope) => handleFormatXml(view, { scope, lang: operationLanguage() }),
    validateSyntax: (scope) => validateTextLanguage(view, operationLanguage(), { scope }),
    indentation: getFileFormat(filePath).preview === 'delimited' ? undefined : createIndentationOps(
      view,
      getLanguage,
      () => getEditorCapabilities(docKey)?.instanceId === instanceId && getSessionGeneration(docKey) === sessionGeneration,
      () => useDocumentStore.getState().getDocument(docKey)?.readonly !== false,
    ),
  };

  return {
    docKey,
    instanceId,
    getRevision: () => getDocumentRevision(docKey),
    readTextSnapshot: (maxChars) => {
      const text = view.state.doc;
      return text.length > maxChars ? 'too-large' : { content: text.toString() };
    },
    flush: async () => {
      // CodeMirror 的 doc 是不可变结构，toString 即为权威快照；
      // 🔴 R03：镜像写入经统一提交屏障（旧实例/旧 revision 快照不得覆盖新内容）
      // 🔴 N04：提交携带会话代际（同路径已重开的旧会话迟到 flush 丢弃）
      const content = snapshots?.materialize() ?? view.state.doc.toString();
      submitCapturedContent(docKey, { instanceId, revision: getDocumentRevision(docKey), content }, sessionGeneration);
      return { docKey, instanceId, revision: getDocumentRevision(docKey), content };
    },
    focus: () => view.focus(),
    getSelectedText: () => {
      const sel = view.state.selection.main;
      return sel.empty ? '' : view.state.sliceDoc(sel.from, sel.to);
    },
    // 🔴 S11：Code/文本为已验证可回收类型（选区/滚动/折叠捕获恢复；统一历史在
    //    documentHistory 模块，内容经 flush 进 store——重挂载不清历史）
    //    🔴 R05：IME composition 进行中不可回收（光标/组合文本状态无法可靠恢复）
    canSuspend: () => !view.composing,
    hasUnconfirmedInput: () => snapshots?.hasPending() ?? true,
    captureViewState: () => {
      snapshots?.materialize();
      return {
        kind: 'code' as const,
        selection: {
          anchor: view.state.selection.main.anchor,
          head: view.state.selection.main.head,
        },
        scrollTop: view.scrollDOM?.scrollTop ?? 0,
        // CodeMirror 折叠区间（folded 装饰位置对；iter 遍历为 from/to 列表）
        foldedRanges: (() => {
          const folded = view.state.field(foldState, false);
          if (!folded) return [] as Array<{ from: number; to: number }>;
          const ranges: Array<{ from: number; to: number }> = [];
          for (const iter = folded.iter(); iter.value !== null; iter.next()) {
            if (iter.from !== undefined && iter.to !== undefined) {
              ranges.push({ from: iter.from, to: iter.to });
            }
          }
          return ranges;
        })(),
      };
    },
    search,
    codeOps,
    get codeNavigation() { return supportsCodeSymbols(getLanguage()) ? codeNavigation : undefined; },
    codeView: {
      cursor: view.plugin(codeCursorTracker) ?? undefined,
      reading: reading ? {
        getSnapshot: reading.getSnapshot,
        subscribe: reading.subscribe,
        toggle: () => reading.toggle(getLanguage()),
      } : undefined,
      goToLine: () => { toggleGoToLine(view); },
      toggleFold: () => { toggleFold(view); view.focus(); },
      unfoldAll: () => { unfoldAll(view); view.focus(); },
    },
  };
}
