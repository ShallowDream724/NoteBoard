// NoteBoard Markdown 编辑器扩展装配点
// 唯一装配处：所有 TipTap 扩展在此注册
// 详见 docs/09-开发路线图.md 7.1
//
// 采用最小扩展集装配。
// 不包含：AI 补全/建议/diff 预览、sync/、SQLite 层、全局单例 tab 状态。

import { buildDocumentExtensions } from '../documentExtensions';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import '@tiptap/extension-image';
import { CodeBlockView } from '../codeBlockView';
import { CodeHighlight } from '../codeHighlightExtension';
import { searchReplaceExtension } from '../searchReplace';
import { MathInline, MathBlock } from '../katexExtensions';
import { MermaidBlock } from '../mermaidExtension';
import { PlantUmlBlock } from '../../plantuml/plantumlExtension';
import { InfographicBlock } from '../infographicExtension';
import { GitHubAlert } from '../alertExtension';
import { slashSuggestion } from '../slashCommand';

import { handleLinkClick } from '../linkHandler';
import { TableClipboard } from '../tableClipboard';
import { ResizableTableRow, TableSizing } from '../tableSizing';
import { MarkdownTable } from '../markdownTable';
import { EfficientTableView } from '../tableView';
import { useWindowStore } from '../../../stores/windowStore';

import Suggestion from '@tiptap/suggestion';
import { Extension, type Extensions } from '@tiptap/core';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import {
  redoDocumentHistory,
  undoDocumentHistory,
} from '../../history/documentHistory';

export interface LinkClickHandlerOptions {
  onOpenLinkModal?: () => void;
}

/**
 * 链接点击分发扩展
 * 统一拦截编辑区 a 标签的点击事件：
 * 1. Ctrl / Cmd + 左键单击：外部链接调用系统默认浏览器，本地文件链接在 NoteBoard 内打开
 * 2. 普通左键单击：唤起超链接编辑/插入模态弹窗
 */
const LinkClickHandler = Extension.create<LinkClickHandlerOptions>({
  name: 'linkClickHandler',
  addOptions() {
    return {
      onOpenLinkModal: undefined,
    };
  },
  addProseMirrorPlugins() {
    const extensionOptions = this.options;
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            click(view, event) {
              const target = event.target as HTMLElement | null;
              const anchor = target?.closest('a');
              if (anchor) {
                const href = anchor.getAttribute('href');
                event.preventDefault();
                event.stopPropagation();

                if (event.button === 0) {
                  // 1. Ctrl / Cmd + 单击：触发链接跳转
                  if (event.ctrlKey || event.metaKey) {
                    if (href) {
                      const activeKey = useWindowStore.getState().activeKey;
                      if (activeKey) {
                        handleLinkClick(href, activeKey);
                      }
                    }
                  } else {
                    // 2. 普通左键单击：定位光标并唤起超链接编辑弹窗
                    const posAtCoord = view.posAtCoords({ left: event.clientX, top: event.clientY });
                    if (posAtCoord) {
                      view.dispatch(
                        view.state.tr.setSelection(
                          TextSelection.create(view.state.doc, posAtCoord.pos)
                        )
                      );
                    }
                    if (extensionOptions.onOpenLinkModal) {
                      extensionOptions.onOpenLinkModal();
                    }
                  }
                }
                return true;
              }
              return false;
            },
            auxclick(_view, event) {
              // 拦截鼠标中键等辅助按键，防止触发原生导航
              const target = event.target as HTMLElement | null;
              const anchor = target?.closest('a');
              if (anchor) {
                event.preventDefault();
                event.stopPropagation();
                return true;
              }
              return false;
            },
          },
        },
      }),
    ];
  },
});

/**
 * 文档级统一撤销/重做快捷键。
 * 高优先级拦截 TipTap 自带快捷键，让可视化与源码模式始终沿同一条文件历史移动。
 */
const UnifiedDocumentHistoryKeys = Extension.create<{ docKey: string }>({
  name: 'unifiedDocumentHistoryKeys',
  priority: 1000,
  addOptions() {
    return { docKey: '' };
  },
  addKeyboardShortcuts() {
    return {
      'Mod-z': () => {
        undoDocumentHistory(this.options.docKey);
        return true;
      },
      'Mod-y': () => {
        redoDocumentHistory(this.options.docKey);
        return true;
      },
      'Shift-Mod-z': () => {
        redoDocumentHistory(this.options.docKey);
        return true;
      },
    };
  },
});

import { EnhancedImageBlock } from '../imageNodeView';
import { ImageAssetLifecycle } from '../imageAssetExtension';

export interface BuildExtensionsOptions {
  onOpenLinkModal?: () => void;
}

/** Document grammar stays independent from UI and session state. */
export function buildExtensions(docKey = '', options?: BuildExtensionsOptions): Extensions {
  return [
    ...buildDocumentExtensions({ image: EnhancedImageBlock.configure({ docKey }), codeBlock: CodeBlockView,
      mathInline: MathInline, mathBlock: MathBlock, mermaidBlock: MermaidBlock, plantumlBlock: PlantUmlBlock,
      infographicBlock: InfographicBlock, githubAlert: GitHubAlert, tableRow: ResizableTableRow,
      table: MarkdownTable.configure({ resizable: false, cellMinWidth: 40, View: EfficientTableView, HTMLAttributes: { class: 'nb-table' } }) }),
    UnifiedDocumentHistoryKeys.configure({ docKey }),
    LinkClickHandler.configure({ onOpenLinkModal: options?.onOpenLinkModal }),
    ImageAssetLifecycle.configure({ docKey }),
    Placeholder.configure({ placeholder: '开始输入，或键入 / 插入内容', emptyEditorClass: 'is-empty' }),
    CharacterCount, TableClipboard, TableSizing, CodeHighlight, searchReplaceExtension(),
    Extension.create({
      name: 'slashCommand',
      addOptions() { return { suggestion: slashSuggestion }; },
      addProseMirrorPlugins() { return [Suggestion({ editor: this.editor, ...this.options.suggestion })]; },
    }),
  ];
}
