import { afterEach, describe, expect, it } from 'vitest';
import { Text } from '@codemirror/state';
import { getHistoryOrder, lastHistoryEdit, markHistoryEdit, nextHistoryOrder } from '@/core/historyOrder';
import { createCodeSnapshot } from '@/features/editor-code/codeSnapshot';
import {
  clearAllDocumentHistories, flushPendingDocumentHistory, getCurrentDocumentHistoryContent,
  getDocumentHistoryAvailability, getDocumentHistoryOrder, initializeDocumentHistory,
  notifyDocumentHistoryPendingInput, recordDocumentChange, redoDocumentHistory, registerDocumentHistoryAdapter,
  registerDocumentHistoryPendingInput, registerHistoryMaterializeHook, synchronizeCurrentDocumentHistoryContent, undoDocumentHistory,
} from '@/features/history/documentHistory';

const key = 'C:/notes/work.txt';
const options = { mode: 'code' as const, startsNewGroup: true };
afterEach(clearAllDocumentHistories);

function workspaceEdit() {
  const order = nextHistoryOrder();
  markHistoryEdit('workspace', order);
  return order;
}

function codeInput() {
  initializeDocumentHistory(key, '', 'code');
  registerDocumentHistoryAdapter(key, { applyEntry() {} });
  const snapshot = createCodeSnapshot({
    docKey: key,
    isCurrent: () => true,
    commit: (content, _revision, metadata) => recordDocumentChange(key, content, metadata),
    pendingChanged: () => notifyDocumentHistoryPendingInput(key),
  });
  const releasePending = registerDocumentHistoryPendingInput(key, snapshot.hasPending, snapshot.getOrder);
  const releaseHook = registerHistoryMaterializeHook(docKey => { if (docKey === key) snapshot.flushPending(); });
  const stage = (content: string) => snapshot.stage({ text: Text.of([content]), revision: 0, startsNewGroup: false });
  return { stage, release: () => { releaseHook(); releasePending(); } };
}

describe('ordering document history with workspace actions', () => {
  it('ranks pending input immediately and does not merge typing across a workspace operation', () => {
    const { stage, release } = codeInput();
    try {
      stage('a');
      const first = getDocumentHistoryOrder(key).undo!;
      expect(first).toBe(lastHistoryEdit('document'));
      const moving = workspaceEdit();
      stage('ab');
      const second = getDocumentHistoryOrder(key).undo!;
      expect(first).toBeLessThan(moving);
      expect(second).toBeGreaterThan(moving);
      flushPendingDocumentHistory(key);
      expect(getHistoryOrder()).toBe(second);
      expect(undoDocumentHistory(key)).toBe(true);
      expect(getCurrentDocumentHistoryContent(key)).toBe('a');
      expect(getDocumentHistoryOrder(key).undo).toBe(first);
    } finally { release(); }
  });

  it('preserves merged input across save normalization and reranks only successful navigation', () => {
    const { stage, release } = codeInput();
    try {
      stage('a');
      flushPendingDocumentHistory(key);
      stage('ab');
      const editOrder = getDocumentHistoryOrder(key).undo!;
      synchronizeCurrentDocumentHistoryContent(key, 'ab', 'code');
      expect(getHistoryOrder()).toBe(editOrder);
      expect(undoDocumentHistory(key)).toBe(true);
      expect(getCurrentDocumentHistoryContent(key)).toBe('');
      const redoOrder = getDocumentHistoryOrder(key).redo!;
      expect(redoOrder).toBeGreaterThan(editOrder);
      expect(redoDocumentHistory(key)).toBe(true);
      expect(getDocumentHistoryOrder(key).undo).toBeGreaterThan(redoOrder);
    } finally { release(); }
  });

  it('does not revive old redo after a new workspace branch and fresh document undo', () => {
    initializeDocumentHistory(key, '', 'code');
    registerDocumentHistoryAdapter(key, { applyEntry() {} });
    recordDocumentChange(key, 'first', options);
    recordDocumentChange(key, 'second', options);
    expect(undoDocumentHistory(key)).toBe(true);
    workspaceEdit();
    expect(getDocumentHistoryAvailability(key).canRedo).toBe(false);
    expect(redoDocumentHistory(key)).toBe(false);
    expect(undoDocumentHistory(key)).toBe(true);
    expect(redoDocumentHistory(key)).toBe(true);
    expect(getCurrentDocumentHistoryContent(key)).toBe('first');
    expect(getDocumentHistoryOrder(key).redo).toBeUndefined();
  });

  it('retains redo when an older in-flight workspace operation publishes later', () => {
    initializeDocumentHistory(key, '', 'code');
    registerDocumentHistoryAdapter(key, { applyEntry() {} });
    recordDocumentChange(key, 'first', options);
    const reserved = nextHistoryOrder();
    expect(undoDocumentHistory(key)).toBe(true);
    const redoOrder = getDocumentHistoryOrder(key).redo;
    markHistoryEdit('workspace', reserved);
    expect(getDocumentHistoryOrder(key).redo).toBe(redoOrder);
    expect(redoDocumentHistory(key)).toBe(true);
  });
});
