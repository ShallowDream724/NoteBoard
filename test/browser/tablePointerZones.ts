import { Editor } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';
import { buildExtensions } from '../../src/features/editor-md/extensions';
import { initializeEditorDocument, serializeNativeNode } from '../../src/features/editor-md/editorDocumentCodec';
import '../../src/styles/globals.css';

const style = document.createElement('style');
style.textContent = `:root{--editor-accent:#3b82f6;--editor-border:#e2e8f0;--editor-text-secondary:#64748b;--editor-surface:#fff;--editor-text:#1e293b}body{margin:50px;font:18px/1.6 system-ui;color:#1e293b}#editor{width:800px}.ProseMirror{outline:none}td.selectedCell,th.selectedCell{background:#dbeafe}`;
document.head.append(style);
const editor = new Editor({ element: document.getElementById('editor')!, extensions: buildExtensions(), content: { type: 'doc', content: [
  { type: 'paragraph', content: [{ type: 'text', text: '表格之前的正文' }] },
  { type: 'table', attrs: { tableAlign: 'center', caption: '居中的表格：按内容选择记录方式。' }, content: Array.from({ length: 4 }, (_, row) => ({
    type: 'tableRow', content: [0, 1].map(column => ({ type: 'tableCell', attrs: { colwidth: [150] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: `${row + 1} / ${column + 1}` }] }] })),
  })) },
  { type: 'paragraph', content: [{ type: 'text', text: '表格之后的正文' }] },
] } });
initializeEditorDocument(editor, serializeNativeNode(editor.state.doc), 'noteboard');
const qa = {
  selection: () => ({ cell: editor.state.selection instanceof CellSelection, rows: editor.state.selection instanceof CellSelection && editor.state.selection.isRowSelection(), columns: editor.state.selection instanceof CellSelection && editor.state.selection.isColSelection(), count: editor.state.selection.ranges.length }),
};
declare global { interface Window { tablePointerQA: typeof qa } }
window.tablePointerQA = qa;
