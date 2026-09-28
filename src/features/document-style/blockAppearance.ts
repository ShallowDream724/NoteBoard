import type { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { documentColor } from './colors';
import { supportsBlockColors } from './blockAppearanceSchema';
import { dispatchDiscreteEdit } from '../editor-md/discreteEdit';
import { runWithDocumentCapability } from '../document-format/featureGate';

export function blockColors(node: Node) {
  return node.type.name === 'mathBlock'
    ? { color: documentColor(node.attrs.textColor), background: documentColor(node.attrs.background) }
    : { color: documentColor(node.attrs.blockTextColor), background: documentColor(node.attrs.blockBackground) };
}
/** Changes node defaults only; explicit inline marks continue to override inheritance. */
export function setBlockColors(editor: Editor, pos: number, patch: { color?: string | null; background?: string | null }): boolean {
  const original = editor.state.doc.nodeAt(pos);
  if (!original || !supportsBlockColors(original.type.name)) return false;
  return runWithDocumentCapability(editor, 'textColor', next => {
    const node = next.state.doc.nodeAt(pos); if (!node || node.type.name !== original.type.name) return false;
    const fields = node.type.name === 'mathBlock' ? ['textColor', 'background'] : ['blockTextColor', 'blockBackground'];
    const tr = next.state.tr;
    if (patch.color !== undefined && documentColor(patch.color) !== documentColor(node.attrs[fields[0]])) tr.setNodeAttribute(pos, fields[0], documentColor(patch.color));
    if (patch.background !== undefined && documentColor(patch.background) !== documentColor(node.attrs[fields[1]])) tr.setNodeAttribute(pos, fields[1], documentColor(patch.background));
    if (!tr.docChanged) return false;
    dispatchDiscreteEdit(next.view, tr); return true;
  });
}
