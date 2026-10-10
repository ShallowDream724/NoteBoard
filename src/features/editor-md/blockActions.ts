import type { Editor, ChainedCommands } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { foldedSectionEnd } from './headingFolding';
import { dispatchDiscreteEdit, runDiscreteEdit } from './discreteEdit';
import { isListItem, listItemRemovalRange } from './listItemActions';
import { DOCUMENT_SLICE_MIME } from './clipboard/constants';
import { documentSliceClipboardData } from './clipboard/structured';
import { isBlockInteractionTarget } from './blockInteractionScope';
import { imageRemovalTransaction, requestImageRemoval } from './imageRemoval';
import { imageSelectionSlice } from './imageCaptions';
import { editorDocumentKey } from './editorDocumentCodec';
import { emit } from '../../core/emitter';
import { RESTORABLE_TEXT_CONTAINERS } from './textContainerRestoration';

export function blockRange(editor: Editor, pos: number) {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || !isBlockInteractionTarget(editor.state.doc, pos)) return null;
  return { node, from: pos, to: foldedSectionEnd(editor.state, pos) ?? pos + node.nodeSize };
}
/** Keep the user range only when it belongs to this logical block. Hovering
 * another block must not silently redirect its text actions. */
export function blockHasTextSelection(editor: Editor, pos: number): boolean {
  const range = blockRange(editor, pos), selection = editor.state.selection;
  return !!range && selection instanceof TextSelection && !selection.empty
    && selection.from >= range.from && selection.to <= range.to;
}
export function blockSelection(editor: Editor, pos: number, titleOnly = false) {
  const range = blockRange(editor, pos); if (!range) return null;
  let selection;
  if (range.node.type.name === 'table') {
    const map = TableMap.get(range.node), start = pos + 1;
    selection = CellSelection.create(editor.state.doc, start + map.map[0], start + map.map[map.map.length - 1]);
  } else if (!titleOnly && range.to > pos + range.node.nodeSize) {
    selection = TextSelection.create(editor.state.doc, pos + 1, range.to - 1);
  } else selection = NodeSelection.create(editor.state.doc, pos);
  return selection;
}
export function selectBlock(editor: Editor, pos: number, titleOnly = false): boolean {
  const selection = blockSelection(editor, pos, titleOnly); if (!selection) return false;
  if (!editor.state.selection.eq(selection)) editor.view.dispatch(editor.state.tr.setSelection(selection).setMeta('addToHistory', false));
  return true;
}
function formatBlockRange(editor: Editor, pos: number, command: (chain: ChainedCommands) => ChainedCommands, options: { mainBodyOnly: boolean; liftItem: boolean }) {
  const { mainBodyOnly: titleOnly, liftItem } = options;
  const range = blockRange(editor, pos); if (!range) return false;
  const end = titleOnly ? pos + range.node.nodeSize : range.to;
  return runDiscreteEdit(editor, chain => {
    if (isListItem(range.node)) {
      chain = chain.command(({ tr }) => {
        tr.setSelection(TextSelection.between(tr.doc.resolve(pos + 2), tr.doc.resolve(titleOnly ? pos + range.node.firstChild!.nodeSize : end - 2)));
        return true;
      });
      if (liftItem) chain = chain.liftListItem(range.node.type.name);
    } else chain = chain.setTextSelection({ from: pos + 1, to: end - 1 });
    return command(chain);
  });
}
export function formatBlock(editor: Editor, pos: number, command: (chain: ChainedCommands) => ChainedCommands, titleOnly = false) {
  return formatBlockRange(editor, pos, command, { mainBodyOnly: titleOnly, liftItem: titleOnly });
}
/** Restoring structure owns list unwrapping; selecting the item body must not lift it first. */
export function restoreBlockParagraph(editor: Editor, pos: number) {
  const node = editor.state.doc.nodeAt(pos);
  if (node && RESTORABLE_TEXT_CONTAINERS.has(node.type.name)) {
    if (!selectBlock(editor, pos, true)) return false;
    return runDiscreteEdit(editor, chain => chain.restoreParagraph());
  }
  return formatBlockRange(editor, pos, chain => chain.restoreParagraph(), { mainBodyOnly: true, liftItem: false });
}
/** Use the existing link editor after selecting this item's main text, without
 * changing its list level or keeping a second dialog/selection implementation. */
export function editBlockLink(editor: Editor, pos: number) {
  const key = editorDocumentKey(editor);
  if (!key) return false;
  if (!blockHasTextSelection(editor, pos) && !formatBlockRange(editor, pos, chain => chain, { mainBodyOnly: true, liftItem: false })) return false;
  emit('open-link-modal', { key });
  return true;
}
export function deleteBlock(editor: Editor, pos: number) {
  const range = blockRange(editor, pos); if (!range) return false;
  if (range.node.type.name === 'image') { void requestImageRemoval(editor.view, pos); return true; }
  const removed = isListItem(range.node) ? listItemRemovalRange(editor.state.doc, pos) : range;
  dispatchDiscreteEdit(editor.view, editor.state.tr.delete(removed.from, removed.to)); editor.view.focus(); return true;
}
export function insertAfterBlock(editor: Editor, pos: number) {
  const range = blockRange(editor, pos); if (!range) return;
  const item = isListItem(range.node);
  const node = item ? range.node.type.createAndFill()! : editor.schema.nodes.paragraph.create();
  const tr = editor.state.tr.insert(range.to, node);
  tr.setSelection(TextSelection.near(tr.doc.resolve(range.to + 1))); dispatchDiscreteEdit(editor.view, tr); editor.view.focus();
}
/** Native copy keeps HTML/schema styles alongside plain text. Delete only after successful copy. */
export function copyBlock(editor: Editor, pos: number, cut = false): boolean {
  const range = blockRange(editor, pos); if (!range) return false;
  const slice = range.node.type.name === 'image'
    ? imageSelectionSlice(editor.state.apply(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos))))
    : editor.state.doc.slice(range.from, range.to);
  const serialized = editor.view.serializeForClipboard(slice);
  let copied = false;
  const write = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    event.clipboardData.setData('text/html', serialized.dom.innerHTML);
    event.clipboardData.setData('text/plain', serialized.text);
    event.clipboardData.setData(DOCUMENT_SLICE_MIME, documentSliceClipboardData(editor.state.doc, slice));
    event.preventDefault(); event.stopImmediatePropagation(); copied = true;
  };
  document.addEventListener('copy', write, true);
  try { editor.view.focus(); document.execCommand('copy'); } finally { document.removeEventListener('copy', write, true); }
  if (copied && cut) {
    const removed = isListItem(range.node) ? listItemRemovalRange(editor.state.doc, pos) : range;
    const tr = range.node.type.name === 'image' ? imageRemovalTransaction(editor.state, pos, 'remove')! : editor.state.tr.delete(removed.from, removed.to);
    dispatchDiscreteEdit(editor.view, tr.setMeta('noteboard-image-cut', true));
  }
  return copied;
}
