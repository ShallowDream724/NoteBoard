import type { Editor } from '@tiptap/core';
import { Fragment, type Node } from '@tiptap/pm/model';
import { NodeSelection, TextSelection, Selection, type Transaction } from '@tiptap/pm/state';
import type { Step } from '@tiptap/pm/transform';
import { NumberingAttributesStep } from './attributesStep';
import { dispatchDiscreteEdit } from '../discreteEdit';
import { NUMBERING_OPERATION } from './extension';
import { isOrdered, linkedGroup, normalizeNumbering, orderedAt, orderedSegmentAttrs, orderedSiblings, preserveListSelection, splitOrderedAt, startOf, validStart } from './model';
import { normalizeNumberingStyle, type NumberingStyle } from './styles';
import { ownNumberingDraft, settleNumberingDraft } from './session';
import { EDITOR_MENU_PREVIEW_META } from '../menuPreview';

export interface NumberingContext {
  available: boolean; style: NumberingStyle; start: number; next: number | null;
  previousText: string; currentText: string; canContinue: boolean;
  previousStyle?: NumberingStyle;
}
function selectionFor(editor: Editor, targetPos?: number): Selection {
  const { doc, selection } = editor.state;
  if (targetPos === undefined || !doc.nodeAt(targetPos)) return selection;
  const end = targetPos + doc.nodeAt(targetPos)!.nodeSize;
  return selection instanceof TextSelection && !selection.empty && selection.from < end && selection.to > targetPos
    ? selection : NodeSelection.create(doc, targetPos);
}
const summary = (node: Node | null) => (node?.firstChild?.textContent ?? node?.textContent ?? '').slice(0, 180);
function displayedStyle(doc: Node, node: Node, pos: number): NumberingStyle {
  if (node.attrs.numberStyle) return normalizeNumberingStyle(node.attrs.numberStyle);
  const at = doc.resolve(pos); let level = 1;
  for (let depth = at.depth; depth; depth--) if (isOrdered(at.node(depth))) level++;
  return level >= 3 ? 'lower-roman' : level === 2 ? 'upper-alpha' : 'decimal';
}
export function getNumberingContext(editor: Editor, targetPos?: number): NumberingContext {
  const unavailable: NumberingContext = { available: false, style: 'decimal', start: 1, next: null, previousText: '', currentText: '', canContinue: false };
  if (editor.isDestroyed) return unavailable;
  const located = orderedAt(editor.state.doc, selectionFor(editor, targetPos));
  if (!located) return unavailable;
  const { entry, itemIndex } = located, siblings = orderedSiblings(entry), at = siblings.findIndex(item => item.pos === entry.pos), previous = siblings[at - 1];
  const next = itemIndex ? startOf(entry.node) + itemIndex : previous ? startOf(previous.node) + previous.node.childCount : null;
  const priorItem = itemIndex ? entry.node.child(itemIndex - 1) : previous?.node.lastChild ?? null;
  return { available: true, style: displayedStyle(editor.state.doc, entry.node, entry.pos), start: startOf(entry.node) + itemIndex, next,
    previousStyle: itemIndex || !previous ? displayedStyle(editor.state.doc, entry.node, entry.pos) : displayedStyle(editor.state.doc, previous.node, previous.pos),
    previousText: summary(priorItem), currentText: summary(entry.node.child(itemIndex)), canContinue: next !== null };
}

function startTransaction(tr: Transaction, selection: Selection, value: number, continuation: boolean): boolean {
  if (!validStart(value)) return false;
  const located = orderedAt(tr.doc, selection); if (!located) return false;
  const mappingStart = tr.mapping.maps.length;
  splitOrderedAt(tr, located.entry, located.itemIndex, { start: value, numbering: continuation ? 'continue' : 'restart' });
  normalizeNumbering(tr); preserveListSelection(tr, selection, mappingStart);
  tr.setMeta(NUMBERING_OPERATION, true); return true;
}
export function restartNumbering(editor: Editor, start: number): boolean {
  if (editor.isDestroyed) return false;
  const tr = editor.state.tr;
  if (!startTransaction(tr, editor.state.selection, start, false)) return false;
  if (tr.docChanged) dispatchDiscreteEdit(editor.view, tr);
  return true;
}
export function continueNumbering(editor: Editor): boolean {
  const context = getNumberingContext(editor); if (!context.canContinue || context.next === null) return false;
  const tr = editor.state.tr;
  if (!startTransaction(tr, editor.state.selection, context.next, true)) return false;
  if (tr.docChanged) dispatchDiscreteEdit(editor.view, tr);
  return true;
}

/** Direct text overlap, not a whole enclosing list's bounding range. Nested
 * descendants have independent numbering sequences and independent selection. */
function selectedItem(item: Node, pos: number, selection: Selection) {
  let selected = false;
  item.forEach((child, offset) => {
    if (!child.isTextblock) return;
    const from = pos + 2 + offset, to = pos + offset + child.nodeSize;
    selected ||= from === to ? selection.from <= from && selection.to > from : selection.from < to && selection.to > from;
  });
  return selected;
}
function styleSelected(node: Node, pos: number, selection: Selection, style: NumberingStyle): Node[] {
  if (node.isTextblock || node.isLeaf || selection.to <= pos || selection.from >= pos + node.nodeSize) return [node];
  if (isOrdered(node)) {
    const pieces: { selected: boolean; items: Node[]; from: number }[] = [];
    let changed = false;
    node.forEach((item, offset, index) => {
      const at = pos + 1 + offset, selected = selectedItem(item, at, selection), children: Node[] = [];
      item.forEach((child, childOffset) => children.push(...styleSelected(child, at + 1 + childOffset, selection, style)));
      const content = Fragment.fromArray(children), next = content.eq(item.content) ? item : item.copy(content);
      changed ||= next !== item || selected && node.attrs.numberStyle !== style;
      const last = pieces.at(-1);
      if (last?.selected === selected) last.items.push(next); else pieces.push({ selected, items: [next], from: index });
    });
    if (!changed) return [node];
    return pieces.map((piece, index) => node.type.create({ ...orderedSegmentAttrs(node, piece.from), ...(index ? { annotationId: null } : {}), ...(piece.selected ? { numberStyle: style } : {}) }, Fragment.fromArray(piece.items), node.marks));
  }
  const children: Node[] = [];
  node.forEach((child, offset) => children.push(...styleSelected(child, pos + 1 + offset, selection, style)));
  const content = Fragment.fromArray(children);
  return [content.eq(node.content) ? node : node.copy(content)];
}
export function setNumberingStyle(editor: Editor, requested: NumberingStyle): boolean {
  if (editor.isDestroyed) return false;
  const style = normalizeNumberingStyle(requested), { selection, doc } = editor.state, tr = editor.state.tr;
  if (selection.empty || selection instanceof NodeSelection) {
    const located = orderedAt(doc, selection); if (!located) return false;
    const patches = linkedGroup(located.entry).filter(entry => entry.node.attrs.numberStyle !== style).map(entry => ({ pos: entry.pos, attrs: { numberStyle: style } }));
    if (patches.length) tr.step(new NumberingAttributesStep(patches));
  } else {
    const plans: { pos: number; node: Node; next: Node[] }[] = [];
    doc.nodesBetween(selection.from, selection.to, (node, pos) => {
      if (!isOrdered(node)) return !node.isTextblock;
      const next = styleSelected(node, pos, selection, style);
      if (next.length !== 1 || next[0] !== node) plans.push({ pos, node, next });
      return false;
    });
    for (const plan of plans.sort((a, b) => b.pos - a.pos)) tr.replaceWith(plan.pos, plan.pos + plan.node.nodeSize, Fragment.fromArray(plan.next));
    if (tr.docChanged) preserveListSelection(tr, selection);
  }
  if (tr.docChanged) { normalizeNumbering(tr); dispatchDiscreteEdit(editor.view, tr.setMeta(NUMBERING_OPERATION, true)); }
  return true;
}

/** A short-lived live preview. Only inverse steps and an immutable root are
 * retained while the menu is open. Preview never reaches autosave/history;
 * commit replays one ordinary command from the original document. */
export function createNumberingDraft(editor: Editor) {
  settleNumberingDraft(editor);
  let expected: Node | null = editor.state.doc, originalSelection: Selection | null = editor.state.selection;
  let inverse: Step[] = [], last: number | null = null, closed = false;
  const owns = () => !closed && !editor.isDestroyed && expected === editor.state.doc;
  function rollback(tr: Transaction) {
    for (const step of inverse) tr.step(step);
    if (originalSelection) tr.setSelection(Selection.fromJSON(tr.doc, originalSelection.toJSON()));
  }
  const disown = ownNumberingDraft(editor, commit);
  editor.on('destroy', release);
  function release() { closed = true; expected = null; originalSelection = null; inverse = []; disown(); editor.off('destroy', release); }
  function update(value: number) {
    if (!owns() || !validStart(value) || !originalSelection) return false;
    const tr = editor.state.tr; rollback(tr);
    const first = tr.steps.length;
    if (!startTransaction(tr, tr.selection, value, false)) return false;
    inverse = tr.steps.slice(first).map((step, index) => step.invert(tr.docs[first + index])).reverse(); last = value;
    editor.view.dispatch(tr.setMeta(EDITOR_MENU_PREVIEW_META, true).setMeta('preventUpdate', true).setMeta('addToHistory', false)); expected = editor.state.doc;
    return true;
  }
  function cancel() {
    if (owns() && inverse.length) {
      const tr = editor.state.tr; rollback(tr);
      editor.view.dispatch(tr.setMeta(NUMBERING_OPERATION, true).setMeta(EDITOR_MENU_PREVIEW_META, true).setMeta('preventUpdate', true).setMeta('addToHistory', false));
    }
    release();
  }
  function commit() {
    if (!owns() || !originalSelection || last === null) { release(); return; }
    const value = last;
    const tr = editor.state.tr; rollback(tr);
    editor.view.dispatch(tr.setMeta(NUMBERING_OPERATION, true).setMeta(EDITOR_MENU_PREVIEW_META, true).setMeta('preventUpdate', true).setMeta('addToHistory', false));
    release(); restartNumbering(editor, value);
  }
  return { update, commit, cancel, destroy: commit };
}
