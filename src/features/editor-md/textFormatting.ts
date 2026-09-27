import type { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { CellSelection } from '@tiptap/pm/tables';
import { dispatchDiscreteEdit } from './discreteEdit';
import { selectBlock } from './blockActions';
import { styleSelectedCells } from '../document-style/cellTextStyle';
import { figureCaptionContent } from './figureCaption';
import { BlockMetadataStep } from './blockMetadataStep';
import { NodeSelection } from '@tiptap/pm/state';
import { unwrapCallout } from './alertCommands';

/** Presentation only. Links, annotations and concealment carry meaning. */
export const TEXT_STYLE_MARKS = ['bold', 'italic', 'underline', 'strike', 'code', 'highlight', 'textColor', 'subscript', 'superscript'] as const;

// Explicit product policy, not "any node containing text". Source/media atoms
// and internal container nodes are intentionally excluded from the block menu.
const BLOCK_TEXT_FORMATTING: Record<string, boolean> = {
  paragraph: true, heading: true, bulletList: true, orderedList: true,
  taskList: true, listItem: true, taskItem: true, blockquote: true,
  githubAlert: false, disclosure: true, table: true,
  codeBlock: false, mathBlock: false, mermaidBlock: false,
  image: false, imageCollection: false, imageSlot: false,
  horizontalRule: false, documentPresentation: false,
};
export function supportsBlockTextFormatting(node: Node): boolean {
  return BLOCK_TEXT_FORMATTING[node.type.name] === true;
}

export function clearSelectionTextFormatting(editor: Editor): boolean {
  const { state } = editor, { selection } = state;
  if (selection instanceof NodeSelection && selection.node.type.name === 'githubAlert') return unwrapCallout(editor, selection.from);
  const marks = TEXT_STYLE_MARKS.filter(name => !!state.schema.marks[name]);
  if (selection instanceof CellSelection) {
    const result = styleSelectedCells(editor, marks.map(type => ({ type, attrs: null })), { textColor: null, background: null });
    if (result !== null) return result;
  }
  const ranges = selection.empty && selection.$from.parent.isTextblock
    ? [{ from: selection.$from.start(), to: selection.$from.end() }]
    : selection.ranges.map(({ $from, $to }) => ({ from: $from.pos, to: $to.pos }));
  const tr = state.tr;
  for (const { from, to } of ranges) for (const mark of marks) tr.removeMark(from, to, state.schema.marks[mark]);
  if (selection.empty) for (const mark of marks) tr.removeStoredMark(state.schema.marks[mark]);
  if (!tr.docChanged && !tr.storedMarksSet) return false;
  // No implicit focus/scroll: this action belongs to the selected text, even if
  // the caret was elsewhere before a block menu opened.
  dispatchDiscreteEdit(editor.view, tr);
  return true;
}

export function clearBlockFormatting(editor: Editor, pos: number): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (node?.type.name === 'githubAlert') return unwrapCallout(editor, pos);
  if (!node || !supportsBlockTextFormatting(node) || !selectBlock(editor, pos, true)) return false;
  return clearSelectionTextFormatting(editor);
}

export function hasCaptionTextFormatting(node: Node): boolean {
  if (['image', 'table'].includes(node.type.name)) return figureCaptionContent(node.attrs.caption, node.attrs.captionContent)
    .some(item => item.marks?.some(mark => (TEXT_STYLE_MARKS as readonly string[]).includes(mark.type)));
  if (node.type.name !== 'imageCollection') return false;
  let found = false;
  node.descendants(child => {
    if (child.type.name === 'image') found ||= hasCaptionTextFormatting(child);
    if (child.isText) found ||= child.marks.some(mark => (TEXT_STYLE_MARKS as readonly string[]).includes(mark.type.name));
    return !found;
  });
  return found;
}
export function clearCaptionTextFormatting(editor: Editor, pos: number): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || !hasCaptionTextFormatting(node) || !selectBlock(editor, pos, true)) return false;
  const tr = editor.state.tr;
  const clear = (target: Node, at: number) => {
    if (!['image', 'table'].includes(target.type.name) || !hasCaptionTextFormatting(target)) return;
    const content = figureCaptionContent(target.attrs.caption, target.attrs.captionContent).map(item => ({
      ...item, marks: item.marks?.filter(mark => !(TEXT_STYLE_MARKS as readonly string[]).includes(mark.type)),
    }));
    tr.step(new BlockMetadataStep(at, 'captionContent', content));
  };
  clear(node, pos);
  if (node.type.name === 'imageCollection') node.descendants((child, offset) => {
    clear(child, pos + 1 + offset);
    // Slot captions are real rich paragraphs; legacy image captions are attrs.
    if (child.type.name === 'paragraph') {
      const start = pos + offset + 2;
      for (const mark of TEXT_STYLE_MARKS) if (editor.schema.marks[mark]) tr.removeMark(start, start + child.content.size, editor.schema.marks[mark]);
      return false;
    }
  });
  if (!tr.docChanged) return false;
  dispatchDiscreteEdit(editor.view, tr); return true;
}
