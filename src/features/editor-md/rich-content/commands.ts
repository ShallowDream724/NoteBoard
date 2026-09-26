import type { Editor, JSONContent } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { runDiscreteEdit, dispatchDiscreteEdit } from '../discreteEdit';
import { editorSupportsCapability, runWithDocumentCapability } from '../../document-format/featureGate';

export type ImageTemplate = 4 | 6 | 9 | 'carousel';
export const IMAGE_TEMPLATES: { template: ImageTemplate; label: string }[] = [
  { template: 4, label: '四宫格' }, { template: 6, label: '六宫格' }, { template: 9, label: '九宫格' }, { template: 'carousel', label: '图片轮播' },
];
export function imageCollectionTemplate(template: ImageTemplate): JSONContent {
  return { type: 'imageCollection', attrs: { layout: template === 'carousel' ? 'carousel' : 'grid', columns: template === 6 || template === 9 ? 3 : 2 },
    content: Array.from({ length: template === 'carousel' ? 3 : template }, () => ({ type: 'imageSlot' })) };
}
export function insertImageCollection(editor: Editor, template: ImageTemplate) {
  if (!editorSupportsCapability(editor, 'gallery')) { runWithDocumentCapability(editor, 'gallery', next => insertImageCollection(next, template)); return; }
  runDiscreteEdit(editor, chain => chain.focus().insertContent(imageCollectionTemplate(template)));
}
export function insertDisclosure(editor: Editor) {
  if (!editorSupportsCapability(editor, 'disclosure')) { runWithDocumentCapability(editor, 'disclosure', insertDisclosure); return; }
  runDiscreteEdit(editor, chain => chain.focus().insertContent({ type: 'disclosure', content: [{ type: 'paragraph' }] }));
}
export function selectionConcealed(editor: Editor) {
  const { selection } = editor.state;
  return selection instanceof NodeSelection ? Boolean(selection.node.attrs.concealed) : editor.isActive('conceal');
}
export function toggleConceal(editor: Editor) {
  if (!editorSupportsCapability(editor, 'conceal')) return runWithDocumentCapability(editor, 'conceal', toggleConceal);
  const { selection } = editor.state;
  if (selection instanceof NodeSelection) {
    if (!Object.hasOwn(selection.node.attrs, 'concealed')) return false;
    dispatchDiscreteEdit(editor.view, editor.state.tr.setNodeAttribute(selection.from, 'concealed', !selection.node.attrs.concealed));
    return true;
  }
  if (selection.empty) return false;
  return runDiscreteEdit(editor, chain => chain.focus().toggleMark('conceal'));
}
