import type { Editor } from '@tiptap/core';
import { initializeEditorDocument, serializeNativeNode } from '../../src/features/editor-md/editorDocumentCodec';

/** Rich editing fixtures must declare NB; unowned editors default to Markdown. */
export function nativeTestEditor(editor: Editor): Editor {
  initializeEditorDocument(editor, serializeNativeNode(editor.state.doc), 'noteboard');
  return editor;
}
