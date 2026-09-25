import type { Editor } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import { runWithDocumentCapability } from '../document-format/featureGate';
import { dispatchDiscreteEdit } from './discreteEdit';
import { BlockMetadataStep } from './blockMetadataStep';
import { normalizeFigureCaption, validateFigureCaption } from './figureCaption';

export const FIGURE_CAPTION_EDIT_EVENT = 'nb-edit-figure-caption';
export function editFigureCaption(editor: Editor, pos: number): boolean {
  if (editor.isDestroyed || !['image', 'table'].includes(editor.state.doc.nodeAt(pos)?.type.name ?? '')) return false;
  return runWithDocumentCapability(editor, 'figureCaption', next => {
    next.view.dom.dispatchEvent(new CustomEvent(FIGURE_CAPTION_EDIT_EVENT, { detail: { pos } }));
    return true;
  });
}
/** Owned caption editors commit one metadata edit; no editable table DOM is changed. */
export function setFigureCaption(view: EditorView, pos: number, value: string | null): boolean {
  if (!['image', 'table'].includes(view.state.doc.nodeAt(pos)?.type.name ?? '')) return false;
  const caption = normalizeFigureCaption(value);
  try { validateFigureCaption(caption); } catch { return false; }
  if (view.state.doc.nodeAt(pos)!.attrs.caption === caption) return true;
  dispatchDiscreteEdit(view, view.state.tr.step(new BlockMetadataStep(pos, 'caption', caption)));
  return view.state.doc.nodeAt(pos)?.attrs.caption === caption;
}
