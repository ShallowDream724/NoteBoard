import React from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';
import { buildExtensions } from '../../src/features/editor-md/extensions';
import { EditorBubbleMenu, TableToolbar } from '../../src/features/editor-md/bubbleMenu';
import { TooltipProvider } from '../../src/components/Tooltip';
import { initializeEditorDocument, serializeNativeNode } from '../../src/features/editor-md/editorDocumentCodec';
import { useSettingsStore } from '../../src/stores/settingsStore';
import '../../src/styles/globals.css';

const style = document.createElement('style');
style.textContent = `:root{--editor-accent:#3b82f6;--editor-border:#e2e8f0;--editor-text-secondary:#64748b;--editor-surface:#fff;--editor-text:#1e293b}body{margin:0;font:18px/1.6 system-ui;color:#1e293b}#editor-shell{position:relative;isolation:isolate;height:760px;overflow:auto;padding:70px 80px;box-sizing:border-box}.ProseMirror{outline:none}td,th{height:80px}td.selectedCell,th.selectedCell{background:#dbeafe}`;
document.head.append(style);
useSettingsStore.setState(state => ({ settings: { ...state.settings, editor: { ...state.settings.editor, selectionToolbarPosition: 'above' } } }));
const editor = new Editor({ element: document.getElementById('editor')!, extensions: buildExtensions(), content: { type: 'doc', content: [
  { type: 'paragraph', content: [{ type: 'text', text: '表格工具栏层级回归' }] },
  { type: 'table', attrs: { tableAlign: 'center' }, content: Array.from({ length: 5 }, (_, row) => ({
    type: 'tableRow', content: [0, 1].map(column => ({ type: 'tableCell', attrs: { colwidth: [220] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: `第 ${row + 1} 行第 ${column + 1} 列文字` }] }] })),
  })) },
] } });
initializeEditorDocument(editor, serializeNativeNode(editor.state.doc), 'noteboard');
createRoot(document.getElementById('menus')!).render(<TooltipProvider><EditorBubbleMenu editor={editor}/><TableToolbar editor={editor}/></TooltipProvider>);
const cellPositions = () => {
  const positions: number[] = [];
  editor.state.doc.descendants((node, pos) => { if (node.type.name === 'tableCell') positions.push(pos); });
  return positions;
};
const qa = {
  select: (type: 'cell' | 'text') => {
    const pos = cellPositions()[6];
    editor.view.focus();
    if (type === 'cell') editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, pos)));
    else editor.commands.setTextSelection({ from: pos + 2, to: pos + 9 });
  },
  selection: () => ({ cell: editor.state.selection instanceof CellSelection, row: editor.state.selection instanceof CellSelection && editor.state.selection.isRowSelection(), column: editor.state.selection instanceof CellSelection && editor.state.selection.isColSelection() }),
  text: () => editor.state.doc.textContent,
};
declare global { interface Window { tableToolbarQA: typeof qa } }
window.tableToolbarQA = qa;
