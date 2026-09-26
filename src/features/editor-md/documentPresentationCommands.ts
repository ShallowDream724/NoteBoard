import type { Editor } from '@tiptap/core';
import { editorSupportsCapability, runWithDocumentCapability } from '../document-format/featureGate';
import { documentTableStyle, type TableStyle } from './documentPresentation';

export function setDocumentTableStyle(editor: Editor, value: TableStyle) {
  if (value !== 'standard' && !editorSupportsCapability(editor, 'tableStyle')) { runWithDocumentCapability(editor, 'tableStyle', next => setDocumentTableStyle(next, value)); return; }
  const { doc, tr } = editor.state;
  if (documentTableStyle(doc) === value) return;
  if (doc.firstChild?.type.name === 'documentPresentation') {
    if (value === 'standard') tr.delete(0, doc.firstChild.nodeSize);
    else tr.setNodeMarkup(0, undefined, { tableStyle: value });
  } else tr.insert(0, editor.schema.nodes.documentPresentation.create({ tableStyle: value }));
  editor.view.dispatch(tr);
}
