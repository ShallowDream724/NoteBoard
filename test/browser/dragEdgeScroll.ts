import { Editor } from '@tiptap/core';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { TableMarginSelection } from '../../src/features/editor-md/tableMarginSelection';
import { TableSelectionHandles } from '../../src/features/editor-md/tableSelectionHandles';
import { initializeEditorDocument, serializeNativeNode } from '../../src/features/editor-md/editorDocumentCodec';
import '../../src/styles/globals.css';

const style = document.createElement('style');
style.textContent = `body{margin:0;padding:24px;font:16px/1.5 system-ui}#scroller{width:680px;height:270px;overflow:auto;border:1px solid #aaa}#editor{width:580px;padding:8px 24px}.ProseMirror{outline:none}#editor table{margin:0 auto}#editor tr{height:36px}`;
document.head.append(style);
const editor = new Editor({ element: document.getElementById('editor')!, extensions: [
  ...buildDocumentExtensions(), TableMarginSelection, TableSelectionHandles,
], content: { type: 'doc', content: [{ type: 'table', content: Array.from({ length: 40 }, (_, row) => ({
  type: 'tableRow', content: [0, 1].map(column => ({
    type: 'tableCell', attrs: { colwidth: [160] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: `${row + 1} / ${column + 1}` }] }],
  })),
})) }] } });
initializeEditorDocument(editor, serializeNativeNode(editor.state.doc), 'noteboard');

const qa = {
  selectionRows: () => {
    const selection = editor.state.selection;
    if (!(selection instanceof CellSelection) || !selection.isRowSelection()) return null;
    const map = TableMap.get(selection.$anchorCell.node(-1)), start = selection.$anchorCell.start(-1);
    const bounds = map.rectBetween(selection.$anchorCell.pos - start, selection.$headCell.pos - start);
    return [bounds.top, bounds.bottom];
  },
  rowLabels: () => Array.from(editor.view.dom.querySelectorAll('table > tbody > tr'), row => row.textContent?.trim() ?? ''),
};
declare global { interface Window { dragEdgeQA: typeof qa } }
window.dragEdgeQA = qa;
