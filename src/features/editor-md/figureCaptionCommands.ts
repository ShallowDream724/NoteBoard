import type { Editor, JSONContent } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import { runWithDocumentCapability } from '../document-format/featureGate';
import { dispatchDiscreteEdit } from './discreteEdit';
import { BlockMetadataStep } from './blockMetadataStep';
import { figureCaptionText, normalizeFigureCaption, validateFigureCaption, validateFigureCaptionContent } from './figureCaption';

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
  if (view.state.doc.nodeAt(pos)!.attrs.caption === caption && !view.state.doc.nodeAt(pos)!.attrs.captionContent) return true;
  dispatchDiscreteEdit(view, view.state.tr.step(new BlockMetadataStep(pos, 'caption', caption)).step(new BlockMetadataStep(pos, 'captionContent', null)));
  return view.state.doc.nodeAt(pos)?.attrs.caption === caption;
}

/** Live inline edits share the containing document's history and autosave. */
export function setFigureCaptionContent(view: EditorView, pos: number, content: JSONContent[], discrete = false, historyGroup?: number): boolean {
  const node = view.state.doc.nodeAt(pos);
  if (!node || !['image', 'table'].includes(node.type.name)) return false;
  try { validateFigureCaptionContent(content); } catch { return false; }
  const caption = figureCaptionText(content), rich = caption ? content : null;
  if (node.attrs.caption === caption && JSON.stringify(node.attrs.captionContent) === JSON.stringify(rich)) return true;
  const tr = view.state.tr.step(new BlockMetadataStep(pos, 'caption', caption)).step(new BlockMetadataStep(pos, 'captionContent', rich));
  // Metadata steps deliberately have empty maps. Give a live typing burst a
  // composition identity so PM history groups it without fake document ranges.
  if (historyGroup !== undefined && !discrete) tr.setMeta('composition', historyGroup);
  if (discrete) dispatchDiscreteEdit(view, tr); else view.dispatch(tr);
  return view.state.doc.nodeAt(pos)?.attrs.caption === caption;
}
