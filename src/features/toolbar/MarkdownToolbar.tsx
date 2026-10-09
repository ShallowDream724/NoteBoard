// NoteBoard Markdown 编辑器顶部操作栏
// 适用于 Markdown 可视化与源码模式
// 支持多级下拉菜单、实时 Active/Hover 状态同步、撤销/重做与丰富排版格式化工具

import React, { useState, useCallback, useMemo } from 'react';
import { OrderedListIcon as ListOrdered } from '../../components/OrderedListIcon';
import { InlineFormulaIcon, BlockFormulaIcon } from '../../components/FormulaIcons';
import type { Editor } from '@tiptap/core';
import { useFormattingUpdates, useSourceFormattingUpdates } from '../editor-md/useFormattingUpdates';
import { insertDocumentTable } from '../editor-md/insertDocumentTable';
import { formatSourceMark, runSourceFormatCommand, setSourceHeading, sourceMarkRange } from '../editor-md/sourceFormatting';
import {
  Undo2,
  Redo2,
  Heading,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Pilcrow,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  List,
  CheckSquare,
  Quote,
  Table as TableIcon,
  Code2,
  Sigma,
  Workflow,
  Info,
  Lightbulb,
  AlertCircle,
  AlertTriangle,
  Flame,
  Minus,
  Link2,
  Image as ImageIcon,
  Calendar,
  Clock,
  RemoveFormatting,
  PlusSquare,
  BarChart3,
  PanelTopClose,
  RefreshCw,
} from 'lucide-react';
import {
  ToolbarButton,
  ToolbarDivider,
  ToolbarDropdown,
  ToolbarDropdownItem,
} from './ToolbarComponents';
import {
  undoDocumentHistory,
  redoDocumentHistory,
  useDocumentHistory,
} from '../history/documentHistory';
import { insertLocalImageWithDialog, insertSourceImageWithDialog } from '../editor-md/imagePaste';
// 🔴 S03：从 editor-md 边界内实例表获取内核实例（不再依赖编辑器组件文件的 getter 导出）
import { getMdTipTapEditor as getActiveTipTapEditor, getMdSourceView as getActiveSourceView } from '../editor-md/editorInstances';
import { emit } from '../../core/emitter';
import type { EditorView } from '@codemirror/view';
import { ResponsiveToolbar, ToolbarOverflowItem } from './ResponsiveToolbar';
import { HighlightControl } from './HighlightControl';
import { TextResetControl } from './TextResetControl';
import { setTextColor, applyTextStyle, setHighlightColor } from '../document-style/documentStyles';
import { AlignmentMenu } from '../document-style/AlignmentMenu';
import { applySourceTextStyle, sourceTextStyle } from '../document-style/sourceDocumentStyle';
import { AnnotationButton, ImageInsertItems, ImageInsertMenu, RichSelectionMenu } from '../editor-md/rich-content/menus';
import { insertDisclosure } from '../editor-md/rich-content/commands';
import { useNativeFeatureVisibility } from '../document-format/featureGate';
import { requestImageLink } from '../editor-md/rich-content/imageLinkDialog';
import { captureVisualImageInsertion, captureSourceImageInsertion } from '../editor-md/imageInsertionLease';
import { useDocumentStore } from '../../stores/documentStore';
import { nativeMarkdownLink } from '../document-format/nativeLink';
import { selectionPresentation } from '../document-style/selectionPresentation';
import { insertCallout } from '../editor-md/alertCommands';
import { clearSelectionTextFormatting } from '../editor-md/textFormatting';
import { clearSourceTextFormatting } from '../editor-md/sourceFormatting';
import { CellSelection } from '@tiptap/pm/tables';
import { toggleSelectedCellMark } from '../document-style/cellTextStyle';
import { DEFAULT_INFOGRAPHIC_CODE, DEFAULT_MERMAID_CODE, diagramContent } from '../editor-md/insertContentRecipes';
import { insertMath } from '../editor-md/insertMath';
import { markMermaidCreation } from '../editor-md/mermaidCreation';
import { getEditingScope, useEditingScope } from '../editor-md/editingScope';

interface MarkdownToolbarProps {
  docKey: string;
  editor: Editor | null;
  viewMode?: 'visual' | 'source' | null;
}

export function MarkdownToolbar({ docKey, editor: propEditor, viewMode }: MarkdownToolbarProps) {
  // 保证获取到最新的 TipTap editor 实例
  const parentEditor = propEditor || getActiveTipTapEditor(docKey) || null;
  const isSourceMode = viewMode === 'source';
  const scope = useEditingScope(!isSourceMode ? parentEditor?.view : undefined);
  const editor = scope?.kind === 'tiptap' ? scope.editor : scope ? null : parentEditor;
  const isCurrentTarget = () => isSourceMode || (!!parentEditor && !parentEditor.isDestroyed
    && getEditingScope(parentEditor.view) === scope && !editor?.isDestroyed && !editor?.view.composing);
  const allowsStructure = !scope;
  const nativeFeaturesVisible = useNativeFeatureVisibility() && !isSourceMode;
  const document = useDocumentStore(state => state.documents.get(docKey));
  const hasMarkdownLink = useMemo(() => document?.kind === 'noteboard' && !!nativeMarkdownLink(docKey, document.content), [docKey, document?.kind, document?.content]);
  const { canUndo, canRedo } = useDocumentHistory(docKey);

  useFormattingUpdates(editor, !isSourceMode);
  useSourceFormattingUpdates(docKey, isSourceMode);
  const sourceView = isSourceMode ? getActiveSourceView(docKey) : undefined;
  const sourceHighlight = sourceView ? sourceMarkRange(sourceView, 'highlight') : null;
  const sourceStyle = sourceView ? sourceTextStyle(sourceView) : null;
  const selectionScope = editor && !isSourceMode ? selectionPresentation(editor.state) : null;
  const canInline = isSourceMode ? !!sourceView : !!selectionScope?.inline;
  const selectedCells = !isSourceMode && editor?.state.selection instanceof CellSelection;
  const canBlocks = allowsStructure && (isSourceMode ? !!sourceView : !!selectionScope?.blockText && !selectedCells);
  const canLists = canBlocks && !selectedCells;
  const canTextStyle = canInline || !!selectionScope?.mathBlocks.length;

  // 下拉菜单开闭状态
  const [headingDropdownOpen, setHeadingDropdownOpen] = useState(false);
  const [insertDropdownOpen, setInsertDropdownOpen] = useState(false);
  const [highlightDropdownOpen, setHighlightDropdownOpen] = useState(false);
  const [resetDropdownOpen, setResetDropdownOpen] = useState(false);

  // ── 获取当前标题状态 ──
  const currentHeadingLabel = (() => {
    if (!editor || isSourceMode) return '正文';
    for (let level = 1; level <= 6; level++) {
      if (editor.isActive('heading', { level })) {
        return `H${level}`;
      }
    }
    return '正文';
  })();
  const HeadingIcon = ({ H1: Heading1, H2: Heading2, H3: Heading3,
    H4: Heading4, H5: Heading5, H6: Heading6 } as Record<string, typeof Heading>)[currentHeadingLabel] ?? Heading;

  // ── 源码模式辅助文本插入 ──
  const executeSourceAction = useCallback((action: (view: EditorView) => void) => {
    const view = getActiveSourceView(docKey);
    if (!view) return;
    action(view);
    view.focus();
  }, [docKey]);

  // ── 标题与段落设置 ──
  const handleSetHeading = (level: number | 'paragraph') => {
    if (!allowsStructure || !isCurrentTarget()) return;
    setHeadingDropdownOpen(false);
    if (isSourceMode) {
      executeSourceAction(view => setSourceHeading(view, level === 'paragraph' ? 0 : level));
      return;
    }
    if (!editor || !isCurrentTarget()) return;
    if (level === 'paragraph') {
      editor.chain().focus().restoreParagraph().run();
    } else {
      editor.chain().focus().setHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run();
    }
  };

  // ── 文本样式快捷触发 ──
  const toggleMark = (mark: 'bold' | 'italic' | 'underline' | 'strike' | 'code') => {
    if (isSourceMode) {
      executeSourceAction(view => { runSourceFormatCommand(view, `markdown.${mark}`); });
      return;
    }
    if (!editor || !isCurrentTarget()) return;
    if (toggleSelectedCellMark(editor, mark) !== null) return;
    switch (mark) {
      case 'bold':
        editor.chain().focus().toggleBold().run();
        break;
      case 'italic':
        editor.chain().focus().toggleItalic().run();
        break;
      case 'underline':
        editor.chain().focus().toggleUnderline().run();
        break;
      case 'strike':
        editor.chain().focus().toggleStrike().run();
        break;
      case 'code':
        editor.chain().focus().toggleCode().run();
        break;
    }
  };

  // ── 列表切换 ──
  const toggleList = (type: 'bullet' | 'ordered' | 'task') => {
    if (!allowsStructure || !isCurrentTarget()) return;
    if (isSourceMode) {
      executeSourceAction(view => { runSourceFormatCommand(view, `markdown.${type}List`); });
      return;
    }
    if (!editor || !isCurrentTarget()) return;
    if (type === 'bullet') editor.chain().focus().toggleBulletList().run();
    if (type === 'ordered') editor.chain().focus().toggleOrderedList().run();
    if (type === 'task') editor.chain().focus().toggleTaskList().run();
  };

  // ── 高亮操作 ──
  const handleSelectHighlightColor = (color: string) => {
    if (isSourceMode) {
      executeSourceAction(view => formatSourceMark(view, 'highlight', color));
      return;
    }
    if (!editor || !isCurrentTarget()) return;
    setHighlightColor(editor, color);
  };

  const handleRemoveHighlight = () => {
    if (isSourceMode) { executeSourceAction(view => formatSourceMark(view, 'highlight', undefined, true)); return; }
    if (!editor || !isCurrentTarget()) return;
    setHighlightColor(editor, null);
  };

  // ── 插入元素处理 ──
  const handleInsertTable = (rows: number, cols: number) => {
    if (!allowsStructure || !isCurrentTarget()) return;
    setInsertDropdownOpen(false);
    if (isSourceMode) {
      const row = (value: (index: number) => string) => `| ${Array.from({ length: cols }, (_, index) => value(index)).join(' | ')} |`;
      const tableMarkdown = '\n' + [row(index => `列 ${index + 1}`), row(() => '---'), ...Array.from({ length: rows - 1 }, () => row(() => ''))].join('\n') + '\n\n';
      executeSourceAction((view) => {
        const { from } = view.state.selection.main;
        view.dispatch({ changes: { from, to: from, insert: tableMarkdown } });
      });
      return;
    }
    if (!editor || !isCurrentTarget()) return;
    insertDocumentTable(editor, rows, cols);
  };

  const handleInsertMath = (type: 'inline' | 'block') => {
    if (!allowsStructure || !isCurrentTarget()) return;
    setInsertDropdownOpen(false);
    if (isSourceMode) {
      const mathSnippet = type === 'inline' ? '$$' : '\n$$\n\n$$\n';
      executeSourceAction((view) => {
        const { from } = view.state.selection.main;
        view.dispatch({ changes: { from, to: from, insert: mathSnippet }, selection: { anchor: from + (type === 'inline' ? 1 : 4) } });
      });
      return;
    }
    if (!editor || !isCurrentTarget()) return;
    insertMath(editor, type);
  };

  const handleInsertMermaid = () => {
    if (!allowsStructure || !isCurrentTarget()) return;
    setInsertDropdownOpen(false);
    if (isSourceMode) {
      const mermaidCode = `\n\`\`\`mermaid\n${DEFAULT_MERMAID_CODE}\n\`\`\`\n`;
      executeSourceAction((view) => {
        const { from } = view.state.selection.main;
        view.dispatch({ changes: { from, to: from, insert: mermaidCode } });
      });
      return;
    }
    if (!editor || !isCurrentTarget()) return;
    editor.chain().focus().command(({ tr }) => { markMermaidCreation(tr); return true; }).insertContent(diagramContent('mermaid')).run();
  };

  // 插入 Infographic 现代化信息图
  const handleInsertInfographic = () => {
    if (!allowsStructure || !isCurrentTarget()) return;
    setInsertDropdownOpen(false);
    const tmpl = DEFAULT_INFOGRAPHIC_CODE;
    if (isSourceMode) {
      const infoSnippet = `\n\`\`\`infographic\n${tmpl}\n\`\`\`\n`;
      executeSourceAction((view) => {
        const { from } = view.state.selection.main;
        view.dispatch({ changes: { from, to: from, insert: infoSnippet } });
      });
      return;
    }
    if (!editor || !isCurrentTarget()) return;
    editor.chain().focus().insertContent(diagramContent('infographic')).run();
  };

  const handleInsertAlert = (kind?: 'note' | 'tip' | 'important' | 'warning' | 'caution') => {
    if (!allowsStructure || !isCurrentTarget()) return;
    setInsertDropdownOpen(false);
    if (isSourceMode) {
      const alertSnippet = `\n> [!${(kind ?? 'note').toUpperCase()}]\n> 提示内容\n\n`;
      executeSourceAction((view) => {
        const { from } = view.state.selection.main;
        view.dispatch({ changes: { from, to: from, insert: alertSnippet } });
      });
      return;
    }
    if (!editor || !isCurrentTarget()) return;
    if (!kind) { insertCallout(editor); return; }
    editor.chain().focus().insertContent({
      type: 'githubAlert',
      attrs: { kind },
      content: [{ type: 'paragraph' }],
    }).run();
  };

  const handleInsertCodeBlock = () => {
    if (!allowsStructure || !isCurrentTarget()) return;
    setInsertDropdownOpen(false);
    if (isSourceMode) {
      executeSourceAction(view => { runSourceFormatCommand(view, 'markdown.codeBlock'); });
      return;
    }
    if (!editor || !isCurrentTarget()) return;
    editor.chain().focus().toggleCodeBlock().run();
  };

  const handleInsertQuote = () => {
    if (!allowsStructure || !isCurrentTarget()) return;
    setInsertDropdownOpen(false);
    if (isSourceMode) {
      executeSourceAction((view) => {
        const { from } = view.state.selection.main;
        const line = view.state.doc.lineAt(from);
        view.dispatch({ changes: { from: line.from, to: line.from, insert: '> ' } });
      });
      return;
    }
    if (!editor || !isCurrentTarget()) return;
    editor.chain().focus().toggleBlockquote().run();
  };

  const handleInsertDivider = () => {
    if (!allowsStructure || !isCurrentTarget()) return;
    setInsertDropdownOpen(false);
    if (isSourceMode) {
      executeSourceAction((view) => {
        const { from } = view.state.selection.main;
        view.dispatch({ changes: { from, to: from, insert: '\n---\n\n' } });
      });
      return;
    }
    if (!editor || !isCurrentTarget()) return;
    editor.chain().focus().setHorizontalRule().run();
  };

  // ── 超链接与图片处理 ──
  const handleOpenLink = () => {
    setInsertDropdownOpen(false);
    if (!isCurrentTarget()) return;
    if (scope?.kind === 'tiptap') { scope.openLink(); return; }
    if (scope) return;
    emit('open-link-modal', { key: docKey });
  };

  const handleInsertLocalImage = async () => {
    if (!allowsStructure || !isCurrentTarget()) return;
    setInsertDropdownOpen(false);
    if (isSourceMode) {
      const view = getActiveSourceView(docKey);
      if (view) await insertSourceImageWithDialog(view, docKey);
      return;
    }
    if (editor) {
      insertLocalImageWithDialog(editor, docKey);
    }
  };

  const handleInsertNetworkImage = async () => {
    if (!allowsStructure || !isCurrentTarget()) return;
    setInsertDropdownOpen(false);
    const source = isSourceMode ? getActiveSourceView(docKey) : null;
    const lease = source ? captureSourceImageInsertion(source, docKey) : editor ? captureVisualImageInsertion(editor, docKey) : null;
    if (!lease) return;
    try { const url = await requestImageLink(); if (url) lease.commit({ src: url, alt: '' }); }
    finally { lease.dispose(); }
  };

  // ── 日期时间插入处理 ──
  const handleInsertDateTime = (mode: 'date' | 'time' | 'datetime') => {
    setInsertDropdownOpen(false);
    const d = new Date();
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    const textToInsert =
      mode === 'date' ? dateStr : mode === 'time' ? timeStr : `${dateStr} ${timeStr}`;

    if (isSourceMode) {
      executeSourceAction((view) => {
        const { from, to } = view.state.selection.main;
        view.dispatch({
          changes: { from, to, insert: textToInsert },
          selection: { anchor: from + textToInsert.length },
        });
      });
      return;
    }
    if (!editor || !isCurrentTarget()) return;
    editor.chain().focus().insertContent(textToInsert).run();
  };

  const handleClearFormat = () => {
    if (isSourceMode) {
      executeSourceAction(clearSourceTextFormatting);
      return;
    }

    const currentEditor = editor;
    if (!currentEditor || !isCurrentTarget()) return;

    clearSelectionTextFormatting(currentEditor);
    if (scope?.kind === 'tiptap') currentEditor.view.dom.focus({ preventScroll: true });
  };

  if (isSourceMode && document?.kind === 'noteboard') return null;
  return (
    <ResponsiveToolbar onLayoutChange={() => {
      setHeadingDropdownOpen(false);
      setHighlightDropdownOpen(false);
      setInsertDropdownOpen(false);
      setResetDropdownOpen(false);
    }}>
      {/* ── 历史操作组 ── */}
      <ToolbarButton
        icon={<Undo2 size={15} strokeWidth={2.2} />}
        title="撤销"
        collapsePriority={130}
        shortcut="Ctrl+Z"
        disabled={!canUndo || scope?.kind === 'external'}
        onClick={() => { if (!isCurrentTarget()) return; if (scope?.kind === 'tiptap') scope.history('undo'); else undoDocumentHistory(docKey); }}
      />
      <ToolbarButton
        icon={<Redo2 size={15} strokeWidth={2.2} />}
        title="重做"
        collapsePriority={120}
        shortcut="Ctrl+Y"
        disabled={!canRedo || scope?.kind === 'external'}
        onClick={() => { if (!isCurrentTarget()) return; if (scope?.kind === 'tiptap') scope.history('redo'); else redoDocumentHistory(docKey); }}
      />

      <ToolbarDivider />

      {/* ── 标题与段落下拉菜单（二级菜单） ── */}
      <ToolbarDropdown
        collapsePriority={150}
        isOpen={headingDropdownOpen}
        onOpenChange={setHeadingDropdownOpen}
        trigger={
          <ToolbarButton
            icon={<HeadingIcon size={15} />}
            label={currentHeadingLabel === '正文' ? '正文' : undefined}
            compactLabel
            hasDropdown
            title="标题等级"
            disabled={!canBlocks}
            active={currentHeadingLabel !== '正文'}
          />
        }
      >
        <ToolbarDropdownItem
          icon={<Pilcrow size={14} />}
          label="还原为正文"
          helpKey="block.paragraph"
          disabled={!canBlocks}
          shortcut="Ctrl+0"
          active={currentHeadingLabel === '正文'}
          onClick={() => handleSetHeading('paragraph')}
        />
        <ToolbarDropdownItem
          icon={<Heading1 size={14} />}
          label="一级标题 (H1)"
          helpKey="block.heading.1"
          disabled={!canBlocks}
          shortcut="Ctrl+1"
          active={currentHeadingLabel === 'H1'}
          onClick={() => handleSetHeading(1)}
        />
        <ToolbarDropdownItem
          icon={<Heading2 size={14} />}
          label="二级标题 (H2)"
          helpKey="block.heading.2"
          disabled={!canBlocks}
          shortcut="Ctrl+2"
          active={currentHeadingLabel === 'H2'}
          onClick={() => handleSetHeading(2)}
        />
        <ToolbarDropdownItem
          icon={<Heading3 size={14} />}
          label="三级标题 (H3)"
          helpKey="block.heading.3"
          disabled={!canBlocks}
          shortcut="Ctrl+3"
          active={currentHeadingLabel === 'H3'}
          onClick={() => handleSetHeading(3)}
        />
        <ToolbarDropdownItem
          icon={<Heading4 size={14} />}
          label="四级标题 (H4)"
          helpKey="block.heading.4"
          disabled={!canBlocks}
          shortcut="Ctrl+4"
          active={currentHeadingLabel === 'H4'}
          onClick={() => handleSetHeading(4)}
        />
        <ToolbarDropdownItem
          icon={<Heading5 size={14} />}
          label="五级标题 (H5)"
          helpKey="block.heading.5"
          disabled={!canBlocks}
          shortcut="Ctrl+5"
          active={currentHeadingLabel === 'H5'}
          onClick={() => handleSetHeading(5)}
        />
        <ToolbarDropdownItem
          icon={<Heading6 size={14} />}
          label="六级标题 (H6)"
          helpKey="block.heading.6"
          disabled={!canBlocks}
          shortcut="Ctrl+6"
          active={currentHeadingLabel === 'H6'}
          onClick={() => handleSetHeading(6)}
        />
      </ToolbarDropdown>

      <ToolbarDivider />

      {/* ── 基础文本样式组 ── */}
      <ToolbarButton
        icon={<Bold size={15} strokeWidth={2.4} />}
        title="加粗"
        disabled={!canInline}
        collapsePriority={140}
        shortcut="Ctrl+B"
        active={!isSourceMode && Boolean(editor?.isActive('bold'))}
        onClick={() => toggleMark('bold')}
      />
      <ToolbarButton
        icon={<Italic size={15} strokeWidth={2.4} />}
        title="斜体"
        disabled={!canInline}
        collapsePriority={110}
        shortcut="Ctrl+I"
        active={!isSourceMode && Boolean(editor?.isActive('italic'))}
        onClick={() => toggleMark('italic')}
      />
      <ToolbarButton
        icon={<Underline size={15} strokeWidth={2.4} />}
        title="下划线"
        disabled={!canInline}
        collapsePriority={100}
        shortcut="Ctrl+U"
        active={!isSourceMode && Boolean(editor?.isActive('underline'))}
        onClick={() => toggleMark('underline')}
      />
      <ToolbarButton
        icon={<Strikethrough size={15} strokeWidth={2.4} />}
        title="删除线"
        disabled={!canInline}
        collapsePriority={90}
        active={!isSourceMode && Boolean(editor?.isActive('strike'))}
        onClick={() => toggleMark('strike')}
      />
      <ToolbarButton
        icon={<Code size={15} strokeWidth={2.4} />}
        title="行内代码"
        disabled={!canInline}
        collapsePriority={50}
        shortcut="`"
        active={!isSourceMode && Boolean(editor?.isActive('code'))}
        onClick={() => toggleMark('code')}
      />

      {nativeFeaturesVisible && canTextStyle && <HighlightControl
        onApplyStyle={pair => { if (!isCurrentTarget()) return; if (isSourceMode) executeSourceAction(view => { applySourceTextStyle(view, pair); }); else if (editor) applyTextStyle(editor, pair); }}
        textColor={isSourceMode ? sourceStyle?.color : editor?.getAttributes('mathBlock').textColor ?? editor?.getAttributes('textColor').color}
        onTextColor={color => { if (!isCurrentTarget()) return; if (isSourceMode) executeSourceAction(view => { applySourceTextStyle(view, { color }); }); else if (editor) setTextColor(editor, color); }}
        collapsePriority={40}
        open={highlightDropdownOpen}
        onOpenChange={open => { if (open && sourceView) sourceTextStyle(sourceView, true); setHighlightDropdownOpen(open); }}
        active={isSourceMode ? !!sourceStyle?.background || sourceHighlight !== null : Boolean(editor?.isActive('highlight') || editor?.getAttributes('mathBlock').background)}
        currentColor={isSourceMode ? sourceStyle?.background ?? sourceHighlight?.color : editor?.getAttributes('mathBlock').background ?? editor?.getAttributes('highlight').color}
        onApply={handleSelectHighlightColor} onRemove={handleRemoveHighlight}
        onReturnToEditor={() => { if (!isCurrentTarget()) return; if (isSourceMode) getActiveSourceView(docKey)?.focus(); else editor?.view.dom.focus({ preventScroll: true }); }}
      />}
      {!isSourceMode && editor && allowsStructure && <AlignmentMenu editor={editor}/>}

      <ToolbarDivider />

      {/* ── 列表组 ── */}
      <ToolbarButton
        icon={<List size={15} strokeWidth={2.2} />}
        title="无序列表"
        helpKey="list.bullet"
        disabled={!canLists || !isSourceMode && !editor?.can().toggleBulletList()}
        collapsePriority={10}
        shortcut="Ctrl+Shift+8"
        active={!isSourceMode && Boolean(editor?.isActive('bulletList'))}
        onClick={() => toggleList('bullet')}
      />
      <ToolbarButton
        icon={<ListOrdered size={18} />}
        title="有序列表"
        helpKey="list.ordered"
        disabled={!canLists || !isSourceMode && !editor?.can().toggleOrderedList()}
        collapsePriority={20}
        shortcut="Ctrl+Shift+7"
        active={!isSourceMode && Boolean(editor?.isActive('orderedList'))}
        onClick={() => toggleList('ordered')}
      />
      <ToolbarButton
        icon={<CheckSquare size={15} strokeWidth={2.2} />}
        title="待办"
        helpKey="list.task"
        disabled={!canLists || !isSourceMode && !editor?.can().toggleTaskList()}
        collapsePriority={80}
        shortcut="Ctrl+Shift+9"
        active={!isSourceMode && Boolean(editor?.isActive('taskList'))}
        onClick={() => toggleList('task')}
      />

      <ToolbarDivider />

      {/* ── 插入块级与丰富元素下拉菜单（二级/三级菜单集大成） ── */}
      {!selectedCells && <ToolbarDropdown
        collapsePriority={160}
        isOpen={insertDropdownOpen}
        onOpenChange={setInsertDropdownOpen}
        trigger={
          <ToolbarButton
            icon={<PlusSquare size={15} />}
            label="插入"
            compactLabel
            hasDropdown
            title="插入超链接、图片、表格、公式、图表、提示块、日期时间等"
            disabled={scope?.kind === 'external'}
          />
        }
      >
        {/* 1. 代码块 */}
        <ToolbarDropdownItem
          icon={<Code2 size={14} />}
          label="代码块"
          helpKey="block.code"
          shortcut="Ctrl+Alt+C"
          disabled={!allowsStructure}
          onClick={handleInsertCodeBlock}
        />

        {/* 2. GitHub Alert 提示块二级菜单 */}
        <ToolbarDropdownItem
          icon={<Info size={14} color="#3b82f6" />}
          label="提示块"
          disabled={!allowsStructure}
          submenu={
            <>
              {(nativeFeaturesVisible || isSourceMode) && <ToolbarDropdownItem
                icon={<Info size={14} />}
                label="提示块"
                helpKey="block.callout"
                onClick={() => handleInsertAlert()}
              />}
              <ToolbarDropdownItem
                icon={<Info size={14} color="#3b82f6" />}
                label="说明"
                helpKey="block.callout.note"
                onClick={() => handleInsertAlert('note')}
              />
              <ToolbarDropdownItem
                icon={<Lightbulb size={14} color="#10b981" />}
                label="技巧"
                helpKey="block.callout.tip"
                onClick={() => handleInsertAlert('tip')}
              />
              <ToolbarDropdownItem
                icon={<AlertCircle size={14} color="#8b5cf6" />}
                label="重要"
                helpKey="block.callout.important"
                onClick={() => handleInsertAlert('important')}
              />
              <ToolbarDropdownItem
                icon={<AlertTriangle size={14} color="#f59e0b" />}
                label="警告"
                helpKey="block.callout.warning"
                onClick={() => handleInsertAlert('warning')}
              />
              <ToolbarDropdownItem
                icon={<Flame size={14} color="#ef4444" />}
                label="谨慎"
                helpKey="block.callout.caution"
                onClick={() => handleInsertAlert('caution')}
              />
            </>
          }
        />

        {/* 3. 引用块 (Quote) */}
        <ToolbarDropdownItem
          icon={<Quote size={14} />}
          label="引用块 (Quote)"
          helpKey="block.quote"
          disabled={!allowsStructure}
          onClick={handleInsertQuote}
        />
        {nativeFeaturesVisible && editor && allowsStructure && <ToolbarDropdownItem icon={<PanelTopClose size={14}/>} label="折叠块" helpKey="block.disclosure"
          onClick={() => { if (!isCurrentTarget()) return; setInsertDropdownOpen(false); insertDisclosure(editor); }}/>}

        {/* 4. 表格二级菜单 */}
        <ToolbarDropdownItem
          icon={<TableIcon size={14} />}
          label="表格"
          disabled={!allowsStructure}
          submenu={
            <>
              <ToolbarDropdownItem
                label="标准表格 (3x3)"
                onClick={() => handleInsertTable(3, 3)}
              />
              <ToolbarDropdownItem
                label="紧凑表格 (2x2)"
                onClick={() => handleInsertTable(2, 2)}
              />
              <ToolbarDropdownItem
                label="宽表格 (4x4)"
                onClick={() => handleInsertTable(4, 4)}
              />
            </>
          }
        />

        {/* 5. 公式与图表二级菜单 */}
        <ToolbarDropdownItem
          icon={<Sigma size={14} />}
          label="公式与图表"
          disabled={!allowsStructure}
          submenu={
            <>
              <ToolbarDropdownItem
                icon={<InlineFormulaIcon size={16} />}
                label="行内公式 ($...$)"
                helpKey="formula.inline"
                onClick={() => handleInsertMath('inline')}
              />
              <ToolbarDropdownItem
                icon={<BlockFormulaIcon size={16} />}
                label="独立公式块 ($$...$$)"
                helpKey="formula.block"
                onClick={() => handleInsertMath('block')}
              />
              <ToolbarDropdownItem
                icon={<Workflow size={14} />}
                label="Mermaid 流程图表"
                onClick={handleInsertMermaid}
              />
              <ToolbarDropdownItem
                icon={<BarChart3 size={14} color="#3b82f6" />}
                label="Infographic 现代信息图"
                onClick={handleInsertInfographic}
              />
            </>
          }
        />

        {/* 6. 图片二级菜单 */}
        <ToolbarOverflowItem id="image"><ToolbarDropdownItem
          icon={<ImageIcon size={14} />}
          label="图片"
          disabled={!allowsStructure}
          submenu={
            <ImageInsertItems editor={isSourceMode ? null : editor} onLocal={handleInsertLocalImage} onNetwork={handleInsertNetworkImage} onDone={() => setInsertDropdownOpen(false)}/>
          }
        /></ToolbarOverflowItem>

        {/* 7. 超链接菜单项 */}
        <ToolbarOverflowItem id="link"><ToolbarDropdownItem
          icon={<Link2 size={14} />}
          label="超链接"
          disabled={!canInline || selectedCells}
          shortcut="Ctrl+K"
          onClick={handleOpenLink}
        /></ToolbarOverflowItem>

        {/* 8. 日期时间二级菜单 */}
        <ToolbarOverflowItem id="text-reset"><>
          <ToolbarDropdownItem icon={<RemoveFormatting size={14}/>} label="清除文字样式" disabled={scope ? !canInline : !canBlocks}
            onClick={() => { setInsertDropdownOpen(false); handleClearFormat(); }}/>
          <ToolbarDropdownItem icon={<Pilcrow size={14}/>} label="还原为正文" shortcut="Ctrl+0" disabled={!canBlocks}
            onClick={() => { setInsertDropdownOpen(false); handleSetHeading('paragraph'); }}/>
        </></ToolbarOverflowItem>
        <ToolbarDropdownItem
          icon={<Calendar size={14} />}
          label="日期时间"
          disabled={!canInline}
          submenu={
            <>
              <ToolbarDropdownItem
                icon={<Calendar size={14} />}
                label="插入当前日期"
                onClick={() => handleInsertDateTime('date')}
              />
              <ToolbarDropdownItem
                icon={<Clock size={14} />}
                label="插入当前时刻"
                onClick={() => handleInsertDateTime('time')}
              />
              <ToolbarDropdownItem
                icon={<Calendar size={14} />}
                label="插入日期与时刻"
                onClick={() => handleInsertDateTime('datetime')}
              />
            </>
          }
        />

        {/* 9. 水平分割线 */}
        <ToolbarDropdownItem
          icon={<Minus size={14} />}
          label="水平分割线"
          helpKey="block.divider"
          disabled={!allowsStructure}
          onClick={handleInsertDivider}
        />
      </ToolbarDropdown>}

      {/* ── 媒体与超链接 ── */}
      <ToolbarButton
        icon={<Link2 size={15} />}
        title="插入/编辑超链接"
        disabled={!canInline || selectedCells}
        overflowId="link"
        collapsePriority={30}
        shortcut="Ctrl+K"
        active={!isSourceMode && Boolean(editor?.isActive('link'))}
        onClick={handleOpenLink}
      />
      {!selectedCells && allowsStructure && <ImageInsertMenu editor={isSourceMode ? null : editor} onLocal={handleInsertLocalImage} onNetwork={handleInsertNetworkImage} collapsePriority={70} overflowId="image"/>}
      {!isSourceMode && editor && allowsStructure && canInline && !selectedCells && <AnnotationButton editor={editor} collapsePriority={100}/>}
      {!isSourceMode && editor && allowsStructure && canInline && !selectedCells && <RichSelectionMenu editor={editor}/>}

      <ToolbarDivider />

      {/* ── 清除格式 ── */}
      {hasMarkdownLink && <ToolbarButton icon={<RefreshCw size={15}/>} title="更新关联 Markdown" label="更新关联 Markdown" collapsePriority={25}
        onClick={() => { void import('../editor-code/orchestration/saveDocument').then(({ saveDocument }) => saveDocument(docKey)); }}/>}
      <TextResetControl
        open={resetDropdownOpen} onOpenChange={setResetDropdownOpen}
        disabled={scope ? !canInline : !canBlocks}
        restoreDisabled={!canBlocks} collapsePriority={60} overflowId="text-reset"
        onClear={handleClearFormat} onRestore={() => handleSetHeading('paragraph')}
        onReturnToEditor={() => { if (!isCurrentTarget()) return; if (isSourceMode) getActiveSourceView(docKey)?.focus(); else editor?.view.dom.focus({ preventScroll: true }); }}
      />
    </ResponsiveToolbar>
  );
}
