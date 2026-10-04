import type { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { ACTION_BLOCK, OBSERVATION_BLOCK, PRACTICE_TITLE, PRACTICE_WORD } from './practiceCourse';
import { editorDocumentKey } from '../editor-md/editorDocumentCodec';
import { isApplyingDocumentHistory, subscribeDocumentHistoryNavigation } from '../history/documentHistory';

export function ownsPracticeEditor(editor: Editor | null, key: string | null): editor is Editor {
  return !!editor && !editor.isDestroyed && !!key && editorDocumentKey(editor) === key;
}

export interface TextRange { from: number; to: number }
/** Searches only the active practice document, excluding hidden explanation storage. */
export function findPracticeText(doc: Node, text: string): TextRange | null {
  let range: TextRange | null = null;
  doc.descendants((node, pos) => {
    if (range || node.type.name === 'annotationStore' || node.type.name === 'documentPresentation') return false;
    if (!node.isTextblock) return;
    // This grammar's inline atoms occupy one position. A one-character leaf
    // placeholder preserves offsets without allocating an array per character.
    const source = node.textBetween(0, node.content.size, '', '\ufffc');
    const at = source.indexOf(text);
    if (at >= 0) range = { from: pos + 1 + at, to: pos + 1 + at + text.length };
    return false;
  });
  return range;
}

function anyVisibleNode(doc: Node, predicate: (node: Node) => boolean): boolean {
  let found = false;
  doc.descendants(node => {
    if (found || node.type.name === 'annotationStore') return false;
    if (predicate(node)) { found = true; return false; }
  });
  return found;
}

function highlighted(doc: Node): boolean {
  const range = findPracticeText(doc, PRACTICE_WORD);
  if (!range) return false;
  let covered = 0;
  doc.nodesBetween(range.from, range.to, (node, pos) => {
    if (node.isText && node.marks.some(mark => mark.type.name === 'highlight')) {
      covered += Math.max(0, Math.min(range.to, pos + node.nodeSize) - Math.max(range.from, pos));
    }
  });
  return covered === PRACTICE_WORD.length;
}

function hasExplanation(doc: Node): boolean {
  const range = findPracticeText(doc, PRACTICE_WORD);
  if (!range) return false;
  const ids = new Set<string>();
  const textCoverage = new Map<string, number>();
  doc.nodesBetween(range.from, range.to, (node, pos) => {
    if (typeof node.attrs.annotationId === 'string') ids.add(node.attrs.annotationId);
    for (const mark of node.marks) if (node.isText && mark.type.name === 'annotationReference' && typeof mark.attrs.id === 'string') {
      const length = Math.max(0, Math.min(range.to, pos + node.nodeSize) - Math.max(range.from, pos));
      textCoverage.set(mark.attrs.id, (textCoverage.get(mark.attrs.id) ?? 0) + length);
    }
  });
  for (const [id, length] of textCoverage) if (length === PRACTICE_WORD.length) ids.add(id);
  if (!ids.size) return false;
  let found = false;
  doc.descendants(node => {
    if (node.type.name === 'annotationBody' && ids.has(node.attrs.id) && node.textContent.trim()) found = true;
    return !found;
  });
  return found;
}

function filledObservationTable(doc: Node): boolean {
  return anyVisibleNode(doc, node => {
    if (node.type.name !== 'table' || node.childCount < 2 || (node.firstChild?.childCount ?? 0) < 2) return false;
    const header: string[] = []; node.firstChild!.forEach(cell => header.push(cell.textContent.trim()));
    if (!header.includes('项目') || !header.includes('记录')) return false;
    let filled = false;
    node.forEach((row, _pos, index) => {
      if (index > 0) { let cells = 0; row.forEach(cell => { if (cell.textContent.trim()) cells++; }); filled ||= cells >= 2; }
    });
    return filled;
  });
}

/** Pure semantic predicates: no editor commands, DOM queries, JSON snapshots or UI clicks. */
export function practiceTaskSatisfied(id: string, state: EditorState): boolean {
  const { doc, selection } = state;
  switch (id) {
    case 'selection': {
      const range = findPracticeText(doc, PRACTICE_WORD);
      return !!range && selection.from === range.from && selection.to === range.to && !selection.empty;
    }
    case 'highlight': return highlighted(doc);
    case 'heading': return anyVisibleNode(doc, node => node.type.name === 'heading' && node.attrs.level === 2 && node.textContent.trim() === PRACTICE_TITLE);
    case 'callout': return anyVisibleNode(doc, node => node.type.name === 'githubAlert' && node.textContent.includes('记得带水'));
    case 'disclosure': return anyVisibleNode(doc, node => node.type.name === 'disclosure' && String(node.attrs.title).trim() === '装备清单' && !!node.textContent.trim());
    case 'table': return filledObservationTable(doc);
    case 'table-style': return filledObservationTable(doc) && doc.firstChild?.type.name === 'documentPresentation' && doc.firstChild.attrs.tableStyle === 'three-line';
    case 'formula': return anyVisibleNode(doc, node => node.type.name === 'mathInline' && String(node.attrs.latex).replace(/\s/g, '') === 'x^2+y^2=r^2');
    case 'annotation': return hasExplanation(doc);
    case 'move': {
      const actions: number[] = [], observations: number[] = [];
      doc.forEach((node, _pos, index) => {
        if (node.textContent === ACTION_BLOCK) actions.push(index);
        if (node.textContent === OBSERVATION_BLOCK) observations.push(index);
      });
      return actions.length === 1 && observations.length === 1 && actions[0] < observations[0];
    }
    default: return false;
  }
}

interface ObservationOptions {
  editor: Editor | null;
  activeKey: string | null;
  sessionKey: string;
  stepId: string;
  current: () => boolean;
  onComplete: () => void;
  onHistoryProgress?: (undone: boolean) => void;
}

/** One editor subscription, scoped to this key and step. Cleanup invalidates queued callbacks. */
export function observePracticeTask(options: ObservationOptions): () => void {
  const { editor, activeKey, sessionKey, stepId } = options;
  if (!ownsPracticeEditor(editor, sessionKey) || activeKey !== sessionKey) return () => {};
  let disposed = false, complete = false;
  // Immutable ProseMirror reference only during the history task; no serialized copy.
  let beforeUndo: Node | null = null, historyBefore: Node | null = null, edited = false;
  const current = () => !disposed && ownsPracticeEditor(editor, sessionKey) && options.current();
  const finish = () => { if (current() && !complete) { complete = true; beforeUndo = null; options.onComplete(); } };
  const evaluate = (transaction?: Transaction) => {
    if (!current() || complete) return;
    if (stepId === 'history') {
      if (!transaction) return;
      if (!transaction.docChanged) return;
      if (isApplyingDocumentHistory(sessionKey)) historyBefore = transaction.before;
      else if (transaction.getMeta('addToHistory') !== false) {
        edited = true; historyBefore = null; beforeUndo = null;
        options.onHistoryProgress?.(false);
      }
    } else if ((!transaction || transaction.docChanged || stepId === 'selection' && transaction.selectionSet) && practiceTaskSatisfied(stepId, editor.state)) finish();
  };
  const transaction = (event: { transaction: Transaction }) => evaluate(event.transaction);
  const stopHistory = stepId === 'history' ? subscribeDocumentHistoryNavigation((key, direction) => {
    if (key !== sessionKey || !current() || complete || !edited || !historyBefore) return;
    if (direction === 'undo') { beforeUndo = historyBefore; options.onHistoryProgress?.(true); }
    else if (beforeUndo && editor.state.doc.eq(beforeUndo)) finish();
    historyBefore = null;
  }) : () => {};
  const dispose = () => {
    if (disposed) return;
    disposed = true; beforeUndo = null; historyBefore = null; stopHistory();
    editor.off('transaction', transaction); editor.off('destroy', dispose);
  };
  editor.on('transaction', transaction); editor.on('destroy', dispose);
  evaluate();
  return dispose;
}
