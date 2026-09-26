import type { Editor, ChainedCommands } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { foldedSectionEnd } from './headingFolding';
import { dispatchDiscreteEdit, runDiscreteEdit } from './discreteEdit';
import { isListItem, listItemRemovalRange } from './listItemActions';
import { DOCUMENT_SLICE_MIME } from './clipboard/constants';
import { documentSliceClipboardData } from './clipboard/structured';
import { isBlockInteractionTarget } from './blockInteractionScope';

export function blockRange(editor: Editor, pos: number) {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || !isBlockInteractionTarget(editor.state.doc, pos)) return null;
  return { node, from: pos, to: foldedSectionEnd(editor.state, pos) ?? pos + node.nodeSize };
}
export function selectBlock(editor: Editor, pos: number, titleOnly = false): boolean {
  const range = blockRange(editor, pos); if (!range) return false;
  let selection;
  if (range.node.type.name === 'table') {
    const map = TableMap.get(range.node), start = pos + 1;
    selection = CellSelection.create(editor.state.doc, start + map.map[0], start + map.map[map.map.length - 1]);
  } else if (!titleOnly && range.to > pos + range.node.nodeSize) {
    selection = TextSelection.create(editor.state.doc, pos + 1, range.to - 1);
  } else selection = NodeSelection.create(editor.state.doc, pos);
  editor.view.dispatch(editor.state.tr.setSelection(selection));
  return true;
}
export function formatBlock(editor: Editor, pos: number, command: (chain: ChainedCommands) => ChainedCommands, titleOnly = false) {
  const range = blockRange(editor, pos); if (!range) return false;
  const end = titleOnly ? pos + range.node.nodeSize : range.to;
  return runDiscreteEdit(editor, chain => {
    if (isListItem(range.node)) {
      chain = chain.setTextSelection({ from: pos + 2, to: titleOnly ? pos + range.node.firstChild!.nodeSize : end - 2 });
      if (titleOnly) chain = chain.liftListItem(range.node.type.name);
    } else chain = chain.setTextSelection({ from: pos + 1, to: end - 1 });
    return command(chain);
  });
}
export function deleteBlock(editor: Editor, pos: number) {
  const range = blockRange(editor, pos); if (!range) return false;
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
  const slice = editor.state.doc.slice(range.from, range.to);
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
  if (copied && cut) deleteBlock(editor, pos);
  return copied;
}
