import type { Editor } from '@tiptap/core';
import { Fragment, type Node } from '@tiptap/pm/model';
import { NodeSelection, TextSelection, type Transaction } from '@tiptap/pm/state';
import { dispatchDiscreteEdit } from './discreteEdit';

const richContainers = new Set(['disclosure', 'githubAlert', 'blockquote', 'tableCell', 'tableHeader']);
const terminalBlocks = new Set(['image', 'imageCollection', 'table', 'mathBlock', 'mermaidBlock', 'plantumlBlock', 'infographicBlock', 'horizontalRule', 'disclosure', 'githubAlert']);

export function needsContainerTail(node: Node): boolean {
  return richContainers.has(node.type.name) && !!node.lastChild && terminalBlocks.has(node.lastChild.type.name);
}
export function appendContainerParagraph(tr: Transaction, pos: number, focus = true): boolean {
  const node = tr.doc.nodeAt(pos);
  if (!node || !needsContainerTail(node)) return false;
  const paragraph = tr.doc.type.schema.nodes.paragraph.create();
  if (!node.canReplace(node.childCount, node.childCount, Fragment.from(paragraph))) return false;
  const end = pos + node.nodeSize - 1;
  tr.insert(end, paragraph);
  if (focus) tr.setSelection(TextSelection.create(tr.doc, end + 1));
  return true;
}
/** Follow only the original insertion's ancestor path, even when replacing an
 * ending atom moved ProseMirror's selection outside its container. */
export function ensureContainerTail(tr: Transaction, originalPos: number, focus = true): boolean {
  const at = tr.before.resolve(Math.max(0, Math.min(originalPos, tr.before.content.size)));
  for (let depth = at.depth; depth > 0; depth--) if (richContainers.has(at.node(depth).type.name)) {
    const mapped = tr.mapping.mapResult(at.before(depth), 1);
    return !mapped.deletedAcross && appendContainerParagraph(tr, mapped.pos, focus);
  }
  return false;
}
export function continueContainerWriting(editor: Editor, pos: number | undefined): boolean {
  if (pos === undefined || !editor.isEditable) return false;
  const tr = editor.state.tr;
  if (!appendContainerParagraph(tr, pos)) return false;
  dispatchDiscreteEdit(editor.view, tr.scrollIntoView()); editor.view.focus(); return true;
}
type TailKeyEvent = Pick<KeyboardEvent, 'defaultPrevented' | 'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey' | 'preventDefault'>;
export function handleContainerTailKey(editor: Editor, pos: number | undefined, event: TailKeyEvent): boolean {
  if (event.defaultPrevented || !['Enter', 'ArrowDown'].includes(event.key) || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || pos === undefined) return false;
  const { selection, doc } = editor.state, node = doc.nodeAt(pos);
  if (!(selection instanceof NodeSelection) || !node || !needsContainerTail(node) || selection.to !== pos + node.nodeSize - 1) return false;
  if (!continueContainerWriting(editor, pos)) return false;
  event.preventDefault(); return true;
}
